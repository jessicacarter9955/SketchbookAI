// Select the best quarter-turn for arbitrary GLB vehicle orientations.
// Geometric long axis alone is insufficient to distinguish front from rear;
// use labeled wheel groups when available, otherwise keep stable input direction.
export function autoOrientVehicle(scene,THREE) {
    if(!scene?.traverse||!THREE?.Box3)throw Error('GLB veicolo non valido.');
    let front=null,rear=null;
    scene.traverse(node=>{
        const name=String(node.name||'').trim().replace(/[_-]+/g,' ').toLowerCase();
        if(name==='front wheels'||name==='front tires')front=node;
        if(name==='back wheels'||name==='rear wheels'||name==='rear tires')rear=node;
    });
    const original=scene.rotation.y;
    let chosen=null;
    const size=new THREE.Vector3();
    for(const q of [0,1,2,3]){
        scene.rotation.y=original+Math.PI*q/2;
        scene.updateMatrixWorld(true);
        new THREE.Box3().setFromObject(scene).getSize(size);
        if(![size.x,size.y,size.z].every(Number.isFinite)||size.x<=0||size.y<=0||size.z<=0)continue;
        let score=size.z/(size.x+.001);
        if(front&&rear){
            const a=new THREE.Box3().setFromObject(front).getCenter(new THREE.Vector3());
            const b=new THREE.Box3().setFromObject(rear).getCenter(new THREE.Vector3());
            if(Math.abs(a.z-b.z)>.12)score+=a.z>b.z?10:-10;
        }
        if(!chosen||score>chosen.score+.001)chosen={yaw:Math.PI*q/2,score};
    }
    scene.rotation.y=original+(chosen?.yaw||0);
    scene.updateMatrixWorld(true);
    if(!chosen)throw Error('Modello veicolo senza geometria utilizzabile.');
    return chosen.yaw;
}
