'use strict';
/**
 * Exports a genuine OpenStreetMap XML file consumable by the Unreal StreetMap
 * importer that WorldBLD/CityBLD documents as an input to its NATIVE toolchain.
 * Synthetic geometry, NOT scraped OSM data. Rendering still requires CityBLD.
 */
const fs = require('node:fs');
const path = require('node:path');
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'city-block-plan.json'), 'utf8'));
const output = process.argv[2] || path.join(__dirname, 'worldbld-city-block.osm');
const originLat = 45.0; // Synthetic WGS84 origin: NOT an actual mapped city.
const originLon = 9.0;
const R = 6378137;
const xmlEscape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const nodes = new Map(), ways = [];
let nextId = -1;
const coordToLatLon = pt => {
  const [x, y] = pt.map(v => v / 100); // UE cm -> meters
  return [originLat + y/R*180/Math.PI, originLon + x/(R*Math.cos(originLat*Math.PI/180))*180/Math.PI];
};
const getNode = pt => {
  const key = pt.join(',');
  if (!nodes.has(key)) {
    const id = nextId--;
    nodes.set(key, {id, latlon:coordToLatLon(pt)});
  }
  return nodes.get(key).id;
};
const addWay=(points, tags)=>{
  const id = nextId--;
  const refs=points.map(getNode);
  ways.push({id, refs, tags});
};
for(const rd of spec.roads){
  addWay([rd.from,rd.to],{
    highway:'residential',lanes:String(rd.vehicle_lanes),
    surface:'asphalt',sidewalk:'both',
    name:'WorldBLD '+rd.id+' street',note:'synthetic geometry; worldbld test input'
  });
}
const buildings=[
  [2000,2100,4500,4500,3,'residential'],
  [5700,2100,8200,4500,4,'retail'],
  [9400,2100,11900,4500,4,'residential'],
  [13100,2100,15600,4500,5,'retail'],
  [2500,11500,5000,13900,3,'residential'],
  [6200,11500,8700,13900,4,'residential'],
  [9900,11500,12400,13900,3,'retail'],
  [13600,11500,16100,13900,5,'residential'],
  [17400,5500,19800,7800,4,'residential'],
  [17400,8900,19800,11200,4,'residential'],
];
for (const [x1,y1,x2,y2,floors,use] of buildings){
  if (!(x1<x2 && y1<y2 && x1>=1800 && y1>=1800 && x2<=20200 && y2<=14200)) throw Error('Building violates sidewalk setback');
  addWay([[x1,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1]], {
    building:use, 'building:levels':String(floors),
    'source:geometry':'synthetic worldbld CI input'
  });
}
const all=[...nodes.values()].map(x=>x.latlon);
const latitudes=all.map(a=>a[0]),longitudes=all.map(a=>a[1]);
const xmin=Math.min(...longitudes), xmax=Math.max(...longitudes),
      ymin=Math.min(...latitudes), ymax=Math.max(...latitudes);
const tags=(tags)=>Object.entries(tags).map(([k,v])=>'    <tag k="'+xmlEscape(k)+'" v="'+xmlEscape(v)+'"/>').join('\n');
const text=[
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<osm version="0.6" generator="WorldBLD-native-plan-ci">',
  '  <bounds minlat="'+ymin.toFixed(8)+'" minlon="'+xmin.toFixed(8)+'" maxlat="'+ymax.toFixed(8)+'" maxlon="'+xmax.toFixed(8)+'"/>',
  ...[...nodes.values()].map(n=>'  <node id="'+n.id+'" visible="true" lat="'+n.latlon[0].toFixed(8)+'" lon="'+n.latlon[1].toFixed(8)+'"/>'),
  ...ways.map(w=>'  <way id="'+w.id+'" visible="true">\n'+w.refs.map(ref=>'    <nd ref="'+ref+'"/>').join('\n')+'\n'+tags(w.tags)+'\n  </way>'),
  '</osm>', ''
].join('\n');
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,text);
console.log(JSON.stringify({output,roads:spec.roads.length,buildings:buildings.length,
  valid_synthetic_streetmap:true, citybld_generation_executed:false, gpu_used:false},null,2));
