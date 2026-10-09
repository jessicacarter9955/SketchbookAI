const SAFE_GLB = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.glb$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;

export function safeLocalBaseURL(value) {
    if (typeof value !== 'string' || !value.length) throw new Error('Missing ue2three character base URL');
    const normalized = value.replace(/\\/g, '/');
    if (/^[a-z]+:/i.test(normalized) || normalized.startsWith('//') || normalized.includes('..'))
        throw new Error('ue2three character base URL must be a local relative path');
    return normalized.endsWith('/') ? normalized : normalized + '/';
}

export function validateCharacterManifest(manifest) {
    if (!manifest || typeof manifest !== 'object' || manifest.schema_version !== 1 || manifest.kind !== 'character')
        throw new Error('Unsupported ue2three character manifest');
    if (typeof manifest.recipe_id !== 'string' || !SAFE_ID.test(manifest.recipe_id))
        throw new Error('Invalid ue2three character recipe id');
    if (typeof manifest.fingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.fingerprint))
        throw new Error('Invalid ue2three character fingerprint');
    if (typeof manifest.mesh !== 'string' || !SAFE_GLB.test(manifest.mesh))
        throw new Error('Invalid ue2three character mesh filename');
    if (!manifest.clips || typeof manifest.clips !== 'object' || Array.isArray(manifest.clips) || !Object.keys(manifest.clips).length)
        throw new Error('ue2three character manifest has no animation clips');
    for (const [name, file] of Object.entries(manifest.clips)) {
        if (!SAFE_ID.test(name) || typeof file !== 'string' || !SAFE_GLB.test(file))
            throw new Error('Invalid ue2three animation entry');
    }
    if (manifest.attachment_assets !== undefined &&
        (!manifest.attachment_assets || typeof manifest.attachment_assets !== 'object' || Array.isArray(manifest.attachment_assets)))
        throw new Error('Invalid ue2three attachment_assets object');
    for (const [name, metadata] of Object.entries(manifest.attachment_assets || {})) {
        if (!SAFE_ID.test(name) || !metadata || typeof metadata !== 'object' ||
            typeof metadata.file !== 'string' || !SAFE_GLB.test(metadata.file) ||
            typeof metadata.bone !== 'string' || !metadata.bone)
            throw new Error('Invalid ue2three attachment asset entry');
        const transform = metadata.transform || {};
        if (metadata.socket_transform !== undefined) {
            const socket = metadata.socket_transform;
            for (const [key, length] of [['position', 3], ['quaternion', 4], ['scale', 3]]) {
                if (!socket || !Array.isArray(socket[key]) || socket[key].length !== length ||
                    socket[key].some(value => typeof value !== 'number' || !Number.isFinite(value)))
                    throw new Error(`Invalid ue2three attachment ${name} socket ${key}`);
            }
            if (socket.scale.some(value => value <= 0) ||
                Math.abs(Math.hypot(...socket.quaternion) - 1) > 0.001)
                throw new Error(`Invalid ue2three attachment ${name} socket transform`);
        }
        for (const key of ['position', 'rotation', 'scale']) {
            if (transform[key] !== undefined && (!Array.isArray(transform[key]) || transform[key].length !== 3 ||
                transform[key].some(value => typeof value !== 'number' || !Number.isFinite(value))))
                throw new Error(`Invalid ue2three attachment ${name} ${key} transform`);
        }
    }
    const runtime = manifest.runtime || {};
    const policy = runtime.root_motion || 'preserve';
    if (!['preserve', 'strip_root_translation', 'strip_root_transform'].includes(policy))
        throw new Error('Unsupported ue2three root motion policy');
    if (runtime.required_bones && (!Array.isArray(runtime.required_bones) || runtime.required_bones.some(name => typeof name !== 'string' || !name)))
        throw new Error('Invalid ue2three required_bones');
    if (runtime.attachments && (typeof runtime.attachments !== 'object' || Array.isArray(runtime.attachments) ||
        Object.entries(runtime.attachments).some(([name, bone]) => !SAFE_ID.test(name) || typeof bone !== 'string' || !bone)))
        throw new Error('Invalid ue2three attachments');
    if (runtime.animation_aliases && (typeof runtime.animation_aliases !== 'object' || Array.isArray(runtime.animation_aliases) ||
        Object.entries(runtime.animation_aliases).some(([name, source]) => !SAFE_ID.test(name) || !SAFE_ID.test(source))))
        throw new Error('Invalid ue2three animation aliases');
    return manifest;
}

export function stripRootMotionTracks(tracks, runtime = {}) {
    const policy = runtime.root_motion || 'preserve';
    if (policy === 'preserve') return tracks.slice();
    const root = runtime.root_bone || 'root';
    return tracks.filter(track => {
        const name = String(track?.name || '');
        const dot = name.lastIndexOf('.');
        if (dot < 0) return true;
        const node = name.slice(0, dot).split('/').pop();
        const property = name.slice(dot + 1);
        if (node !== root) return true;
        if (property === 'position') return false;
        return !(policy === 'strip_root_transform' && property === 'quaternion');
    });
}

export function validateCharacterRig(root, manifest) {
    validateCharacterManifest(manifest);
    if (!root || typeof root.getObjectByName !== 'function') throw new Error('Invalid loaded character scene');
    const runtime = manifest.runtime || {};
    const missingBones = (runtime.required_bones || []).filter(name => !root.getObjectByName(name));
    const attachments = {};
    for (const [name, bone] of Object.entries(runtime.attachments || {})) {
        const node = root.getObjectByName(bone);
        if (!node) missingBones.push(bone);
        else attachments[name] = node;
    }
    for (const metadata of Object.values(manifest.attachment_assets || {})) {
        if (!root.getObjectByName(metadata.bone)) missingBones.push(metadata.bone);
    }
    const uniqueMissing = [...new Set(missingBones)];
    if (uniqueMissing.length) throw new Error('Missing required character bones/sockets: ' + uniqueMissing.join(', '));
    return attachments;
}

export function expandAnimationAliases(clips, runtime = {}) {
    const result = clips.slice();
    const byName = new Map(result.map(clip => [clip.name, clip]));
    for (const [alias, source] of Object.entries(runtime.animation_aliases || {})) {
        if (byName.has(alias)) continue;
        const original = byName.get(source);
        if (!original || typeof original.clone !== 'function') throw new Error(`Animation alias ${alias} refers to missing clip ${source}`);
        const clone = original.clone(); clone.name = alias; result.push(clone); byName.set(alias, clone);
    }
    return result;
}
