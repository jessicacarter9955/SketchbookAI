#!/usr/bin/env python3
"""Strictly read-only Windows/Linux cloud and official WorldBLD download probe.

Uses 4-KiB Range requests; caps downloads at 64KiB and refuses to print
potentially secret signed URLs or server-set cookies. Does not enroll or spend.
"""
import json
import os
import platform
import shutil
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

OUTPUT = Path("tools/worldbld-browser/results/compatibility.json")
URLS = {
    "worldbld-unreal-5.8": "https://worldbld.com/launchpad/6a2a005e4ae90b110f0e416b/download",
    "worldbld-unreal-5.7": "https://worldbld.com/launchpad/696d3ca100fa1aa6c50bf195/download",
}
def safe_location(url):
    parts = urllib.parse.urlparse(url)
    return {"host": parts.netloc, "path": parts.path, "query_redacted": bool(parts.query)}

def probe(name, url):
    info = {"name": name, "requested_url": safe_location(url), "max_response_bytes": 65536}
    try:
        req=urllib.request.Request(url, headers={"User-Agent": "WorldBLD-CI-CompatibilityProbe/1.0", "Range":"bytes=0-4095"})
        with urllib.request.urlopen(req, timeout=20) as response:
            data=response.read(65536)
            info.update({"http_status":response.status, "redirect_target":safe_location(response.url),
                         "content_type":response.headers.get("Content-Type"),
                         "declared_content_length":response.headers.get("Content-Length"),
                         "content_range":response.headers.get("Content-Range"),
                         "received_bytes":len(data),
                         "looks_zip":data[:4] in (b"PK\\x03\\x04",b"PK\\x05\\x06"), 
                         "looks_html":b"<html" in data[:512].lower() or b"<!doctype html" in data[:512].lower()})
    except urllib.error.HTTPError as exc:
        info["http_status"]=exc.code
        info["error"] = "HTTP request rejected (no bypass attempted)"
    except Exception as exc:
        info["error"]=type(exc).__name__
    return info

def main():
    d=shutil.disk_usage(".")
    result={"timestamp_utc":__import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
      "host_os":platform.system(), "host_version":platform.release(),
      "free_disk_gib":round(d.free/1024**3,2),
      "unreal_editor_candidates":[],
      "gpu_started":False, "remote_account_created":False, "download_byte_cap":65536,
      "gpu_vm_eligible_not_assumed":True}
    candidates=[Path("C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor.exe"),
                Path("/opt/unreal-engine/Engine/Binaries/Linux/UnrealEditor")]
    result["unreal_editor_candidates"]=[{"path":str(p),"exists":p.exists()} for p in candidates]
    result["official_download_probes"]=[probe(n,u) for n,u in URLS.items()]
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    OUTPUT.write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(result,indent=2))
if __name__=="__main__": main()
