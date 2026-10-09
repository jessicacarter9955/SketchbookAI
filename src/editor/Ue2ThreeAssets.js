import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { expandAnimationAliases, safeLocalBaseURL, stripRootMotionTracks, validateCharacterManifest, validateCharacterRig } from './ue2three-manifest.mjs';

export async function loadUe2ThreeCharacter(baseURL, {fetchImpl=fetch, loader=new GLTFLoader()}={}) {
    const base = safeLocalBaseURL(baseURL);
    const response = await fetchImpl(base + 'manifest.json');
    if (!response?.ok) throw new Error(`ue2three character manifest unavailable at ${base}`);
    const manifest = validateCharacterManifest(await response.json());

    const model = await loader.loadAsync(base + manifest.mesh);
    const scene = model.scene || model;
    if (!scene) throw new Error('ue2three character GLB has no scene');

    const attachments = validateCharacterRig(scene, manifest);
    const clips = [];
    for (const [name, filename] of Object.entries(manifest.clips)) {
        const gltf = await loader.loadAsync(base + filename);
        if (!gltf.animations?.length) throw new Error(`ue2three animation has no clips: ${name}`);
        const clip = gltf.animations[0].clone();
        clip.name = name;
        clip.tracks = stripRootMotionTracks(clip.tracks, manifest.runtime);
        if (!clip.tracks.length) throw new Error(`ue2three animation became empty after root-motion processing: ${name}`);
        clips.push(clip);
    }
    const expanded = expandAnimationAliases(clips, manifest.runtime);
    const attachmentAssets = {};
    for (const [name, metadata] of Object.entries(manifest.attachment_assets || {})) {
        const gltf = await loader.loadAsync(base + metadata.file);
        const asset = gltf.scene || gltf;
        const transform = metadata.transform || {};
        asset.position.fromArray(transform.position || [0,0,0]);
        asset.rotation.set(...(transform.rotation || [0,0,0]), 'XYZ');
        asset.scale.fromArray(transform.scale || [1,1,1]);
        attachmentAssets[name] = {asset, bone: metadata.bone, transform, socketTransform: metadata.socket_transform};
    }
    scene.animations = expanded;
    scene.userData.ue2three = {
        recipeId: manifest.recipe_id,
        fingerprint: manifest.fingerprint,
        runtime: manifest.runtime || {},
        source: manifest.source || {},
        warnings: manifest.warnings || []
    };

    return {
        scene,
        animations: expanded,
        manifest,
        attachments,
        attachmentAssets,
        source: model
    };
}
