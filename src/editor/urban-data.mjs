export const DEFAULT_URBAN = {
  seed: 42,
  blocksX: 6,
  blocksZ: 6,
  blockSize: 42,
  roadWidth: 12,
  sidewalkWidth: 2.5,
  minFloors: 2,
  maxFloors: 18,
  buildingDensity: 0.82,
  terrain: 'flat',
  sky: 'day'
};

const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
const hash=(x,z,seed)=>{
  let h=Math.imul(x+374761393,668265263)^Math.imul(z+1442695041,1274126177)^Math.imul(seed,1597334677);
  h=Math.imul(h^(h>>>13),1274126177); return ((h^(h>>>16))>>>0)/4294967295;
};
export { hash as urbanHash };

export function validateUrban(value=DEFAULT_URBAN){
  const v={...DEFAULT_URBAN,...value};
  if(!Number.isInteger(v.seed)||v.seed<0||v.seed>2147483647) throw new Error('Seed urbano non valido.');
  for(const [key,min,max] of [['blocksX',2,18],['blocksZ',2,18],['minFloors',1,25],['maxFloors',1,50]])
    if(!Number.isInteger(v[key])||v[key]<min||v[key]>max) throw new Error(`${key} fuori intervallo.`);
  for(const [key,min,max] of [['blockSize',24,100],['roadWidth',6,30],['sidewalkWidth',0,8],['buildingDensity',0.15,1]])
    if(!Number.isFinite(v[key])||v[key]<min||v[key]>max) throw new Error(`${key} fuori intervallo.`);
  if(v.minFloors>v.maxFloors) throw new Error('minFloors deve essere <= maxFloors.');
  if(v.roadWidth+v.sidewalkWidth*2>=v.blockSize*.75) throw new Error('Strada e marciapiedi troppo larghi rispetto all\'isolato.');
  if(!['flat','rolling'].includes(v.terrain)||!['day','sunset','haze'].includes(v.sky)) throw new Error('Preset urbano non valido.');
  return {seed:v.seed,blocksX:v.blocksX,blocksZ:v.blocksZ,blockSize:v.blockSize,roadWidth:v.roadWidth,sidewalkWidth:v.sidewalkWidth,minFloors:v.minFloors,maxFloors:v.maxFloors,buildingDensity:v.buildingDensity,terrain:v.terrain,sky:v.sky};
}

export function urbanGroundHeight(x,z,config=DEFAULT_URBAN){
  if(config.terrain!=='rolling') return 0;
  const a=Math.sin((x+config.seed*.31)*.025)*1.6,b=Math.cos((z-config.seed*.17)*.021)*1.2;
  return (a+b)*.65;
}

export function generateUrbanPlan(raw=DEFAULT_URBAN){
  const c=validateUrban(raw),roads=[],buildings=[],lamps=[],trees=[],parks=[],crosswalks=[],medians=[],spawns=[];
  const totalX=c.blocksX*c.blockSize,totalZ=c.blocksZ*c.blockSize,x0=-totalX/2,z0=-totalZ/2;
  const midX=Math.floor(c.blocksX/2), midZ=Math.floor(c.blocksZ/2);

  for(let ix=0;ix<=c.blocksX;ix++){
    const x=x0+ix*c.blockSize, boulevard=ix===midX||ix===midX+1;
    roads.push({axis:'z',x,z:0,length:totalZ+c.roadWidth,width:c.roadWidth,boulevard});
    if(boulevard) medians.push({axis:'z',x,z:0,length:totalZ+c.roadWidth,width:1.55});
  }
  for(let iz=0;iz<=c.blocksZ;iz++){
    const z=z0+iz*c.blockSize,boulevard=iz===midZ||iz===midZ+1;
    roads.push({axis:'x',x:0,z,length:totalX+c.roadWidth,width:c.roadWidth,boulevard});
    if(boulevard) medians.push({axis:'x',x:0,z,length:totalX+c.roadWidth,width:1.55});
  }

  for(let ix=0;ix<=c.blocksX;ix++) for(let iz=0;iz<=c.blocksZ;iz++){
    const x=x0+ix*c.blockSize,z=z0+iz*c.blockSize;
    crosswalks.push({x,z,axis:'x'}); crosswalks.push({x,z,axis:'z'});
  }

  const inner=c.blockSize-c.roadWidth-c.sidewalkWidth*2;
  for(let ix=0;ix<c.blocksX;ix++) for(let iz=0;iz<c.blocksZ;iz++){
    const cx=x0+(ix+.5)*c.blockSize,cz=z0+(iz+.5)*c.blockSize;
    const centerDist=Math.hypot((ix+.5-c.blocksX/2)/(c.blocksX/2),(iz+.5-c.blocksZ/2)/(c.blocksZ/2));
    const parkChance=hash(ix,iz,c.seed+503);
    const isPark=parkChance<.10 && centerDist>.3;
    if(isPark){
      parks.push({x:cx,z:cz,w:inner,d:inner,kind:hash(ix,iz,c.seed+509)>.55?'lawn':'plaza'});
      const step=Math.max(8,inner/3.4);
      for(let dx=-inner/2+4;dx<=inner/2-4;dx+=step) for(let dz=-inner/2+4;dz<=inner/2-4;dz+=step)
        if(hash(Math.round(dx*3)+ix,Math.round(dz*3)+iz,c.seed+521)>.34) trees.push({x:cx+dx,z:cz+dz,scale:.85+hash(ix+Math.round(dx),iz+Math.round(dz),c.seed+523)*.45,kind:'park'});
      continue;
    }

    const lotSeed=hash(ix,iz,c.seed),cols=lotSeed>.58?2:1,rows=hash(iz,ix,c.seed+9)>.58?2:1;
    const gap=3,lotW=(inner-gap*(cols-1))/cols,lotD=(inner-gap*(rows-1))/rows;
    for(let bx=0;bx<cols;bx++) for(let bz=0;bz<rows;bz++){
      const chance=hash(ix*7+bx,iz*7+bz,c.seed+31); if(chance>c.buildingDensity) continue;
      const downtown=Math.max(0,1-centerDist);
      const towerBoost=downtown*downtown;
      const maxFloors=Math.min(50,Math.round(c.maxFloors+towerBoost*18));
      const baseFloors=Math.round(c.minFloors+hash(ix*13+bx,iz*17+bz,c.seed+67)*(maxFloors-c.minFloors));
      const isTower=hash(ix*29+bx,iz*31+bz,c.seed+701)<(.12+.35*towerBoost);
      const floors=isTower?Math.max(baseFloors,Math.round(14+towerBoost*24+hash(ix+bx,iz+bz,c.seed+703)*10)):baseFloors;
      const w=lotW*(isTower?.58:.72+hash(ix+bx,iz+bz,c.seed+101)*.22);
      const d=lotD*(isTower?.58:.72+hash(ix+bz,iz+bx,c.seed+131)*.22);
      const x=cx-inner/2+lotW/2+bx*(lotW+gap),z=cz-inner/2+lotD/2+bz*(lotD+gap);
      const styleRoll=hash(ix*19+bx,iz*23+bz,c.seed+201);
      const style=isTower?(styleRoll>.48?'glass':'office'):(styleRoll<.26?'brick':styleRoll<.58?'stone':styleRoll<.82?'office':'glass');
      buildings.push({x,z,w,d,floors,height:floors*3.15,tint:styleRoll,style,isTower});
    }

    // Street trees on the four sidewalk edges. Skip some to leave entrances.
    const treeStep=Math.max(9,c.blockSize/4);
    for(let t=-inner/2+4;t<=inner/2-4;t+=treeStep){
      if(hash(ix,Math.round(t*4)+iz,c.seed+811)>.18) {
        trees.push({x:cx+t,z:cz-inner/2-1.1,scale:.78+hash(ix,iz+Math.round(t),c.seed+813)*.3,kind:'street'});
        trees.push({x:cx+t,z:cz+inner/2+1.1,scale:.78+hash(ix+3,iz+Math.round(t),c.seed+817)*.3,kind:'street'});
      }
      if(hash(iz,Math.round(t*4)+ix,c.seed+821)>.22) {
        trees.push({x:cx-inner/2-1.1,z:cz+t,scale:.78+hash(iz,ix+Math.round(t),c.seed+823)*.3,kind:'street'});
        trees.push({x:cx+inner/2+1.1,z:cz+t,scale:.78+hash(iz+3,ix+Math.round(t),c.seed+827)*.3,kind:'street'});
      }
    }
  }

  const lampStep=Math.max(18,c.blockSize/2);
  for(const road of roads){
    const count=Math.floor(road.length/lampStep);
    for(let i=0;i<=count;i+=2){
      const along=-road.length/2+i*lampStep;
      if(road.axis==='x') lamps.push({x:along,z:road.z+c.roadWidth*.63});
      else lamps.push({x:road.x+c.roadWidth*.63,z:along});
    }
  }

  // Boulevard median trees
  for(const median of medians){
    for(let along=-median.length/2+12;along<median.length/2-12;along+=18){
      const x=median.axis==='x'?along:median.x,z=median.axis==='z'?along:median.z;
      trees.push({x,z,scale:.82+hash(Math.round(x),Math.round(z),c.seed+901)*.25,kind:'median'});
    }
  }

  spawns.push({id:'urban-center',name:'Centro',position:[0,1.1,c.roadWidth*.28]});
  spawns.push({id:'urban-west',name:'Ingresso ovest',position:[x0+c.blockSize*.5,1.1,0]});
  spawns.push({id:'urban-east',name:'Ingresso est',position:[-x0-c.blockSize*.5,1.1,0]});
  return {config:c,bounds:{minX:x0-c.roadWidth/2,maxX:-x0+c.roadWidth/2,minZ:z0-c.roadWidth/2,maxZ:-z0+c.roadWidth/2},roads,buildings,lamps,trees,parks,crosswalks,medians,spawns};
}
