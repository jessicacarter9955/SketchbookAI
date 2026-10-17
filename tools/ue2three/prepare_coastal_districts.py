"""Package actual DDS ue2three exported Unreal levels into the four-district site.

No Blender stand-ins, placeholder .glb files, or copied Epic/Fab content. The
source directories must be REAL ue2three migrate-maps output, produced with
tools/ue2three/ue2three.py migrate-maps, and supplied with approved licenses.

Example:
  python tools/ue2three/prepare_coastal_districts.py \
    --ny-export PATH/ny.glb --sf-export PATH/sf.glb \
    --rio-export PATH/rio.glb --miami-export PATH/miami.glb \
    --source-url https://example.org/original-authorized-ue-city \
    --license CC0 --output build/local-scenes/ue2three-districts

Runs offline. Does not start Unreal, authenticate cloud accounts or download
anything. Export paths may be populated by an automated authorized UE runner.
The browser loads the resulting manifest and GLBs without device file pickers.
"""
import argparse
import hashlib
import json
import shutil
import struct
from pathlib import Path

ZONE_POS={"ny":[-165,0,-172],"sf":[165,0,-172],
          "rio":[-165,0,113],"miami":[165,0,113]}
LICENSES={"CC0","MIT","CC-BY-4.0","Apache-2.0","BSD-3-Clause",
          "GPL-3.0","Fab Standard","Proprietary authorized"}
LIMIT=800 * 1024 * 1024

def inspect_gltf(path):
    source=Path(path)
    if not source.is_file() or not 32 <= source.stat().st_size <= LIMIT:
        raise ValueError("Expected nonempty, bounded real GLB: "+str(source))
    with source.open("rb") as stream:
        header=stream.read(20)
        if len(header)!=20:
            raise ValueError("Truncated GLB header")
        magic,version,total,json_len,chunk=struct.unpack("<4sIIII",header)
        if magic!=b"glTF" or version!=2 or total!=source.stat().st_size or chunk!=0x4e4f534a:
            raise ValueError("Invalid glTF 2.0 binary header")
        if json_len>16*1024*1024 or json_len<2:
            raise ValueError("Invalid GLB JSON chunk length")
        data=json.loads(stream.read(json_len))
    meshes=data.get("meshes",[])
    tex=data.get("textures",[])
    mats=data.get("materials",[])
    if not meshes or not tex or not mats:
        raise ValueError("Unreal export must include meshes AND PBR materials/textures")
    for mesh in meshes:
        if not mesh.get("primitives"):
            raise ValueError("Empty geometry primitive")
    for t in tex:
        if not isinstance(t.get("source"),int):
            # GLTF extension source types require separate support.
            raise ValueError("GLB texture has no standard image source")
    return {"meshes":len(meshes),"materials":len(mats),"textures":len(tex)}

def publish(inputs,output,source_url,license_id,coverage="architecture-only"):
    if set(inputs)!=set(ZONE_POS):raise ValueError("Four exports required: ny/sf/rio/miami")
    if license_id not in LICENSES or not source_url.startswith("https://"):
        raise ValueError("Authorized source URL and license required")
    if coverage not in {"architecture-only","overlay"}:
        raise ValueError("Unsupported district export coverage")
    dest=Path(output).resolve()
    validated={}
    for zone,path in inputs.items():
        source=Path(path).resolve()
        if dest==source or dest in source.parents:
            raise ValueError("Output cannot overwrite Unreal source GLB")
        validated[zone]={"path":source,**inspect_gltf(source)}
    dest.mkdir(parents=True,exist_ok=True)
    manifest={"version":1,"districts":{}}
    for zone in ZONE_POS:
        src=validated[zone]["path"]
        name=f"{zone}/scene.glb"
        parent=dest/zone;parent.mkdir(parents=True,exist_ok=True)
        tmp=parent/"scene.glb.tmp";shutil.copyfile(src,tmp);tmp.replace(parent/"scene.glb")
        sha=hashlib.sha256((parent/"scene.glb").read_bytes()).hexdigest()
        manifest["districts"][zone]={
            "source_type":"UNREAL_NATIVE_LEVEL",
            "source_url":source_url,"license":license_id,"url":name,
            "sha256":sha,
            "coverage":coverage,
            "placement":{"position":ZONE_POS[zone],"rotationY":0,"scale":1},
            "metrics":{k:validated[zone][k] for k in ("meshes","materials","textures")}}
    tmp=dest/"manifest.json.tmp"
    tmp.write_text(json.dumps(manifest,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    tmp.replace(dest/"manifest.json")
    return manifest

def main():
    p=argparse.ArgumentParser()
    for z in ZONE_POS:p.add_argument("--"+z+"-export",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--source-url",required=True)
    p.add_argument("--license",required=True,choices=sorted(LICENSES))
    p.add_argument("--coverage",choices=["architecture-only","overlay"],default="architecture-only")
    a=p.parse_args()
    inputs={z:getattr(a,z+"_export") for z in ZONE_POS}
    out=publish(inputs,a.output,a.source_url,a.license,a.coverage)
    print(json.dumps({"published":list(out["districts"]),"output":str(a.output)}))
if __name__=="__main__":main()
