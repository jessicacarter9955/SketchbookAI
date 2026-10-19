// Four-sided Miami-style island rim around the ORIGINAL urban road grid.
// Plan coordinates remain unchanged: only terrain outside its bounds is added.
export function miamiCoastLayout(bounds,seed=42){
  const width=bounds.maxX-bounds.minX,depth=bounds.maxZ-bounds.minZ;
  if(![width,depth,bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ].every(Number.isFinite)||
     width<=0||depth<=0)throw Error('Invalid urban coastal bounds');
  const beachWidth=82,margin=8,spacing=16,cx=(bounds.minX+bounds.maxX)/2,cz=(bounds.minZ+bounds.maxZ)/2;
  const start={east:bounds.maxX+margin,west:bounds.minX-margin,north:bounds.minZ-margin,south:bounds.maxZ+margin};
  const sides=[
    {name:'east',axis:'x',sign:1,shore:start.east+beachWidth,center:[start.east+beachWidth/2,cz],size:[beachWidth,depth+2*(margin+beachWidth)]},
    {name:'west',axis:'x',sign:-1,shore:start.west-beachWidth,center:[start.west-beachWidth/2,cz],size:[beachWidth,depth+2*(margin+beachWidth)]},
    {name:'north',axis:'z',sign:-1,shore:start.north-beachWidth,center:[cx,start.north-beachWidth/2],size:[width+2*margin,beachWidth]},
    {name:'south',axis:'z',sign:1,shore:start.south+beachWidth,center:[cx,start.south+beachWidth/2],size:[width+2*margin,beachWidth]}
  ];
  for(const side of sides){
    side.palms=[];
    const lo=side.axis==='x'?bounds.minZ+12:bounds.minX+12;
    const hi=side.axis==='x'?bounds.maxZ-12:bounds.maxX-12;
    for(let along=lo;along<=hi;along+=spacing){
      const wobble=Math.sin(seed*.19+along*.31),shift=Math.sin(along*.17+seed)*1.2;
      const fixed=(side.axis==='x'?(side.sign===1?start.east+17:start.west-17):
        (side.sign===1?start.south+17:start.north-17))+shift;
      side.palms.push({x:side.axis==='x'?fixed:along+wobble*.8,
        z:side.axis==='z'?fixed:along+wobble*.8,
        scale:.88+(wobble+1)*.14,side:side.name});
    }
  }
  const east=sides[0],allPalms=sides.flatMap(side=>side.palms);
  return {beachStart:start.east,beachWidth,beachCenter:east.center[0],
    beachDepth:east.size[1],shoreX:east.shore,palms:east.palms,
    seaCenter:east.shore+340,seaWidth:680,seaDepth:depth+850,
    sides,allPalms,waterCenter:[cx,cz],waterSize:[width+1700,depth+1700]};
}
