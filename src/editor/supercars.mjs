const API = 'https://sketchbook-fab-bridge.onrender.com';
export const SUPERCARS = Object.freeze([
    { id:'bmw',name:'BMW M4 G82',brand:'BMW',author:'Rosemarin',uid:'5a9007d569a846548dbf352877550c4e',source:'https://sketchfab.com/3d-models/bmw-m4-g82-5a9007d569a846548dbf352877550c4e',license:'CC BY' },
    { id:'ferrari',name:'Ferrari F40',brand:'Ferrari',author:'Black Snow',uid:'52a66c41cfcd4f999fb1b1c49bf24d70',source:'https://sketchfab.com/3d-models/ferrari-f40-52a66c41cfcd4f999fb1b1c49bf24d70',license:'CC BY' },
    { id:'lamborghini',name:'Lamborghini Aventador SV',brand:'Lamborghini',author:'SDC PERFORMANCE',uid:'4350c8de8fd740f582bd316c1fa010ff',source:'https://sketchfab.com/3d-models/free-lamborghini-aventador-sv-tunnig-by-sdc-4350c8de8fd740f582bd316c1fa010ff',license:'CC BY' }
]);
export function supercarPositions(base) {
    // Keep three 4.6m cars on the unobstructed western test lane.\n    // The center (+0) and eastern (+7) parking spots block Ferrari traction.
    return [[-14,10],[-7,10],[-21,10]].map(([x,z])=>[
        base.x+x,base.y,base.z+z
    ]);
}
// Align the car's longitudinal axis with +Z. When the source GLB labels
// both "Front Wheels" and "Back Wheels", also orient its actual front to +Z.
// Try all four quarter turns rather than guessing a single 90-degree rotation.
export function chooseVehicleYaw(source, THREE = globalThis.THREE) {
    if(!THREE?.Group)throw Error('Motore Three.js non inizializzato.');
    const shell=new THREE.Group(),probe=source.clone(true);
    shell.add(probe);
    const originalYaw=probe.rotation.y;
    let front=null,rear=null;
    probe.traverse(node=>{
        const key=String(node.name||'').replace(/[_-]+/g,' ').trim().toLowerCase();
        if(key==='front wheels'||key==='front tires')front=node;
        if(key==='back wheels'||key==='rear wheels'||key==='rear tires')rear=node;
    });
    let best=null;
    const box=new THREE.Box3(),size=new THREE.Vector3(),frontCenter=new THREE.Vector3(),rearCenter=new THREE.Vector3();
    for(const turn of [0,1,2,3]){
        probe.rotation.y=originalYaw+turn*Math.PI/2;
        probe.updateMatrixWorld(true);
        box.setFromObject(shell);box.getSize(size);
        if(!Number.isFinite(size.x)||!Number.isFinite(size.y)||!Number.isFinite(size.z)||
            Math.min(size.x,size.y,size.z)<=0)continue;
        // A recognizable car is longer than it is wide, but do not use that
        // length as a cue for 180° front/back reversal.
        let score=size.z/(size.x+.001);
        if(front&&rear){
            new THREE.Box3().setFromObject(front).getCenter(frontCenter);
            new THREE.Box3().setFromObject(rear).getCenter(rearCenter);
            const delta=frontCenter.z-rearCenter.z;
            if(Math.abs(delta)>.12)score+=delta>0?10:-10;
        }
        if(!best||score>best.score+.001)best={yaw:turn*Math.PI/2,score,turn};
    }
    if(!best)throw Error('Geometria del veicolo non valida, impossibile orientare il GLB.');
    return best.yaw;
}
export function fitVehicleVisual(source, THREE = globalThis.THREE) {
    if (!THREE?.Group) throw Error('Motore Three.js non inizializzato.');
    const holder=new THREE.Group();
    const yaw=chooseVehicleYaw(source,THREE);
    const mesh=source.clone(true);
    mesh.rotation.y+=yaw;
    holder.add(mesh);
    holder.updateMatrixWorld(true);
    let box=new THREE.Box3().setFromObject(holder);
    let dims=box.getSize(new THREE.Vector3());
    const factor=Math.min(4.6/Math.max(0.01,dims.z),2.1/Math.max(0.01,dims.x),2.1/Math.max(0.01,dims.y));
    if(!Number.isFinite(factor)||factor<=0) throw Error('Dimensioni modello auto non valide.');
    mesh.scale.multiplyScalar(factor);
    holder.updateMatrixWorld(true);
    box=new THREE.Box3().setFromObject(holder);
    mesh.position.x -= (box.min.x+box.max.x)*0.5;
    mesh.position.z -= (box.min.z+box.max.z)*0.5;
    // Physics chassis origin sits roughly 0.9m above the asphalt.
    mesh.position.y -= box.min.y+0.84;
    holder.userData.sketchfabBody=true;
    holder.userData.sketchfabOrientationYaw=yaw;
    return holder;
}
export async function downloadSupercar(model,fetcher=fetch) {
    if(!SUPERCARS.some(c=>c.id===model.id)) throw Error('Supercar non autorizzata.');
    for(let attempt=0; attempt<3; attempt++) {
        try {
            const response=await fetcher(API+'/sketchfab/cars/'+model.id,{signal:AbortSignal.timeout(95000)});
            if(!response.ok) {
                const message=(await response.json().catch(()=>({}))).error || 'HTTP '+response.status;
                const error=new Error('Sketchfab '+model.brand+': '+message);
                if(response.status!==502 && response.status!==503 && response.status!==504)throw error;
                if(attempt===2)throw error;
            } else {
                if(Number(response.headers.get('content-length'))>50*1024*1024)throw Error(model.brand+': asset troppo grande.');
                const bytes=await response.arrayBuffer();
                if(bytes.byteLength>50*1024*1024)throw Error(model.brand+': asset troppo grande.');
                // The bridge occasionally replies HTTP 200 with a non-GLB body.
                // Validate before persisting to IndexedDB: retry the transient
                // response instead of showing an unrigged/missing supercar.
                const valid=bytes.byteLength>=20 && (() => {
                    const header=new DataView(bytes);
                    return header.getUint32(0,true)===0x46546c67 &&
                        header.getUint32(4,true)===2 &&
                        header.getUint32(8,true)===bytes.byteLength;
                })();
                if(!valid)throw Error('TRANSIENT_GLTF: Sketchfab '+model.brand+' ha restituito dati non GLB.');
                return bytes;
            }
        }catch(error) {
            if(attempt===2 || !(error instanceof TypeError || /network|Failed to fetch|TRANSIENT_GLTF/i.test(error.message)))throw error;
        }
        await new Promise(done=>setTimeout(done,(attempt+1)*1250));
    }
    throw Error('Download supercar non disponibile.');
}
