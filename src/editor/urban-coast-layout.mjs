// Deterministic east-coast extension for the original procedural boulevard.
// No Unreal/Sketchfab asset is substituted: the beach is explicitly procedural.
export function miamiCoastLayout(bounds,seed=42) {
  const width=bounds.maxX-bounds.minX, depth=bounds.maxZ-bounds.minZ;
  if(!Number.isFinite(width)||!Number.isFinite(depth)||width<=0||depth<=0)throw Error('Invalid urban coastal bounds');
  const beachStart=bounds.maxX+8,beachWidth=82,shoreX=beachStart+beachWidth;
  const palmX=bounds.maxX+22,spacing=15;
  const palms=[];
  for(let z=bounds.minZ+12;z<=bounds.maxZ-12;z+=spacing){
    const v=Math.sin(seed*.19+z*.31);
    palms.push({x:palmX+Math.sin(z*.17+seed)*1.2,z:z+v*.8,scale:.88+(v+1)*.14});
  }
  return {
    beachStart,beachWidth,beachCenter:beachStart+beachWidth/2,
    beachDepth:depth+95,shoreX,palms,
    seaCenter:shoreX+340,seaWidth:680,seaDepth:depth+850
  };
}
