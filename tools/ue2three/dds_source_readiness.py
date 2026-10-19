"""Automatic original DDS export readiness check; does not run tests or Unreal."""
from __future__ import annotations
import json
import struct
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
TARGET=ROOT/"build/local-scenes/dds-source-readiness.json"

def valid_glb(p):
    if not p.is_file() or p.stat().st_size < 20:
        return False
    with p.open("rb") as fd:
        header=fd.read(12)
    return len(header)==12 and struct.unpack("<4sII",header)==(b"glTF",2,p.stat().st_size)

def inspect(kind,location):
    result={"name":kind,"export_available":False}
    path=ROOT/location/"manifest.json"
    if not path.is_file():
        result["reason"]="Original manifest not available on this GitHub runner"
        return result
    try:
        m=json.loads(path.read_text("utf-8"))
        if kind=="ue2three" and (m.get("kind")!="character" or m.get("schema_version")!=1):
            raise ValueError("Unsupported ue2three manifest")
        if kind=="dds" and (m.get("version")!=1 or
            any(w not in m.get("weapons",{}) for w in ("rifle","pistol"))):
            raise ValueError("Incomplete legacy DDS manifest")
        files=[m["mesh"],*m["clips"].values(),
            *m.get("weapons",{}).values(),
            *m.get("weaponClips",{}).values(),
            *(a["file"] for a in m.get("attachment_assets",{}).values())]
        missing=[]
        for f in sorted(set(files)):
            if not isinstance(f,str) or "/" in f or "\\" in f or ".." in f or not f.lower().endswith(".glb"):
                raise ValueError("Invalid original filename")
            if not valid_glb(ROOT/location/f):
                missing.append(f)
        result["required"]=len(set(files))
        result["missing_count"]=len(missing)
        result["missing_first"]=missing[:8]
        if not missing and kind=="dds" and not (ROOT/"build/local-scenes/liberty-city/manifest.json").is_file():
            result["reason"]="Original Liberty City map not available"
        elif missing:
            result["reason"]="Missing genuine Unreal GLB exports"
        else:
            result["export_available"]=True
            result["reason"]="Header and file checks passed; playable 1:1 fidelity not verified"
    except (ValueError,KeyError,TypeError,OSError) as e:
        result["reason"]="Invalid source export metadata: "+str(e)
    return result

if __name__=="__main__":
    checks=[
        inspect("dds","build/local-scenes/dds"),
        inspect("ue2three","build/local-scenes/ue2three/current")
    ]
    TARGET.parent.mkdir(parents=True,exist_ok=True)
    report={"schema":"dds-source-readiness-v1","play_only_user_action":True,
        "automatic_original_export_available":any(c["export_available"] for c in checks),
        "original_unreal_runtime_verified":False,"sources":checks}
    TARGET.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report,indent=2))
