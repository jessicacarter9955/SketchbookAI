"""Downsample nonessential high-resolution textures for a compact offline mobile APK.
Keep original filenames, channel modes and all GLTF binary meshes.
"""
from pathlib import Path
from PIL import Image
import os
root=Path(__file__).resolve().parents[1]/'www'
target_dirs=[root/'assets'/'urban-kits',root/'assets'/'roadforge']
count=0;old=0;new=0
for directory in target_dirs:
    for path in directory.rglob('*'):
        if path.suffix.lower() not in ('.jpg','.jpeg','.png') or not path.is_file():
            continue
        if path.stat().st_size < 190000:
            continue
        before=path.stat().st_size
        try:
            with Image.open(path) as im:
                im.load()
                if max(im.size) <= 768 and before < 500000:
                    continue
                im.thumbnail((896,896),Image.Resampling.LANCZOS)
                temp=path.with_name(path.stem+'-mobile-temp'+path.suffix)
                if path.suffix.lower() in ('.jpg','.jpeg'):
                    if im.mode not in ('L','RGB'): im=im.convert('RGB')
                    im.save(temp,quality=74,optimize=True,progressive=True,subsampling=0)
                else:
                    if im.mode not in ('L','RGB','RGBA','P'):
                        im=im.convert('RGBA')
                    im.save(temp,optimize=True,compress_level=9)
                if temp.stat().st_size<before:
                    os.replace(temp,path);count+=1;old+=before;new+=path.stat().st_size
                else: temp.unlink()
        except Exception as e:
            print('Skipping unsupported texture',path.relative_to(root),str(e))
print(f'Optimized {count} textures: {old/2**20:.1f} MiB -> {new/2**20:.1f} MiB; saved {(old-new)/2**20:.1f} MiB')
print('Offline assets total',sum(p.stat().st_size for p in root.rglob('*') if p.is_file())/2**20,'MiB')
