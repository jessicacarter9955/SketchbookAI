// Camera positions are saved relative to live urban NPCs, so they remain valid
// when procedural city seeds and block sizes change.
export const URBAN_CAPTURE_VIEWS = Object.freeze([
  {name:'urban-population-traffic',kind:'pair',offset:[17,12,20],fov:52},
  {name:'urban-population-dialogue',kind:'dialogue',offset:[4,3.2,8],fov:39},
  {name:'urban-population-crosswalk',kind:'pedestrian',offset:[9,7,13],fov:47},
  {name:'urban-population-pedestrian',kind:'pedestrian',offset:[5,2.8,7.5],fov:43},
  {name:'urban-population-vehicles',kind:'car',offset:[8,3.7,12],fov:48},
  {name:'urban-population-overview',kind:'anchor',offset:[32,28,35],fov:55}
]);
export function validateUrbanCaptureViews(views=URBAN_CAPTURE_VIEWS){
  const names=new Set();
  for(const v of views){
    if(!v?.name||names.has(v.name)||!['pair','pedestrian','car','anchor','dialogue'].includes(v.kind))throw new Error('Invalid camera preset '+v?.name);
    if(!Array.isArray(v.offset)||v.offset.length!==3||v.offset.some(n=>!Number.isFinite(n)))throw new Error('Invalid camera offset '+v.name);
    if(v.fov<20||v.fov>90)throw new Error('Invalid camera FOV '+v.name);
    names.add(v.name);
  }
  return true;
}
