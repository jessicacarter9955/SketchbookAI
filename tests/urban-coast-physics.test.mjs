import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as CANNON from 'cannon-es';
import {DEFAULT_URBAN,generateUrbanPlan} from '../src/editor/urban-data.mjs';
import {miamiCoastLayout} from '../src/editor/urban-coast-layout.mjs';
import {buildUrbanSandBlendGeometry} from '../src/editor/urban-coast-sand.mjs';
import {urbanOceanContains,urbanOceanFloorRects,createUrbanOceanFloorBodies,
  applyUrbanOceanFlotation,urbanCoastGroundHeight} from '../src/editor/urban-coast-physics.mjs';
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const coast=()=>miamiCoastLayout(generateUrbanPlan(DEFAULT_URBAN).bounds,DEFAULT_URBAN.seed);

test('ocean water volume and real seabed match all four Water reflector strips',()=>{
  const layout=coast(),regions=urbanOceanFloorRects(layout);
  assert.equal(regions.length,4);
  for(const side of layout.sides){
    const x=side.axis==='x'?side.shore+side.sign*18:layout.waterCenter[0];
    const z=side.axis==='z'?side.shore+side.sign*18:layout.waterCenter[1];
    assert.ok(urbanOceanContains(layout,x,z),side.name+' sea must have a physical region');
    assert.equal(urbanCoastGroundHeight(layout,x,z),-3.6);
  }
  assert.equal(urbanOceanContains(layout,...layout.waterCenter),false);
  const [cx,cz]=layout.waterCenter;
  assert.equal(urbanCoastGroundHeight(layout,cx,cz),null);
  assert.equal(urbanOceanContains(layout,30000,30000),false);
  const bodies=createUrbanOceanFloorBodies(layout);
  assert.equal(bodies.length,4);
  for(const body of bodies){
    assert.equal(body.mass,0);
    assert.ok(body.shapes[0] instanceof CANNON.Box);
    assert.ok(Math.abs(body.position.y+3.95)<.001);
    assert.equal(body.userData.urbanOceanSeabed,true);
  }
});

test('ocean seabed actually stops a falling dynamic physics object',()=>{
  const layout=coast(),world=new CANNON.World({gravity:new CANNON.Vec3(0,-9.81,0)});
  for(const body of createUrbanOceanFloorBodies(layout))world.addBody(body);
  const shore=layout.sides.find(s=>s.name==='east');
  const ball=new CANNON.Body({mass:1,position:new CANNON.Vec3(shore.shore+30,1,layout.waterCenter[1])});
  ball.addShape(new CANNON.Sphere(.45));
  world.addBody(ball);
  for(let i=0;i<160;i++)world.step(1/60);
  assert.ok(ball.position.y>-4.3,'player-like body falls under ocean floor');
  assert.ok(ball.position.y<-.7,'submerged body should meet real seabed, not an invisible surface wall');
});

test('on-foot player floats at actual sea surface and can still move laterally',()=>{
  const layout=coast(),side=layout.sides.find(s=>s.name==='south');
  const x=layout.waterCenter[0],z=side.shore+side.sign*10;
  const physics=new CANNON.World({gravity:new CANNON.Vec3(0,-9.81,0)});
  const body=new CANNON.Body({mass:1,position:new CANNON.Vec3(x,-2,z),
    velocity:new CANNON.Vec3(2,-5,1)});
  body.addShape(new CANNON.Sphere(.25));physics.addBody(body);
  const player={characterCapsule:{body},occupyingSeat:null,controlledObject:undefined};
  const world={editorPlayer:player,physicsWorld:physics};
  assert.equal(applyUrbanOceanFlotation(world,layout,0),true);
  assert.ok(body.position.y>.4,'head must remain above reflective sea level');
  assert.ok(body.velocity.y>=0,'downward falling velocity must be stopped');
  assert.ok(body.velocity.x>0&&body.velocity.z>0,'horizontal water movement must remain possible');
  for(let i=0;i<80;i++){physics.step(1/60);applyUrbanOceanFlotation(world,layout,i/60);}
  assert.ok(body.position.y>.36,'repeated physics steps cannot sink player under the map');
  player.occupyingSeat={};body.position.y=-2;
  assert.equal(applyUrbanOceanFlotation(world,layout,0),false,'car passengers must not float their inactive capsule');
  player.occupyingSeat=null;body.position.set(0,-2,0);
  assert.equal(applyUrbanOceanFlotation(world,layout,0),false,'never float players on city roads');
  assert.match(source('src/editor/UrbanRuntime.js'),/addEventListener\('postStep'/);
  assert.match(source('src/editor/UrbanRuntime.js'),/createUrbanOceanFloorBodies\(this\.coast\)/);
});

test('dry aerial beach and damp sand use true feathered alpha and distinct metric PBR UVs',()=>{
  const layout=coast();
  for(const side of layout.sides){
    const dry=buildUrbanSandBlendGeometry(side,layout,'dry');
    const wet=buildUrbanSandBlendGeometry(side,layout,'wet');
    const d=dry.getAttribute('color'),w=wet.getAttribute('color');
    assert.equal(d.itemSize,4);assert.equal(w.itemSize,4);
    assert.equal(d.count,w.count);
    const da=[],wa=[];
    for(let i=0;i<d.count;i++){da.push(d.getW(i));wa.push(w.getW(i));}
    assert.ok(Math.min(...da)<=0.001&&Math.max(...da)>=.999);
    assert.ok(Math.min(...wa)<=0.001&&Math.max(...wa)>=.999);
    assert.ok(dry.getAttribute('uv').getX(0)!==wet.getAttribute('uv').getX(0),
      'large aerial dune texture and fine wet texture must have different tile scales');
    dry.dispose();wet.dispose();
  }
  const coastCode=source('src/editor/UrbanCoast.js');
  assert.match(coastCode,/buildUrbanSandBlendGeometry\(side,layout,type\)/);
  assert.match(coastCode,/dry-diff\.jpg/);
  assert.match(coastCode,/wet-nor_gl\.jpg/);
  assert.match(coastCode,/vertexColors:true,depthWrite:false/);
  const fetchCode=source('tools/fetch-urban-coast.py');
  assert.match(fetchCode,/aerial_beach_01/);
  assert.match(fetchCode,/damp_sand/);
  assert.match(fetchCode,/\["2k"\]\["jpg"\]/);
});
