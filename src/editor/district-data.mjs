// Four connected, non-uniform urban districts. Pure data: reproducible and testable without WebGL.
// No Rockstar or licensed Unreal geometry is embedded in this generator.
export const DISTRICT_PRESET = Object.freeze({
  seed: 1847, sky:'day',
  districts:[
    {id:'ny',name:'New York · Downtown',center:[-165,-172],cell:43,extent:[302,278],floors:[9,32],theme:'metro'},
    {id:'sf',name:'San Francisco · Hills',center:[165,-172],cell:55,extent:[302,278],floors:[2,7],theme:'hills'},
    {id:'rio',name:'Rio · Tropical Coast',center:[-165,113],cell:49,extent:[302,220],floors:[3,13],theme:'tropical'},
    {id:'miami',name:'Miami · Beachfront',center:[165,113],cell:52,extent:[302,220],floors:[4,16],theme:'artdeco'}
  ]
});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
export function districtHash(a,b,seed=1847){
 let h=(Math.imul((a|0)+374761393,668265263)^Math.imul((b|0)+1442695041,1274126177)^Math.imul(seed,1597334677))|0;
 h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;
}
export function districtGround(x,z){
 const coast=228+10*Math.sin(x*.012);
 const inlet=(Math.abs(x)<47&&z>60)?1:0;
 if(inlet)return -7;
 const fade=1-smooth(coast-32,coast+20,z);
 const h=x>0&&z<0 ? (4+8*smooth(-300,-65,z)+7*Math.sin((x-10)*.014)*Math.cos(z*.012)) :
  x<0&&z>0 ? 2+3*Math.sin(x*.017)*Math.cos(z*.022):1.5;
 return -7+fade*(8+Math.max(0,h));
}
export const districtIsLand=(x,z)=>districtGround(x,z)>0.15;
function road(a,b,id,kind='local',width=10){
 const distance=Math.hypot(b[0]-a[0],b[1]-a[1]);
 if(distance<1)return null;
 return {id,kind,width,a:{x:a[0],z:a[1]},b:{x:b[0],z:b[1]},length:distance};
}
export function generateDistrictPlan(config=DISTRICT_PRESET){
 const seed=Number.isInteger(config.seed)?config.seed:DISTRICT_PRESET.seed;
 const zones=DISTRICT_PRESET.districts,roads=[],buildings=[],plants=[],beaches=[],spawns=[],routes=[],pedRoutes=[];
 for(const [di,d] of zones.entries()){
   const [cx,cz]=d.center,[w,h]=d.extent;
   const nx=Math.floor(w/d.cell),nz=Math.floor(h/d.cell),x0=cx-nx*d.cell/2,z0=cz-nz*d.cell/2;
   const streetsX=Array.from({length:nx+1},(_,i)=>x0+i*d.cell);
   const streetsZ=Array.from({length:nz+1},(_,i)=>z0+i*d.cell);
   for(let i=0;i<=nx;i++){
     const x=streetsX[i];
     for(let j=0;j<nz;j++){
       const za=streetsZ[j],zb=streetsZ[j+1],middle=(za+zb)/2;
       if(districtIsLand(x,middle)&&districtIsLand(x,za+2)&&districtIsLand(x,zb-2))
         roads.push(road([x,za],[x,zb],d.id+'-v-'+i+'-'+j,i===Math.floor(nx/2)?'avenue':'local',i===Math.floor(nx/2)?14:9.5));
     }
   }
   for(let j=0;j<=nz;j++){
     const z=streetsZ[j];
     for(let i=0;i<nx;i++){
       const xa=streetsX[i],xb=streetsX[i+1],mid=(xa+xb)/2;
       if(districtIsLand(mid,z)&&districtIsLand(xa+2,z)&&districtIsLand(xb-2,z))
         roads.push(road([xa,z],[xb,z],d.id+'-h-'+i+'-'+j,j===Math.floor(nz/2)?'avenue':'local',j===Math.floor(nz/2)?14:9.5));
     }
   }
   for(let i=0;i<nx;i++)for(let j=0;j<nz;j++){
     const x=x0+(i+.5)*d.cell,z=z0+(j+.5)*d.cell;
     if(!districtIsLand(x,z)||!districtIsLand(x+d.cell*.35,z+d.cell*.35))continue;
     const sample=districtHash(i+di*79,j,seed),park=sample<.105;
     const size=d.cell-16;
     if(!park){
       const count=sample>.66?2:1;
       for(let sub=0;sub<count;sub++){
         const bx=x+(count===2?(sub?1:-1)*size*.235:0);
         const bw=size*(count===2?.44:.82),bd=size*(.75+districtHash(i,j+sub+312,seed)*.16);
         const floors=Math.round(d.floors[0]+districtHash(i*17+sub,j*19,seed)* (d.floors[1]-d.floors[0]));
         buildings.push({id:d.id+'-'+i+'-'+j+'-'+sub,district:d.id,theme:d.theme,
           x:bx,z,w:bw,d:bd,floors,height:floors*3.1,roofVariant:districtHash(i+sub*23,j,seed+39),
           tint:districtHash(i+123,j+di*39+sub,seed)});
       }
     }
     const canopy=d.theme==='hills'?'cypress':d.theme==='metro'?'plane':d.theme==='artdeco'?'palm':'tropical';
     if(park)for(const sx of [-1,0,1])for(const sz of [-1,0,1])
       plants.push({x:x+sx*size*.26,z:z+sz*size*.26,type:canopy,scale:.9+districtHash(i+sx,j+sz,seed)*.65});
     else if(j%2===0)for(const side of [-1,1])
       plants.push({x:x+side*(d.cell/2-6),z,type:canopy,scale:.9+districtHash(i+side,j,seed)*.25});
     if(park)pedRoutes.push([[x-size*.3,z-size*.3],[x+size*.3,z-size*.3],[x+size*.3,z+size*.3],[x-size*.3,z+size*.3]]);
   }
   const corners=[[streetsX[1],streetsZ[1]],[streetsX[nx-1],streetsZ[1]],
      [streetsX[nx-1],streetsZ[Math.max(1,nz-1)]],[streetsX[1],streetsZ[Math.max(1,nz-1)]]];
   if(corners.every(([x,z])=>districtIsLand(x,z))){
     routes.push({district:d.id,points:corners});
     pedRoutes.push(corners.map(([x,z])=>[x+(x<cx?5:-5),z+(z<cz?5:-5)]));
   }
   const sp=streetsX[Math.floor(nx/2)],zp=streetsZ[Math.floor(nz/2)];
   spawns.push({id:'district-'+d.id,name:d.name,position:[sp+4,districtGround(sp+4,zp)+.9,zp]});
 }
 // Cross-district arterial roads make this ONE city, not four disconnected examples.
 // They overlap the end strips of each local road grid to avoid wheel-sized gaps.
 for(const [a,b,id,width] of [
  [[-65,-172],[65,-172],'ny-to-sf',17],
  [[-165,-51],[-165,19],'ny-to-rio',14],
  [[165,-42],[165,17],'sf-to-miami',14]
 ])roads.push(road(a,b,id,'avenue',width));
 routes.push({district:'crosstown',points:[
   [-165,-172],[-65,-172],[65,-172],[165,-172],
   [65,-172],[-65,-172]
 ]});
 // The channel is a real water inlet; bridges are road decks with collision, not floating decoration.
 const deck=[[-116,125],[-73,125],[-42,125],[0,125],[42,125],[73,125],[116,125]];
 const bridge=road(deck[0],deck[deck.length-1],'bay-viaduct','bridge',18);
 bridge.deck=deck;bridge.rise=9;roads.push(bridge);
 routes.push({district:'bridge',points:[...deck,...deck.slice(1,-1).reverse()]});
 spawns.push({id:'district-bay-viaduct',name:'Viadotto sopra la baia',position:[0,10.6,125]});
 for(const x of [-220,-120,90,210])beaches.push({x,z:214,width:72,depth:28});
 return {config:{seed,sky:config.sky||'day'},zones,roads:roads.filter(Boolean),buildings,plants,beaches,routes,pedRoutes,spawns,
   bounds:{minX:-350,maxX:350,minZ:-350,maxZ:265},bridge};
}
export function districtDeckHeight(x,z){
 // Deck is 9m over the water, with approach ramps blending to the shore.
 if(Math.abs(z-125)>11||Math.abs(x)>116)return null;
 const a=Math.abs(x);
 return a<73?9.7:9.7-(a-73)/43*(9.7-districtGround(Math.sign(x)*116,z)-.24);
}
