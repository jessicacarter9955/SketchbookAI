import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

const BASE = 'build/local-scenes/dds/';
export async function loadDdsPlayer() {
    const response = await fetch(`${BASE}manifest.json`);
    if (!response.ok) throw new Error('DDS assets missing. Run tools/export-dds.ps1 with your editable Unreal project, then reload this scene.');
    const manifest = await response.json();
    if(!manifest.clips?.crouch_walk || !manifest.clips?.heal || !manifest.weapons?.rifle || !manifest.weapons?.pistol)
        throw new Error('DDS export is outdated. Run tools/export-dds.ps1 again to add the single-player assets.');
    const loader = new GLTFLoader();
    const safeURL = file => {
        if (typeof file !== 'string' || !/^[a-z0-9_-]+\.glb$/i.test(file)) throw new Error('Invalid DDS asset filename');
        return BASE + file;
    };
    const model = await loader.loadAsync(safeURL(manifest.mesh));
    const clips = await Promise.all(Object.entries(manifest.clips).map(async ([name, file]) => {
        const gltf = await loader.loadAsync(safeURL(file));
        if (!gltf.animations.length) throw new Error(`DDS animation missing: ${name}`);
        const clip = gltf.animations[0].clone(); clip.name = name;
        // Physics owns world movement; retain all hip/limb motion, remove root travel.
        clip.tracks = clip.tracks.filter(track => !/^root\.(position|quaternion)$/.test(track.name));
        return clip;
    }));
    const unequip = clips.find(clip=>clip.name==='rifle_unequip');
    if(unequip) {
        const equip=unequip.clone();equip.name='rifle_equip';
        for(const track of equip.tracks) {
            const original=track.values.slice(), times=track.times.slice(), stride=track.getValueSize();
            for(let i=0;i<times.length;i++) {
                track.times[i]=equip.duration-times[times.length-1-i];
                for(let j=0;j<stride;j++)track.values[i*stride+j]=original[(times.length-1-i)*stride+j];
            }
        }
        clips.push(equip);
    }
    const aliases = {
        start_forward:'run', start_left:'run', start_right:'run', start_back_left:'run', start_back_right:'run',
        stop:'idle', reset:'idle', drop_running:'drop_idle', drop_running_roll:'drop_idle',
        driving:'idle', sitting:'idle', sitting_shift_left:'idle', sitting_shift_right:'idle',
        sit_down_left:'idle', sit_down_right:'idle', stand_up_left:'idle', stand_up_right:'idle'
    };
    for (const [name, source] of Object.entries(aliases)) {
        if (clips.some(clip => clip.name === name)) continue;
        const clip = clips.find(clip => clip.name === source)?.clone();
        if (!clip) throw new Error(`DDS required animation missing: ${source}`);
        clip.name = name; clips.push(clip);
    }
    // Unreal's layered material needs a separate bake; use a readable neutral finish.
    model.scene.traverse(object => {
        if (object.isMesh) object.material = new THREE.MeshStandardMaterial({color:0xa7beca, metalness:0.35, roughness:0.55});
    });
    model.scene.animations = clips;
    model.scene.userData.playerProfile = 'dds';
    model.weapons = {};
    for (const [name, file] of Object.entries(manifest.weapons || {})) {
        model.weapons[name] = (await loader.loadAsync(safeURL(file))).scene;
        if(manifest.weaponClips?.[name]) {
            model.weapons[name].animations=(await loader.loadAsync(safeURL(manifest.weaponClips[name]))).animations;
        }
    }
    return model;
}
