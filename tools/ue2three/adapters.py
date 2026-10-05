"""Read-only engine discovery and a deliberate future conversion boundary."""
import os
import re
from pathlib import Path

from core import read_json


def registry_installs():
    if os.name != "nt":
        return []
    import winreg
    found = []
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Epic Games\Unreal Engine\Builds") as key:
            for index in range(winreg.QueryInfoKey(key)[1]):
                association, location, _ = winreg.EnumValue(key, index)
                found.append((association, Path(location), "user-registry"))
    except OSError:
        pass
    for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\EpicGames\Unreal Engine", 0, winreg.KEY_READ | view) as key:
                for index in range(winreg.QueryInfoKey(key)[0]):
                    association = winreg.EnumKey(key, index)
                    with winreg.OpenKey(key, association) as subkey:
                        location, _ = winreg.QueryValueEx(subkey, "InstalledDirectory")
                        found.append((association, Path(location), "machine-registry"))
        except OSError:
            pass
    return found


def installed_candidates():
    found = registry_installs()
    roots = [Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Epic Games"]
    if os.name != "nt":
        roots += [Path("/opt"), Path.home() / "UnrealEngine", Path("/Users/Shared/Epic Games")]
    for root in roots:
        if root.is_dir():
            for path in sorted(root.glob("UE_*")):
                if path.is_dir():
                    found.append((path.name.removeprefix("UE_"), path, "installed-path"))
    return found


class MetadataAdapter:
    """No adapter executes an editor or loads an Unreal plugin during inspection."""
    id = "filesystem-v1"

    def capabilities(self):
        return {"filesystem_inventory": True, "registry_json_import": True,
                "asset_conversion": False, "blueprint_translation": False}

    def convert(self, *_args, **_kwargs):
        raise NotImplementedError("Stage 1 does not implement asset conversion")


def detect_engine(association, override=None, candidates=None):
    found = candidates if candidates is not None else installed_candidates()
    result = {"requested_association": association, "adapter": MetadataAdapter.id,
              "capabilities": MetadataAdapter().capabilities(), "status": "missing", "warnings": []}
    if override:
        selected = (association, Path(override).resolve(), "explicit-override")
    else:
        matches = [item for item in found if item[0].strip("{}").lower() == str(association).strip("{}").lower()]
        selected = sorted(matches, key=lambda item: (item[2], str(item[1])))[0] if matches else None
    if selected is None:
        result["warnings"].append("No matching engine found. Filesystem inspection remains available; use --engine for custom builds.")
        return result
    _association, path, source = selected
    result.update(root=str(path.resolve()), detection=source)
    version_file = path / "Engine" / "Build" / "Build.version"
    try:
        data = read_json(version_file)
        version = tuple(int(data[key]) for key in ("MajorVersion", "MinorVersion", "PatchVersion"))
    except (OSError, ValueError, TypeError, KeyError) as exc:
        result.update(status="invalid", error=f"Cannot read engine Build.version: {type(exc).__name__}")
        return result
    binaries = ["Engine/Binaries/Win64/UnrealEditor-Cmd.exe", "Engine/Binaries/Win64/UE4Editor-Cmd.exe",
                "Engine/Binaries/Linux/UnrealEditor", "Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor"]
    executable = next((str(path / item) for item in binaries if (path / item).is_file()), None)
    result.update(status="detected", version=".".join(map(str, version)), version_parts=list(version),
                  changelist=data.get("Changelist"), executable=executable)
    if not executable:
        result["warnings"].append("Editor executable not found. Registry extraction cannot run with this installation.")
    if re.fullmatch(r"\d+\.\d+(?:\.\d+)?", str(association)):
        requested = tuple(map(int, str(association).split(".")))
        if version[:len(requested)] != requested:
            result["warnings"].append(f"Engine override version {result['version']} differs from project association {association}; opening may upgrade packages.")
    result["registry_adapter"] = "ue5-python" if version[0] == 5 else "ue4-python" if version[0] == 4 else "unverified-python-api"
    return result
