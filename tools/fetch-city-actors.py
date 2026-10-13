"""Fetch actual skinned actors + high-resolution vehicle shell for the urban scene.

The legacy Sketchbook boxman/car GLBs remain in place for non-urban maps and
for car collision, seat and wheel metadata. Urban visuals must not fall back to
them silently. Upstream example binaries and their attribution are documented
in build/assets/CITY-ACTOR-CREDITS.txt.
"""
from pathlib import Path
from urllib.request import Request, urlopen
import hashlib
import struct

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"build"/"assets"
OUT.mkdir(parents=True,exist_ok=True)
BASE="https://raw.githubusercontent.com/mrdoob/three.js/r152/examples/models/gltf/"
ASSETS={"city-soldier.glb":"Soldier.glb","city-ferrari.glb":"ferrari.glb"}
for name,upstream in ASSETS.items():
    dest=OUT/name
    if dest.is_file() and dest.stat().st_size>300000:
        blob=dest.read_bytes()
    else:
        url=BASE+upstream
        print("Fetching full actor geometry",url,flush=True)
        with urlopen(Request(url,headers={"User-Agent":"SketchbookCityAssetBuilder/1.0"}),timeout=90) as response:
            blob=response.read()
    if len(blob)<300000 or blob[:4]!=b"glTF" or struct.unpack_from("<I",blob,8)[0]!=len(blob):
        raise RuntimeError("Missing/invalid full-resolution glTF asset: "+name)
    dest.write_bytes(blob)
    print(name,len(blob),"bytes SHA256",hashlib.sha256(blob).hexdigest(),flush=True)
(OUT/"CITY-ACTOR-CREDITS.txt").write_text(
    "Sketchbook City photoreal visual improvement — sources\n"
    "Soldier.glb (rigged 3D person) from the official Three.js examples at "
    "https://github.com/mrdoob/three.js/tree/r152/examples/models/gltf — original Mixamo animation demo.\n"
    "ferrari.glb from the official Three.js examples at "
    "https://github.com/mrdoob/three.js/tree/r152/examples/models/gltf ; Ferrari model CC BY 4.0.\n"
    "Original source rights and attribution are retained. The underlying "
    "Sketchbook car GLB is used only for collision/entry interactions.\n"
    "These are provisional higher-detail replacements, NOT photogrammetric "
    "humans or fully photorealistic final production assets.\n",encoding="utf-8"
)
