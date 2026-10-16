#!/usr/bin/env python3
"""Subject-specific annotated Forge sculpt spec for the original user's lime carbine.

Use only the original photograph for visible-side identity. Six supplementary AI
views are hypotheses for thickness and hidden-surface continuity, not scans.
The strict upstream img2threejs validator remains the authority; this script
never marks visual passes completed or forges passing PBR evidence.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
import json
from pathlib import Path

COLORS={
 'lime-coat':('rgba(169,248,18,1)','rgba(115,208,17,1)','metal'),
 'polymer':('rgba(40,43,46,1)','rgba(80,81,82,1)','plastic'),
 'dark-steel':('rgba(30,32,34,1)','rgba(91,94,96,1)','metal'),
 'grip-rubber':('rgba(32,35,37,1)','rgba(59,61,63,1)','rubber')
}
# Poses in studio reference-model world coordinates. +X points toward muzzle,
# +Y goes upwards, and +Z is the authoritative photographed side.
# Dimensions are approximate relative proportions measured from the 840x301
# source crop, *not* measurements of a real operational weapon.
PARTS=[
 ('receiver-upper','Receiver upper green housing','macro','box',(-1.15,.73,0),(3.05,.84,.71),'lime-coat',None),
 ('receiver-lower','Receiver lower with characteristic angled magwell','macro','box',(-.92,.12,0),(2.54,.99,.68),'lime-coat','receiver-upper'),
 ('fore-end','Long lime ventilated fore-end','macro','box',(2.55,.79,0),(4.30,.86,.62),'lime-coat','receiver-upper'),
 ('rear-brace','Rear black brace shell and stabilizer','macro','box',(-3.86,.65,0),(2.40,.90,.72),'polymer','receiver-upper'),
 ('handgrip','Black textured angled pistol grip','macro','box',(-1.28,-.74,0),(.77,1.55,.57),'grip-rubber','receiver-lower'),
 ('magazine','Polymer tapered AMEND2 marked magazine','macro','box',(.15,-1.09,0),(.96,1.70,.54),'polymer','receiver-lower'),
 ('barrel-front','Dark projecting front tube','macro','cylinder',(4.98,.79,0),(.41,.41,.86),'dark-steel','fore-end'),
 ('top-rail','Continuous top accessory rail','meso','box',(.67,1.29,0),(7.90,.13,.48),'lime-coat','fore-end'),
 ('rail-teeth','Individually spaced rail crenellations','meso','box',(.67,1.39,0),(7.82,.13,.43),'lime-coat','top-rail'),
 ('port-upper','Upper elongated handguard openings','meso','box',(2.78,1.02,.30),(3.05,.115,.045),'dark-steel','fore-end'),
 ('port-lower','Lower elongated handguard openings','meso','box',(2.72,.55,.30),(3.00,.115,.045),'dark-steel','fore-end'),
 ('vent-interior','Recessed internal dark area behind real vents','meso','cylinder',(2.62,.79,-.04),(3.75,.26,.26),'dark-steel','fore-end'),
 ('handguard-collar','Black front receiver clamp','meso','box',(.56,.78,0),(.17,.90,.71),'dark-steel','fore-end'),
 ('muzzle-annulus','Dark front annular face visual asset','meso','cylinder',(5.33,.79,0),(.43,.43,.10),'dark-steel','barrel-front'),
 ('muzzle-ports','Radial textured muzzle-shell perforation set','meso','box',(5.18,.79,.2),(.34,.11,.07),'dark-steel','barrel-front'),
 ('ejection-side','Black rectangular side detail plate','meso','box',(-.60,.90,.38),(1.16,.33,.045),'dark-steel','receiver-upper'),
 ('ejection-latch','Small dark stepped cover-button','meso','box',(-.39,.88,.42),(.22,.14,.06),'dark-steel','ejection-side'),
 ('selector-controls','Dark receiver controls/pins visible on source','meso','cylinder',(-1.56,.51,.38),(.17,.17,.065),'dark-steel','receiver-upper'),
 ('trigger-guard','Hollow negative-space trigger perimeter','meso','torus',(-.49,-.21,.10),(.66,.43,.38),'lime-coat','receiver-lower'),
 ('brace-buffer','Dark cylinder joining brace to main receiver','meso','cylinder',(-2.59,.81,0),(.29,.29,.65),'dark-steel','rear-brace'),
 ('brace-pad','Rubberized textured endpad','meso','box',(-5.00,.48,0),(.27,1.52,.74),'grip-rubber','rear-brace'),
 ('brace-joint','Black stepped brace adjustment detail','meso','box',(-3.13,.49,.35),(.51,.25,.17),'polymer','rear-brace'),
 ('grip-panel','Tactile polymer side strip','meso','box',(-1.28,-.82,.29),(.58,.97,.07),'grip-rubber','handgrip'),
 ('grip-stipple','Fine instanced grip microgroove detailing','meso','box',(-1.28,-.82,.32),(.52,.84,.04),'grip-rubber','grip-panel'),
 ('magazine-panel','Embossed rectangular side field','meso','box',(.15,-1.13,.29),(.75,1.26,.035),'polymer','magazine'),
 ('magazine-ridges','Evenly spaced molded magazine relief','meso','box',(.16,-1.15,.32),(.72,1.12,.022),'polymer','magazine'),
 ('magazine-base','Distinct tapered bottom polymer ledge','meso','box',(.37,-1.98,0),(1.04,.17,.61),'polymer','magazine'),
 ('fasteners','Small black original-location screw/pin heads','meso','cylinder',(.56,.75,.38),(.085,.085,.026),'dark-steel','receiver-upper'),
]
FEATURES=[
 ('rail-slot-rhythm','rail-teeth','ridge','Raised evenly spaced lime rail teeth'),
 ('handguard-longitudinal-slot','port-upper','hole','Upper negative-space ventilating apertures'),
 ('handguard-bottom-slots','port-lower','hole','Lower negative-space ventilating apertures'),
 ('rear-buffer-coupling','brace-buffer','seam','Rear brace connecting neck seam'),
 ('brace-end-stippling','brace-pad','ridge','Dark rear soft endpad texture'),
 ('selector-black-pin','selector-controls','fastener','Dark circular selector pin visible in photo'),
 ('receiver-joint','handguard-collar','seam','Black vertical handguard retaining band'),
 ('magazine-embossing','magazine-panel','linework','Vertical AMEND2 photo marking identity'),
 ('magazine-horizontal-ribs','magazine-ridges','ridge','Regular transverse polymer reinforcing ribs'),
 ('grip-checkering','grip-stipple','ridge','Fine anti-slip polymer detail'),
 ('ejection-cover-outline','ejection-side','contour','Rectangular stepped dark receiver inset'),
 ('ejection-latch-edge','ejection-latch','bevel','Small raised latch surface'),
 ('muzzle-perforations','muzzle-ports','hole','Visible muzzle tube port rhythm'),
 ('dark-muzzle-circular-edge','muzzle-annulus','bevel','Black circular front ring edge'),
 ('guard-negative-space','trigger-guard','hole','Actual opening in trigger perimeter'),
 ('receiver-green-gloss','receiver-upper','gloss','Specific bright lime coating material response'),
 ('reduced-green-magwell-seam','receiver-lower','seam','Oblique receiver magwell seam'),
 ('grip-ergo-contour','handgrip','contour','Photographed ergonomic grip rake and tip contour')
]

def build(spec):
    original=deepcopy(spec['componentTree'][0]); spec['componentTree']=[]
    for i,(pid,name,level,prim,pos,dims,mat,parent) in enumerate(PARTS):
        c=deepcopy(original)
        c.update(id=pid,name=name,level=level,role='visual-prop-surface',primitive=prim,
                 topologyClass='assembled-solid',topologyRationale='Separated hard-surface visual part, with 3D thickness and distinct materials; reference photo controls outline.',
                 confidence=.84 if level=='macro' else .65,
                 parent=parent,material=mat,materialLayers=[mat],fidelityTier='structural')
        c['dimensions']={'width':dims[0],'height':dims[1],'depth':dims[2],'units':'relative','confidence':.55}
        c['transform']={'position':list(pos),'rotation':[0,0,0],'scale':[1,1,1]}
        c['geometryDescriptor']['topologyIntent']='separate physical part with local bevel and section-dependent profile'
        c['geometryDescriptor']['edgeTreatment']={'type':'bevel','bevelRadius':.025,'segments':3}
        c['geometryDescriptor']['normalStrategy']='per-face hard-surface normals with small bevel'
        if parent:
            c['attachment']={'parentId':parent,'parentSocket':'joint','localStart':[0,0,0],
                 'localEnd':[0,.10,0],'contactType':'embedded solid junction',
                 'overlap':.025,'gapTolerance':.015,'evidenceRefs':['full-object']}
        rgb1,rgb2,mtype=COLORS[mat]
        c['colorMaterialRecipe']={'dominantAlbedo':rgb1,'secondaryAlbedo':rgb2,
                 'materialClass':mtype,'materialClassConfidence':.85 if mat=='lime-coat' else .7}
        c['localFeatures']=[{'id':fid,'name':desc,'kind':kind,'evidenceRefs':['full-object']}
                   for fid,owner,kind,desc in FEATURES if owner==pid]
        c['evidenceRefs']=['full-object'];c['importance']=.97 if level=='macro' else .65
        c['surfaceDetail'].update(macroRoughness=.07,microRoughness=.16,bumpAmplitude=.04,
             normalPattern='small-scale hard-surface micro-roughness',occlusionPattern='contact seams')
        spec['componentTree'].append(c)
    old=deepcopy(spec['materials'][0]);materials=[]
    for mid,(ca,cb,kind) in COLORS.items():
        m=deepcopy(old);m['id']=mid;m['name']={'lime-coat':'Original neon-lime exterior coating',
             'polymer':'Dark matte structural polymer','dark-steel':'Blackened metal and dark aperture interiors',
             'grip-rubber':'Fine textured rubber/pad'}[mid]
        palette={'lime-coat':['#a9f812','#73d011','#d0ff57'],
              'polymer':['#282b2e','#505152','#181b1e'],
              'dark-steel':['#1e2022','#5b5e60','#0d0f11'],
              'grip-rubber':['#202325','#3b3d3f','#151718']}[mid]
        m['baseColor']=m['color']=palette[0]
        m['albedo']={'dominant':palette[0],'secondary':palette[1:],
              'samplingNotes':'Reference-observed user source; do not average across lime versus black regions.'}
        m['colorVariation']['palette']=palette
        m['roughness']={'base':.48 if mid=='lime-coat' else (.56 if mid=='dark-steel' else .78),
                       'variation':.09,'map':'independent-reference-roughness','localResponse':'wear only at visibly raised edges'}
        m['metalness']={'base':.41 if kind=='metal' else .015,'variation':.025}
        m['localOverrides']=[{'id':mid+'-cavity-shading','name':'Local seams and contact AO','evidenceRefs':['full-object']},
                   {'id':mid+'-grazing-light','name':'Reference-constrained micro-roughness mask','evidenceRefs':['full-object']}]
        m['notes']='Material values are hypotheses pending upstream pixel PBR extraction, neutral-light browser review.'
        materials.append(m)
    spec['materials']=materials
    p=spec['preSpecAssessment'];o=p['objectClass'];o.update(primaryType='isolated short-barrelled neon green carbine visual prop',primaryDomain='object',
          formLanguage=['longitudinal lime vented housing','separate receiver volumes','angled polymer grip and magazine'],
          structureKind=['assembled hard-surface shells','polymer attachments','separate annular muzzle shell'],
          motionPotential=['static game prop', 'turntable orbit inspection'],
          materialFamilies=['bright coated metal','black polymer','rubber','blackened steel'],
          notes='Master input: original 840x301 extracted user photo. Generated six views are plausible but not measured.')
    cm=p['complexity'];cm['estimatedCounts']={'macroComponents':7,'mesoComponents':len(PARTS)-7,
            'microFeatureGroups':len(FEATURES),'materialLayers':4,'repetitionSystems':4}
    cm['reasoning']=['Image-specific part decomposition traced from original reference and six visual support hypotheses.',
                    'Hidden reverse face and cross-section remain low-confidence until compared against independent views.']
    p['detailInventory']['details']=[{'id':fid,'kind':kind,'name':desc,
          'mapsTo':{'ref':fid},'evidenceRefs':['full-object']} for fid,owner,kind,desc in FEATURES]
    p['unknownsToResolveBeforeImplementation']=[
       'Physical depth not measurable from original side image: generated opposite/top/bottom are hypothesis-only.',
       'Strict PBR map confidence must be independently extracted before final material-pass acceptance.']
    spec['repetitionSystems']=[
       {'id':'lime-top-rail', 'name':'Regular toothed upper-rail pattern','method':'procedural-instances','buildsGeometry':True,
        'geometry':{'primitive':'box','count':72},'instances':72,'componentRefs':['rail-teeth'],'notes':'Raised teeth must remain 3D.'},
       {'id':'vent-bands','name':'Reference-aligned side openings pattern','method':'procedural-instances','buildsGeometry':True,
        'geometry':{'primitive':'box','count':6},'instances':6,'componentRefs':['port-upper','port-lower'],
        'notes':'Replaced with true open-wall geometry during sculpt refinement; dark boxes alone do not pass.'},
       {'id':'grip-stippling','name':'Visible small-scale grip relief','method':'procedural-instances','buildsGeometry':True,
        'geometry':{'primitive':'box','count':144},'instances':144,'componentRefs':['grip-stipple']},
       {'id':'polymer-ribs','name':'Magazine molded rib details','method':'procedural-instances','buildsGeometry':True,
        'geometry':{'primitive':'box','count':14},'instances':14,'componentRefs':['magazine-ridges']}
    ]
    spec['featureReviewTargets']=[
       {'id':'lime-original-silhouette','name':'Original cutout matches lengths and proportions','tier':'critical',
        'passIds':['blockout','form-refinement'],'minimumScore':.93,'mustPass':True,
        'componentRefs':['rear-brace','receiver-upper','fore-end','magazine','handgrip'],'evidenceRefs':['full-object']},
       {'id':'green-black-zone-fidelity','name':'Exact neon-lime color segmentation against black attachments','tier':'critical',
        'passIds':['material-pass','surface-pass'],'minimumScore':.92,'mustPass':True,
        'componentRefs':['receiver-upper','fore-end','handgrip','magazine'],'evidenceRefs':['full-object']},
       {'id':'six-view-volume','name':'Handguard width, muzzle bore and opposite-side coherence','tier':'important',
        'passIds':['structural-pass','form-refinement'],'minimumScore':.87,'mustPass':True,
        'componentRefs':['fore-end','barrel-front','rear-brace'],'evidenceRefs':['full-object']},
       {'id':'source-microdetail','name':'Original magazine embossed text, rail and vent geometry','tier':'important',
        'passIds':['form-refinement','surface-pass'],'minimumScore':.85,'mustPass':True,
        'componentRefs':['magazine-panel','rail-teeth','port-upper','port-lower'],'evidenceRefs':['full-object']}
    ]
    spec['lightingFromPhoto']=[
        {'role':'key light','type':'area-softbox','intensity':2.1,'color':'#ffffff','direction':[-.4,.7,1.0],
         'toneMapping':'ACES Filmic','exposure':1.0},
        {'role':'fill light','type':'hemisphere','intensity':.8,'color':'#f1f3fa','direction':[.4,.4,.2],
         'background':'neutral gray'},
        {'role':'rim and ground shadow','type':'directional','intensity':.7,'color':'#f8fafc',
         'direction':[-.1,.2,-1], 'contactShadow':'soft contact shadow with no floating parts'}
    ]
    spec['silhouette'].update(boundingShape='Long left-brace to right-muzzle axis with downward grip and angled magazine',
        aspectRatios=[11/3.94],symmetry='approx bilateral along barrel X axis, asymmetrical surface buttons',
        dominantCurves=['angled pistol grip','outboard magazine rake','beveled brace end'],
        negativeSpaces=['real trigger guard opening','handguard through-vents'],
        landmarks=['brace tip left','lime receiver center','black grip descending left','AMEND2 magazine descending right','top continuous rail','short black muzzle right'])
    spec['viewEvidence'].append({'id':'supporting-six-generated','view':'six lower confidence AI-generated views',
      'imageRegion':{'x':0,'y':0,'width':1,'height':1,'units':'normalized'},
      'observations':['Imported auxiliary left, right, muzzle, brace, top and bottom image probes; hypotheses only'],
      'confidence':.35})
    spec['qualityTargets']['targetFidelity']=.96  # aspiration, not evaluated visual score
    spec['qualityTargets']['reviewViewpoints']=['original-facing','front-3/4','muzzle','reverse','brace','top','bottom']
    spec['proceduralStrategy'].append('Do not mark passes accepted automatically: require Chromium screenshots and explicit visual review.')
    spec['proceduralStrategy'].append('Never rebuild working preview from a failed strict validation spec.')
    return spec

def main():
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    spec=json.loads(a.source.read_text());d=build(spec)
    a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(d,indent=2,ensure_ascii=False)+'\n')
    print(f'Authored {len(d["componentTree"])} subject-specific components, {len(d["materials"])} material families, {len(FEATURES)} reference linked detail features; upstream validator remains authoritative')
if __name__=='__main__':main()