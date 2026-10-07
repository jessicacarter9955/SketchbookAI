import { WORLD_IDS } from './island-data.mjs';
export const CATALOG_KEY = 'sketchbook.scenes.v1';
export const BUILTIN_SCENES = [
    { id: 'sandbox', name: 'Sketchbook · mappa originale', world: 'sketchbook' },
    { id: 'liberty-city', name: 'Liberty City · Portland', world: 'liberty-city' },
    { id: 'portland-lab', name: 'Portland · laboratorio', world: 'liberty-city', spawn: 'spawn_portland' },
    { id: 'dds-portland', name: 'DDS · Portland playtest', world: 'liberty-city', spawn: 'spawn_portland', playerProfile: 'dds' },
    { id: 'portland-grass', name: 'Portland · prato animato', world: 'liberty-city', spawn: 'spawn_portland' },
    { id: 'staunton-lab', name: 'Staunton · laboratorio', world: 'liberty-city', spawn: 'spawn_staunton_island' },
    { id: 'island-bridge', name: 'Isola · ponte e costa', world: 'procedural-island', spawn:'island-west' },
    { id: 'island-sunset', name: 'Isola · tramonto', world: 'procedural-island', spawn:'island-west' },
    { id: 'urban-procedural', name: 'Procedural City · drive test', world: 'procedural-city', spawn:'urban-center', playerProfile:'mannequin' },
    { id: 'urban-photoreal', name: 'Urban Photoreal · boulevard', world: 'procedural-city', spawn:'urban-center', playerProfile:'mannequin' },
    { id: 'urban-photoreal-sunset', name: 'Urban Photoreal · sunset', world: 'procedural-city', spawn:'urban-center', playerProfile:'mannequin' }
];
export function loadCatalog(storage) {
    let custom = [];
    try { custom = JSON.parse(storage.getItem(CATALOG_KEY) || '[]'); } catch { /* preserve built-in scenes */ }
    if (!Array.isArray(custom)) custom = [];
    const ids = new Set(BUILTIN_SCENES.map(s => s.id));
    return [...BUILTIN_SCENES, ...custom.filter(s => {
        if (!s || typeof s.id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(s.id) || ids.has(s.id) || !WORLD_IDS.includes(s.world)) return false;
        ids.add(s.id); return true;
    }).map(s => ({ id: s.id, name: String(s.name).slice(0, 80), world: s.world,
        ...(['dds','mannequin'].includes(s.playerProfile) ? {playerProfile:s.playerProfile} : {}),
        ...(typeof s.parentId === 'string' ? {parentId:s.parentId} : {}), ...(typeof s.spawn === 'string' ? {spawn:s.spawn.slice(0,80)} : {}) }))];
}
export function createScene(storage, name, world, id, options = {}) {
    if (!name.trim() || !WORLD_IDS.includes(world) || !/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Nome o mappa della scena non validi.');
    const list = loadCatalog(storage);
    if (list.some(s => s.id === id)) throw new Error('ID scena già presente.');
    const scene = { id, name: name.trim().slice(0, 80), world,
        ...(['dds','mannequin'].includes(options.playerProfile) ? {playerProfile:options.playerProfile} : {}),
        ...(options.parentId ? {parentId:options.parentId} : {}), ...(options.spawn ? {spawn:options.spawn} : {}) };
    storage.setItem(CATALOG_KEY, JSON.stringify([...list.filter(s => !BUILTIN_SCENES.some(b => b.id === s.id)), scene]));
    return scene;
}
