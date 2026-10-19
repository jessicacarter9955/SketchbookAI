"""Stage independently licensed CC0 models/textures for a Stylescape-inspired biome study.

Original Stylescape HD is proprietary Unreal content and is never downloaded
or redistributed by this script. This study uses CC0 Poly Haven source files.
"""
import concurrent.futures
import hashlib
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1] / 'assets' / 'stylescape-study'
TEXTURES = ('forrest_ground_01', 'mossy_rock', 'snow_02', 'rock_pitted_mossy')
MODELS = ('namaqualand_cliff_01',)
SOURCE = 'https://cosmos.leartesstudios.com/environments/stylescape-stylized-hd-environment-kit'

def get(url):
    return subprocess.check_output(['curl','-fLsS','--retry','3','--retry-all-errors','--max-time','100',url],timeout=125)
def save(url,path,expected_md5):
    if not expected_md5:
        raise ValueError(f'Missing official checksum for {path}')
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists() and hashlib.md5(path.read_bytes()).hexdigest()==expected_md5: return
    tmp=path.with_suffix(path.suffix+'.part')
    subprocess.run(['curl','-fLsS','--retry','3','--retry-all-errors',
      '--max-time','125',url,'-o',str(tmp)],check=True,timeout=155)
    if hashlib.md5(tmp.read_bytes()).hexdigest()!=expected_md5:
        tmp.unlink(missing_ok=True)
        raise ValueError(f'Checksum mismatch: {path}')
    tmp.replace(path)

def main():
    tasks=[]
    for asset in TEXTURES:
        data=json.loads(get('https://api.polyhaven.com/files/'+asset))
        for channel,name in [('Diffuse','diff'),('nor_gl','nor_gl'),('Rough','rough')]:
            original=data[channel]['1k']['jpg']
            tasks.append((original['url'],ROOT/asset/(name+'.jpg'),original['md5']))
    for asset in MODELS:
        data=json.loads(get('https://api.polyhaven.com/files/'+asset))
        kit=data['gltf']['1k']['gltf']
        folder=ROOT/asset
        tasks.append((kit['url'],folder/'scene.gltf',kit['md5']))
        for subpath,file in kit['include'].items():
            tasks.append((file['url'],folder/subpath,file['md5']))
    with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
        list(pool.map(lambda t:save(*t),tasks))
    metadata={'title':'Stylescape-inspired biome study (not Stylescape HD)', 
        'commercial_reference':SOURCE,'original_stylescape_assets':False,
        'license':'CC0 Poly Haven','textures':list(TEXTURES),'models':list(MODELS),
        'reuse':['assets/urban-kits/tree_small_02','assets/urban-kits/leafy_grass',
          'assets/urban-kits/grass_ground','assets/urban-kits/miami-coast']}
    ROOT.mkdir(parents=True,exist_ok=True)
    (ROOT/'ATTRIBUTION.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8')
    print('Stylescape CC0 study: verified',len(tasks),'original files; NOT proprietary Unreal content',flush=True)

if __name__=='__main__':main()
