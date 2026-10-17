#!/usr/bin/env python3
"""Safely inventory or stage an Unreal project from a Google Drive folder.

Requires a user-supplied OAuth access token with Drive read permission.
No credentials, Unreal packages, or output assets are committed to Git.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request

API = "https://www.googleapis.com/drive/v3/files"
FOLDER = "application/vnd.google-apps.folder"
FORBIDDEN = re.compile(r'(^[.]$|^[.][.]$|[\\/\x00-\x1f]|[. ]$|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:[.]|$))', re.I)
PACKAGES = {".uasset", ".umap"}
SIDECARS = {".uexp", ".ubulk", ".uptnl"}


class DriveSourceError(ValueError):
    pass


def valid_name(name):
    if not isinstance(name, str) or not name or FORBIDDEN.search(name):
        raise DriveSourceError("Unsafe Google Drive filename (not staged): " + repr(name))
    return name


def get_json(url, token, opener=urllib.request.urlopen):
    request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    with opener(request, timeout=60) as response:
        return json.load(response)


def inventory(folder_id, token, opener=urllib.request.urlopen):
    """Return a stable manifest without downloading binary project content."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,200}", folder_id):
        raise DriveSourceError("Invalid Google Drive folder ID")
    if not token:
        raise DriveSourceError("Missing Google Drive OAuth token")
    pending = [(folder_id, "")]
    folders_seen = set()
    paths_seen = set()
    files = []
    while pending:
        current, prefix = pending.pop()
        if current in folders_seen:
            raise DriveSourceError("Cyclic or duplicate Google Drive folder identity")
        folders_seen.add(current)
        page_token = None
        while True:
            params = {
                "q": "'" + current + "' in parents and trashed = false",
                "fields": "nextPageToken,files(id,name,mimeType,size,md5Checksum)",
                "pageSize": "1000",
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true",
            }
            if page_token:
                params["pageToken"] = page_token
            result = get_json(API + "?" + urllib.parse.urlencode(params), token, opener)
            for item in result.get("files", []):
                name = valid_name(item.get("name"))
                path = prefix + name
                key = path.casefold()
                if key in paths_seen:
                    raise DriveSourceError("Duplicate/case-colliding Drive path: " + path)
                paths_seen.add(key)
                if item.get("mimeType") == FOLDER:
                    pending.append((item["id"], path + "/"))
                elif str(item.get("mimeType", "")).startswith("application/vnd.google-apps."):
                    raise DriveSourceError("Native Google document cannot be staged as an Unreal package: " + path)
                else:
                    files.append({
                        "path": path, "id": item["id"], "size": int(item.get("size") or 0),
                        "md5": item.get("md5Checksum"),
                    })
            page_token = result.get("nextPageToken")
            if not page_token:
                break
    files.sort(key=lambda row: row["path"].casefold())
    projects = [row["path"] for row in files if Path(row["path"]).suffix.lower() == ".uproject"]
    packages = [row["path"] for row in files if Path(row["path"]).suffix.lower() in PACKAGES]
    content_packages = [p for p in packages if p.startswith("Content/")]
    status = "ready_to_stage" if len(projects) == 1 and content_packages else "incomplete"
    missing = []
    if len(projects) != 1:
        missing.append("Expected exactly one .uproject at the project root" if not projects or len(projects) > 1
                       else "Unreal project descriptor must be at the project root")
    elif "/" in projects[0]:
        missing.append(".uproject must be at the project root")
        status = "incomplete"
    if not content_packages:
        missing.append("No source .uasset or .umap files under Content/")
    return {
        "schema_version": 1, "source": "google_drive_folder", "folder_id": folder_id,
        "status": status if not missing else "incomplete",
        "project": projects[0] if len(projects) == 1 and "/" not in projects[0] else None,
        "package_count": len(packages), "content_package_count": len(content_packages),
        "sidecar_count": sum(Path(f["path"]).suffix.lower() in SIDECARS for f in files),
        "total_bytes": sum(f["size"] for f in files),
        "missing": missing, "files": files,
    }


def stage(manifest, token, destination, opener=urllib.request.urlopen):
    if manifest["status"] != "ready_to_stage":
        raise DriveSourceError("Incomplete Unreal source; refusing to stage: " + "; ".join(manifest["missing"]))
    requested = Path(destination).expanduser()
    if requested.is_symlink():
        raise DriveSourceError("Destination cannot be a symlink")
    destination = requested.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    completed = []
    for item in manifest["files"]:
        pieces = item["path"].split("/")
        for segment in pieces:
            valid_name(segment)
        path = destination.joinpath(*pieces)
        if path.is_symlink() or not path.resolve().is_relative_to(destination):
            raise DriveSourceError("Unsafe local destination: " + item["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            if not path.is_file():
                raise DriveSourceError("Source file collides with local directory: " + item["path"])
            digest = hashlib.md5(path.read_bytes()).hexdigest()
            if item.get("md5") and digest.lower() == item["md5"].lower() and path.stat().st_size == item["size"]:
                completed.append(item["path"])
                continue
            raise DriveSourceError("Existing staged file differs; originals will not be overwritten: " + item["path"])
        url = API + "/" + urllib.parse.quote(item["id"], safe="") + "?alt=media"
        request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
        fd, temp = tempfile.mkstemp(prefix=".ue2three-", dir=path.parent)
        try:
            md5 = hashlib.md5()
            total = 0
            with os.fdopen(fd, "wb") as output, opener(request, timeout=120) as response:
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    output.write(block)
                    md5.update(block)
                    total += len(block)
            if total != item["size"] or not item.get("md5") or md5.hexdigest().lower() != item["md5"].lower():
                raise DriveSourceError("Downloaded source checksum/size mismatch: " + item["path"])
            os.replace(temp, path)
            completed.append(item["path"])
        finally:
            if os.path.exists(temp):
                os.unlink(temp)
    return completed


def main(argv=None):
    parser = argparse.ArgumentParser(description="Inventory/stage an original Unreal source tree from Google Drive")
    parser.add_argument("--folder-id", required=True, help="ID of folder containing the original .uproject and Content")
    parser.add_argument("--destination", type=Path, default=Path(".local/ue2three/drive-source"))
    parser.add_argument("--token-env", default="GOOGLE_DRIVE_ACCESS_TOKEN", help="Name of environment variable; never pass token as an argument")
    parser.add_argument("--download", action="store_true", help="Explicitly stage byte-identical files; otherwise metadata audit only")
    args = parser.parse_args(argv)
    try:
        token = os.environ.get(args.token_env, "")
        report = inventory(args.folder_id, token)
        print(json.dumps({k: v for k, v in report.items() if k != "files"}, indent=2))
        if report["status"] != "ready_to_stage":
            return 2
        if args.download:
            files = stage(report, token, args.destination)
            manifest_path = args.destination / "ue2three-drive-inventory.json"
            manifest_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            print("Staged", len(files), "verified original files in", args.destination)
            print("Original project:", args.destination / report["project"])
        return 0
    except (DriveSourceError, urllib.error.HTTPError, urllib.error.URLError, OSError, ValueError) as exc:
        print("DDS DRIVE SOURCE ERROR:", str(exc))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
