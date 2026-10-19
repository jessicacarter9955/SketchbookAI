import * as CANNON from 'cannon-es';

// Ambient traffic is scripted path-following, so use KINEMATIC rigid bodies.
// They collide with the dynamic Sketchbook player/vehicle, but aren't falsely
// advertised as fully simulated motor/suspension vehicles.
export function createUrbanAgentCollider(kind){
  if(!['car','pedestrian'].includes(kind))throw Error('Unknown urban collider kind');
  const body=new CANNON.Body({mass:0,type:CANNON.Body.KINEMATIC,
    collisionFilterGroup:1,collisionFilterMask:-1,allowSleep:false});
  if(kind==='car')body.addShape(new CANNON.Box(new CANNON.Vec3(1.0,.72,2.05)));
  else body.addShape(new CANNON.Sphere(.47));
  body.collisionResponse=true;
  body.userData={urbanAmbientCollider:kind};
  return body;
}
export function syncUrbanAgentCollider(world,agent,kind,focus,range=105){
  const physics=world?.physicsWorld;
  if(!physics||!agent||!focus)return;
  const p=agent.object?.position;
  if(!p)return;
  const d=Math.hypot(p.x-focus.x,p.z-focus.z);
  if(d>range+20){
    if(agent.colliderAttached){physics.removeBody(agent.collider);agent.colliderAttached=false;}
    return;
  }
  if(d>range&&!agent.colliderAttached)return;
  if(!agent.collider)agent.collider=createUrbanAgentCollider(kind);
  const body=agent.collider;
  if(!agent.colliderAttached){physics.addBody(body);agent.colliderAttached=true;}
  const ground=world.levelRuntime?.groundAt(p.x,p.z)??p.y;
  const y=ground+(kind==='car'?.79:.95);
  // Directly synchronize the visual path follower with the Cannon actor.
  // A KINEMATIC body cannot be moved by the player's collisions, but will
  // produce contact against dynamic car/character rigid bodies.
  body.position.set(p.x,y,p.z);
  body.previousPosition.copy(body.position);
  body.velocity.set(0,0,0);
  body.angularVelocity.set(0,0,0);
  if(kind==='car')body.quaternion.setFromEuler(0,agent.object.rotation.y,0);
  else body.quaternion.set(0,0,0,1);
  body.aabbNeedsUpdate=true;
}
export function disposeUrbanAgentColliders(world,agents){
  for(const a of agents||[]){
    if(a.colliderAttached&&a.collider)world?.physicsWorld?.removeBody(a.collider);
    a.colliderAttached=false;a.collider=null;
  }
}
