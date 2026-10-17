const API = 'https://sketchbook-fab-bridge.onrender.com';
export const SUPERCARS = Object.freeze([
    { id:'bmw',name:'BMW M4 G82',brand:'BMW',author:'Rosemarin',uid:'5a9007d569a846548dbf352877550c4e',source:'https://sketchfab.com/3d-models/bmw-m4-g82-5a9007d569a846548dbf352877550c4e',license:'CC BY' },
    { id:'ferrari',name:'Ferrari F40',brand:'Ferrari',author:'Black Snow',uid:'52a66c41cfcd4f999fb1b1c49bf24d70',source:'https://sketchfab.com/3d-models/ferrari-f40-52a66c41cfcd4f999fb1b1c49bf24d70',license:'CC BY' },
    { id:'lamborghini',name:'Lamborghini Aventador SV',brand:'Lamborghini',author:'SDC PERFORMANCE',uid:'4350c8de8fd740f582bd316c1fa010ff',source:'https://sketchfab.com/3d-models/free-lamborghini-aventador-sv-tunnig-by-sdc-4350c8de8fd740f582bd316c1fa010ff',license:'CC BY' }
]);
export function supercarPositions(base) {
    // Two-meter minimum clearance between 4.6m long cars.
    return [[-7,10],[0,10],[7,10]].map(([x,z])=>[
        base.x+x,base.y,base.z+z
    ]);
}
export function fitVehicleVisual(source, THREE = globalThis.THREE) {
    if (!THREE?.Group) throw Error('Motore Three.js non inizializzato.');
    const holder=new THREE.Group();
    const mesh=source.clone(true);
    holder.add(mesh);
    holder.updateMatrixWorld(true);
    let box=new THREE.Box3().setFromObject(holder);
    let dims=box.getSize(new THREE.Vector3());
    // Most Sketchfab cars are aligned with +X or +Z. The car prefab uses +Z forward.
    if(dims.x > dims.z * 1.15) mesh.rotation.y = Math.PI/2;
    holder.updateMatrixWorld(true);
    box=new THREE.Box3().setFromObject(holder);
    dims=box.getSize(new THREE.Vector3());
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
                return bytes;
            }
        }catch(error) {
            if(attempt===2 || !(error instanceof TypeError || /network|Failed to fetch/i.test(error.message)))throw error;
        }
        await new Promise(done=>setTimeout(done,(attempt+1)*1250));
    }
    throw Error('Download supercar non disponibile.');
}
