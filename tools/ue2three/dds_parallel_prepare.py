#!/usr/bin/env python3
"""Create an actionable, immutable DDS->Three.js engineering workpack for one lane.
No gameplay tests, Unreal launch, external access, fake assets, or QA assertions.
"""
import argparse, hashlib, json, os, re, struct
from pathlib import Path
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parents[2]
CONFIG=ROOT/'tools/ue2three/dds_porting_lanes.json'
BASES={'dds':ROOT/'build/local-scenes/dds','ue2three':ROOT/'build/local-scenes/ue2three/current'}

def provenance(path):
    full=ROOT/path
    if not full.is_file(): return {'path':path,'found':False}
    return {'path':path,'found':True,'bytes':full.stat().st_size,
            'sha256':hashlib.sha256(full.read_bytes()).hexdigest()}

def glb_ok(path):
    if not path.is_file() or path.stat().st_size < 32:return False
    with path.open('rb') as source: header=source.read(12)
    return len(header)==12 and struct.unpack('<4sII',header)==(b'glTF',2,path.stat().st_size)

def exports():
    result={}
    for name,base in BASES.items():
        record={'manifest':(base/'manifest.json').is_file(),'original_assets_available':False}
        if record['manifest']:
            try:
                m=json.loads((base/'manifest.json').read_text('utf-8'))
                if name=='dds' and m.get('version')!=1:raise ValueError('version')
                if name=='ue2three' and (m.get('kind')!='character' or m.get('schema_version')!=1):
                    raise ValueError('schema')
                files=[m['mesh'],*m['clips'].values(),*m.get('weapons',{}).values(),
                       *m.get('weaponClips',{}).values(),
                       *(a['file'] for a in m.get('attachment_assets',{}).values())]
                if not files or any(not isinstance(f,str) or not re.fullmatch(r'[A-Za-z0-9_.-]+[.]glb',f)
                                    or '..' in f for f in files):
                    raise ValueError('unsafe filename')
                missing=[f for f in sorted(set(files)) if not glb_ok(base/f)]
                record.update({'required':len(set(files)),'missing':len(missing),
                               'missing_sample':missing[:5],'original_assets_available':not missing})
            except (ValueError,KeyError,TypeError,OSError) as err:
                record['manifest_error']=str(err)
        result[name]=record
    return result

def characterize(lane_id):
    cfg=json.loads(CONFIG.read_text('utf-8'))
    selected=next((i for i in cfg['lanes'] if i['id']==lane_id),None)
    if selected is None:raise ValueError('Unknown lane')
    paths=[provenance(path) for path in selected['files']]
    available=sum(bool(x['found']) for x in paths)
    checked=exports()
    source_ready=any(x['original_assets_available'] for x in checked.values())
    if selected['critical'] and not source_ready: fidelity='red'
    elif available<len(paths): fidelity='red'
    else:fidelity='yellow'
    report={'schema':'dds-port-workpack-v1','id':selected['id'],'title':selected['title'],
            'git_sha':os.environ.get('GITHUB_SHA','untracked'),
            'generated_at':datetime.now(timezone.utc).isoformat(),
            'workflow':'engineering_preparation_not_completed_gameplay',
            'code_files_present':available,'code_files_expected':len(paths),
            'code_provenance':paths,'authentic_export':checked,
            'feature_traffic_light':fidelity,'source_requirement':selected['critical'],
            'blocked_by':selected['blocker'],'next_step':selected['next'],
            'unreal_engine_started':False,'unreal_1_to_1_verified':False,
            'user_action_required':'Play and feedback only',
            'no_placeholders_as_original_assets':True}
    if lane_id in ('source-assets','character-weapons','animation-rig'):
        recipe=ROOT/'tools/ue2three/recipes/dds-character.json'
        if recipe.is_file():
            data=json.loads(recipe.read_text('utf-8'))
            report['unreal_recipe']={'mesh':data.get('mesh'),'clips':len(data.get('clips',{})),
                'weapons':{k:v.get('asset') for k,v in data.get('attachment_assets',{}).items()},
                'required_bones':data.get('runtime',{}).get('required_bones',[])}
    if lane_id in ('blueprint-compiler','inventory-economy','shop-dialogues','multiplayer'):
        text=(ROOT/'docs/ue2three-progress.md').read_text('utf-8')
        match=re.search(r'(\d+)\s+translated\s*/\s*(\d+)\s+blocked',text)
        if match:report['previous_Codex_report_not_recomputed']={'translated':int(match[1]),'blocked':int(match[2])}
        fixture=ROOT/'tests/fixtures/dds-blueprints.json'
        if fixture.is_file():
            data=json.loads(fixture.read_text('utf-8'))
            report['source_fixture']={'available':True,'cases':len(data.get('cases',[])) if isinstance(data,dict) else None}
    return report

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--lane',required=True)
    p.add_argument('--out-dir',default='build/dds-port-workpacks')
    a=p.parse_args()
    r=characterize(a.lane)
    dest=(ROOT/a.out_dir).resolve()
    dest.mkdir(parents=True,exist_ok=True)
    (dest/(a.lane+'.json')).write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n','utf-8')
    color={'red':'🔴','yellow':'🟡','green':'🟢'}[r['feature_traffic_light']]
    lines=['# '+color+' '+r['title'],'','**Status:** workpack created, 1:1 NOT verified.',
           '**Blocker:** '+r['blocked_by'],'**Next:** '+r['next_step'],'',
           '**Existing implementation files:** '+str(r['code_files_present'])+'/'+str(r['code_files_expected']),'',
           '## Source provenance','']
    lines.extend('- '+('Found' if x['found'] else 'MISSING')+': '+x['path'] for x in r['code_provenance'])
    (dest/(a.lane+'.md')).write_text('\n'.join(lines)+'\n','utf-8')
    print(json.dumps({'lane':r['id'],'traffic_light':r['feature_traffic_light'],
        'files':r['code_files_present'],'blocker':r['blocked_by']},ensure_ascii=False))
if __name__=='__main__': main()
