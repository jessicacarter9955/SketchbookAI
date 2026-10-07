export const DEFAULT_URBAN = {
  seed: 42,
  blocksX: 6,
  blocksZ: 6,
  blockSize: 42,
  roadWidth: 12,
  sidewalkWidth: 2.5,
  minFloors: 2,
  maxFloors: 9,
  buildingDensity: 0.78,
  terrain: 'flat',
  sky: 'day'
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hash = (x, z, seed) => {
  let h = Math.imul(x + 374761393, 668265263) ^ Math.imul(z + 1442695041, 1274126177) ^ Math.imul(seed, 1597334677);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

export function validateUrban(value = DEFAULT_URBAN) {
  const v = { ...DEFAULT_URBAN, ...value };
  if (!Number.isInteger(v.seed) || v.seed < 0 || v.seed > 2147483647) throw new Error('Seed urbano non valido.');
  for (const [key, min, max] of [['blocksX',2,18],['blocksZ',2,18],['minFloors',1,25],['maxFloors',1,40]]) {
    if (!Number.isInteger(v[key]) || v[key] < min || v[key] > max) throw new Error(`${key} fuori intervallo.`);
  }
  for (const [key, min, max] of [['blockSize',24,100],['roadWidth',6,30],['sidewalkWidth',0,8],['buildingDensity',0.15,1]]) {
    if (!Number.isFinite(v[key]) || v[key] < min || v[key] > max) throw new Error(`${key} fuori intervallo.`);
  }
  if (v.minFloors > v.maxFloors) throw new Error('minFloors deve essere <= maxFloors.');
  if (v.roadWidth + v.sidewalkWidth * 2 >= v.blockSize * .75) throw new Error('Strada e marciapiedi troppo larghi rispetto all\'isolato.');
  if (!['flat','rolling'].includes(v.terrain) || !['day','sunset','haze'].includes(v.sky)) throw new Error('Preset urbano non valido.');
  return {
    seed:v.seed, blocksX:v.blocksX, blocksZ:v.blocksZ, blockSize:v.blockSize, roadWidth:v.roadWidth,
    sidewalkWidth:v.sidewalkWidth, minFloors:v.minFloors, maxFloors:v.maxFloors,
    buildingDensity:v.buildingDensity, terrain:v.terrain, sky:v.sky
  };
}

export function urbanGroundHeight(x, z, config = DEFAULT_URBAN) {
  if (config.terrain !== 'rolling') return 0;
  const a = Math.sin((x + config.seed * .31) * .025) * 1.6;
  const b = Math.cos((z - config.seed * .17) * .021) * 1.2;
  return (a + b) * .65;
}

export function generateUrbanPlan(raw = DEFAULT_URBAN) {
  const c = validateUrban(raw), roads = [], buildings = [], lamps = [], spawns = [];
  const totalX = c.blocksX * c.blockSize, totalZ = c.blocksZ * c.blockSize;
  const x0 = -totalX / 2, z0 = -totalZ / 2;
  for (let ix=0; ix<=c.blocksX; ix++) {
    const x = x0 + ix * c.blockSize;
    roads.push({axis:'z', x, z:0, length:totalZ + c.roadWidth, width:c.roadWidth});
  }
  for (let iz=0; iz<=c.blocksZ; iz++) {
    const z = z0 + iz * c.blockSize;
    roads.push({axis:'x', x:0, z, length:totalX + c.roadWidth, width:c.roadWidth});
  }
  const inner = c.blockSize - c.roadWidth - c.sidewalkWidth*2;
  for (let ix=0; ix<c.blocksX; ix++) for (let iz=0; iz<c.blocksZ; iz++) {
    const cx = x0 + (ix + .5) * c.blockSize, cz = z0 + (iz + .5) * c.blockSize;
    const lotSeed = hash(ix, iz, c.seed);
    const cols = lotSeed > .65 ? 2 : 1, rows = hash(iz, ix, c.seed+9) > .62 ? 2 : 1;
    const gap = 3, lotW=(inner-gap*(cols-1))/cols, lotD=(inner-gap*(rows-1))/rows;
    for (let bx=0; bx<cols; bx++) for (let bz=0; bz<rows; bz++) {
      const chance = hash(ix*7+bx, iz*7+bz, c.seed+31);
      if (chance > c.buildingDensity) continue;
      const floors = Math.round(c.minFloors + hash(ix*13+bx,iz*17+bz,c.seed+67)*(c.maxFloors-c.minFloors));
      const w = lotW * (.72 + hash(ix+bx,iz+bz,c.seed+101)*.22);
      const d = lotD * (.72 + hash(ix+bz,iz+bx,c.seed+131)*.22);
      const x = cx - inner/2 + lotW/2 + bx*(lotW+gap);
      const z = cz - inner/2 + lotD/2 + bz*(lotD+gap);
      buildings.push({x,z,w,d,floors,height:floors*3.15,tint:hash(ix*19+bx,iz*23+bz,c.seed+201)});
    }
  }
  const lampStep = Math.max(18, c.blockSize/2);
  for (const road of roads) {
    const count = Math.floor(road.length/lampStep);
    for(let i=0;i<=count;i+=2) {
      const along = -road.length/2 + i*lampStep;
      if (road.axis==='x') lamps.push({x:along,z:road.z+c.roadWidth*.65});
      else lamps.push({x:road.x+c.roadWidth*.65,z:along});
    }
  }
  spawns.push({id:'urban-center',name:'Centro',position:[0,1.1,0]});
  spawns.push({id:'urban-west',name:'Ingresso ovest',position:[x0+c.blockSize*.5,1.1,0]});
  spawns.push({id:'urban-east',name:'Ingresso est',position:[-x0-c.blockSize*.5,1.1,0]});
  return {config:c, bounds:{minX:x0-c.roadWidth/2,maxX:-x0+c.roadWidth/2,minZ:z0-c.roadWidth/2,maxZ:-z0+c.roadWidth/2}, roads, buildings, lamps, spawns};
}
