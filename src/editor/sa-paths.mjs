// SanAndreasUnity-compatible nodes*.dat records; bring your own legal game data.
const assert=(condition,message)=>{if(!condition)throw Error('San Andreas nodes: '+message);};
export function parseSanAndreasNodeFile(buffer,sectorId){
  assert(Number.isInteger(sectorId)&&sectorId>=0&&sectorId<64,'invalid sector');
  const bytes=buffer instanceof ArrayBuffer?buffer:buffer instanceof Uint8Array?
    buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength):null;
  assert(bytes?.byteLength>=20,'truncated header');
  const v=new DataView(bytes);let o=0;
  const check=n=>assert(o+n<=v.byteLength,'truncated at '+o);
  const u8=()=>{check(1);return v.getUint8(o++);};
  const i16=()=>{check(2);const n=v.getInt16(o,true);o+=2;return n;};
  const u16=()=>{check(2);const n=v.getUint16(o,true);o+=2;return n;};
  const u32=()=>{check(4);const n=v.getUint32(o,true);o+=4;return n;};
  const total=u32(),cars=u32(),peds=u32(),navs=u32(),links=u32();
  assert(total===cars+peds,'node header count mismatch');
  assert(total<=200000&&navs<=200000&&links<=1000000,'oversized table');
  assert(20+total*28+navs*14+links*4+768+navs*2+links*2<=v.byteLength,'truncated binary data');
  const nodes=[];
  for(let i=0;i<total;i++){
    u32();u32();
    const x=i16()/8,z=i16()/8,y=i16()/8,marker=i16();
    assert(marker===0x7ffe,'bad node marker');
    const baseLinkId=u16(),areaId=u16(),nodeId=u16(),pathWidth=u8()/8,nodeType=u8(),flags=u32();
    nodes.push({x,y,z,baseLinkId,areaId,nodeId,pathWidth,nodeType,
      kind:i<cars?'vehicle':'pedestrian',linkCount:flags&15,
      emergencyOnly:!!(flags&256),isWater:!!(flags&128),
      roadBlock:!!(flags&64),trafficLevel:(flags>>4)&3,isHighway:!(flags&4096)});
  }
  const navigation=[];
  for(let i=0;i<navs;i++){
    const x=i16(),z=i16(),targetAreaId=u16(),targetNodeId=u16(),
      dx=(u8()<<24)>>24,dz=(u8()<<24)>>24,width=u8()/8,flags=u8(),traffic=u8(),extra=u8();
    navigation.push({x,z,targetAreaId,targetNodeId,dx,dz,width,
      leftLanes:flags&7,rightLanes:(flags>>3)&7,trafficLightBehavior:traffic&3,
      trainCrossing:!!(traffic&4),extra});
  }
  const references=[];
  for(let i=0;i<links;i++)references.push({areaId:u16(),nodeId:u16()});
  check(768);o+=768;
  for(let i=0;i<navs;i++)navigation[i].nodeLink=u16()&1023;
  for(let i=0;i<links;i++)references[i].rawLength=u8();
  for(let i=0;i<links;i++)references[i].intersectionFlags=u8();
  assert(nodes.every(n=>n.baseLinkId+n.linkCount<=references.length),'node links out of bounds');
  return {sectorId,nodes,links:references,navigation,counts:{cars,peds,navs,links}};
}
export function buildSanAndreasNetwork(sectors,kind='pedestrian'){
  assert(['pedestrian','vehicle'].includes(kind),'bad network type');
  const byKey=new Map();
  for(const sector of sectors)for(const n of sector.nodes){
    if(n.kind!==kind||n.isWater)continue;
    const key=n.areaId+':'+n.nodeId;
    assert(!byKey.has(key),'duplicate node '+key);
    byKey.set(key,{...n,key,edges:[]});
  }
  for(const sector of sectors)for(const n of sector.nodes){
    if(n.kind!==kind||n.isWater)continue;
    const from=byKey.get(n.areaId+':'+n.nodeId);
    for(let i=0;i<n.linkCount;i++){
      const link=sector.links[n.baseLinkId+i],dest=link&&byKey.get(link.areaId+':'+link.nodeId);
      if(!dest||from===dest)continue;
      from.edges.push({to:dest.key,
        length:Math.hypot(from.x-dest.x,from.y-dest.y,from.z-dest.z),
        type:kind==='pedestrian'?'sidewalk':'lane',
        intersectionFlags:link.intersectionFlags});
    }
  }
  return {kind,nodes:[...byKey.values()],byKey};
}
