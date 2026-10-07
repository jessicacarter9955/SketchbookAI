const isFinitePair = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const deg = Math.PI / 180;

function flattenCoords(features) {
  const out=[];
  const visit=v=>{
    if(isFinitePair(v) && typeof v[0]==='number' && typeof v[1]==='number') { out.push([v[0],v[1]]); return; }
    if(Array.isArray(v)) v.forEach(visit);
  };
  features.forEach(f=>visit(f?.geometry?.coordinates));
  return out;
}

function projector(features) {
  const pts=flattenCoords(features); if(!pts.length) throw new Error('GeoJSON senza coordinate valide.');
  const lon=pts.reduce((s,p)=>s+p[0],0)/pts.length, lat=pts.reduce((s,p)=>s+p[1],0)/pts.length;
  const geographic=Math.abs(lon)<=180 && Math.abs(lat)<=90;
  if(!geographic) return ([x,z])=>[x-lon,z-lat];
  const cos=Math.cos(lat*deg), meters=111320;
  return ([x,z])=>[(x-lon)*meters*cos,(z-lat)*meters];
}

const highwayWidth = props => {
  const lanes=Math.max(1,Math.min(8,Number(props?.lanes)||0));
  if(lanes) return Math.max(5.5,lanes*3.2);
  const kind=String(props?.highway||props?.road||'').toLowerCase();
  return /motorway|trunk/.test(kind)?13:/primary|secondary/.test(kind)?10:/residential|tertiary/.test(kind)?7:6;
};

function roadSegments(coords, project, props) {
  const result=[], width=highwayWidth(props);
  for(let i=1;i<coords.length;i++){
    if(!isFinitePair(coords[i-1])||!isFinitePair(coords[i])) continue;
    const [ax,az]=project(coords[i-1]),[bx,bz]=project(coords[i]);
    const dx=bx-ax,dz=bz-az,length=Math.hypot(dx,dz); if(length<1) continue;
    result.push({
      prefab:'road', name:String(props?.name||props?.highway||'Strada OSM').slice(0,120),
      position:[(ax+bx)/2,.02,(az+bz)/2], rotation:[0,Math.atan2(dx,dz),0],
      scale:[width/8,1,length/16], collider:false
    });
  }
  return result;
}

function buildingFromRing(ring, project, props) {
  const pts=ring.filter(isFinitePair).map(project); if(pts.length<3) return null;
  const xs=pts.map(p=>p[0]),zs=pts.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
  const w=maxX-minX,d=maxZ-minZ; if(w<1||d<1)return null;
  const levels=Math.max(1,Math.min(40,Number(props?.['building:levels'])||Number(props?.levels)||Math.round(2+(w+d)/18)));
  return {
    prefab:'building', name:String(props?.name||props?.building||'Edificio OSM').slice(0,120),
    position:[(minX+maxX)/2,0,(minZ+maxZ)/2], rotation:[0,0,0],
    scale:[Math.max(.15,w/8),Math.max(.15,(levels*3.15)/12),Math.max(.15,d/8)], collider:true
  };
}

export function geoJSONToPrefabs(data,{maxObjects=450}={}) {
  if(!data || data.type!=='FeatureCollection' || !Array.isArray(data.features)) throw new Error('Serve un GeoJSON FeatureCollection.');
  const project=projector(data.features), objects=[];
  const push=o=>{ if(o && objects.length<maxObjects) objects.push(o); };
  for(const feature of data.features){
    if(objects.length>=maxObjects) break;
    const g=feature?.geometry,p=feature?.properties||{}; if(!g)continue;
    const isRoad=!!(p.highway||p.road||p.transportation)||String(p.type||'').toLowerCase()==='road';
    const isBuilding=!!(p.building||p['building:levels'])||String(p.type||'').toLowerCase()==='building';
    if(g.type==='LineString' && isRoad) roadSegments(g.coordinates,project,p).forEach(push);
    else if(g.type==='MultiLineString' && isRoad) g.coordinates.forEach(line=>roadSegments(line,project,p).forEach(push));
    else if(g.type==='Polygon' && isBuilding) push(buildingFromRing(g.coordinates[0]||[],project,p));
    else if(g.type==='MultiPolygon' && isBuilding) g.coordinates.forEach(poly=>push(buildingFromRing(poly[0]||[],project,p)));
  }
  if(!objects.length) throw new Error('Nessuna strada/edificio riconosciuto. Usa dati OSM con highway/building.');
  return {objects, truncated:objects.length>=maxObjects};
}
