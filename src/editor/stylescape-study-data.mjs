import {islandNoise} from './island-data.mjs';

// A separate six-biome CC0 landscape study *inspired by* Stylescape HD.
// The commercial UE package and its demonstration files are NOT distributed.
export const STYLESCAPE_SOURCE='https://cosmos.leartesstudios.com/environments/stylescape-stylized-hd-environment-kit';
export const STYLESCAPE_SIZE=208;
export const STYLESCAPE_BIOMES=[
  {id:'grassland',name:'Grassland · Prateria',col:0,row:0,texture:'leafy_grass',peak:7,trees:9,rocks:4},
  {id:'forest',name:'Forest · Bosco',col:1,row:0,texture:'forrest_ground_01',peak:14,trees:52,rocks:11},
  {id:'alpine',name:'Alpine · Montagna',col:2,row:0,texture:'mossy_rock',peak:39,trees:20,rocks:35},
  {id:'tropical',name:'Tropical · Valle tropicale',col:0,row:1,texture:'grass_ground',peak:16,trees:38,rocks:15},
  {id:'desert',name:'Desert Canyon · Canyon',col:1,row:1,texture:'sand_03',peak:28,trees:0,rocks:45},
  {id:'snow',name:'Alpine Snow · Neve',col:2,row:1,texture:'snow_02',peak:36,trees:23,rocks:26}
];
const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};

export function stylescapeLayout(bounds){
  if(!bounds||![bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ].every(Number.isFinite)||
    bounds.maxX<=bounds.minX||bounds.maxZ<=bounds.minZ)throw Error('Invalid city bounds for landscape study');
  const baseX=bounds.maxX+1240,baseZ=(bounds.minZ+bounds.maxZ)/2-STYLESCAPE_SIZE/2;
  const tiles=STYLESCAPE_BIOMES.map(b=>({...b,
    x:baseX+b.col*STYLESCAPE_SIZE,z:baseZ+b.row*STYLESCAPE_SIZE,
    size:STYLESCAPE_SIZE}));
  const minX=baseX-STYLESCAPE_SIZE/2,maxX=baseX+2.5*STYLESCAPE_SIZE;
  const minZ=baseZ-STYLESCAPE_SIZE/2,maxZ=baseZ+1.5*STYLESCAPE_SIZE;
  return {tiles,center:[(minX+maxX)/2,(minZ+maxZ)/2],bounds:{minX,maxX,minZ,maxZ},
    width:maxX-minX,depth:maxZ-minZ,source:STYLESCAPE_SOURCE,originalKit:false};
}
export function stylescapeTileAt(layout,x,z){
  if(!layout||!Number.isFinite(x)||!Number.isFinite(z))return null;
  return layout.tiles.find(t=>Math.abs(x-t.x)<=t.size/2+1e-7&&
    Math.abs(z-t.z)<=t.size/2+1e-7)||null;
}
export function stylescapeHeight(tile,x,z){
  if(!tile)return null;
  const dx=x-tile.x,dz=z-tile.z,s=tile.size/2;
  if(Math.abs(dx)>s+.0001||Math.abs(dz)>s+.0001)return null;
  const n=(islandNoise(x*.026,z*.026,812)-.5)*2;
  const n2=(islandNoise(x*.07,z*.07,314)-.5)*2;
  const r=Math.hypot(dx,dz),edge=Math.min(1,(s-Math.max(Math.abs(dx),Math.abs(dz)))/18);
  const central=smooth((r-22)/18);
  const variation=(Math.sin(dx*.043+tile.col*.9)*Math.cos(dz*.035+tile.row)
      *tile.peak*.32+(n*.62+n2*.16)*tile.peak);
  const rolling=tile.peak*.24*(Math.sin(dx*.018+tile.row*2.6)+1)*.5;
  return 5+Math.max(-2,rolling+variation)*smooth(edge)*central;
}
export function stylescapeGroundAt(layout,x,z){
  const tile=stylescapeTileAt(layout,x,z);return tile?stylescapeHeight(tile,x,z):null;
}
export function stylescapeSpawns(layout){
  return layout.tiles.map(t=>({id:'stylescape-'+t.id,
    name:'Stylescape study · '+t.name,position:[t.x,stylescapeHeight(t,t.x,t.z)+.4,t.z]}));
}
export function stylescapePlacement(tile,count,seed=0){
  const out=[];const pad=12;let i=0;
  while(out.length<count&&i<count*12+120){
    const k=i++,a=Math.sin((k+1)*12.9898+seed*3.7+tile.col*13+tile.row*71)*43758.5453;
    const b=Math.sin((k+1)*78.233+seed*5.1+tile.col*37+tile.row*11)*74327.9789;
    const fx=a-Math.floor(a),fz=b-Math.floor(b),x=tile.x+(fx-.5)*(tile.size-2*pad),z=tile.z+(fz-.5)*(tile.size-2*pad);
    if(Math.hypot(x-tile.x,z-tile.z)<25)continue; // Spawn remains unobstructed
    const y=stylescapeHeight(tile,x,z);
    const scale=.8+(fx*.48);
    out.push({x,y,z,scale});
  }
  return out;
}
