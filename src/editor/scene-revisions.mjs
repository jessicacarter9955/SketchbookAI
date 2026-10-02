import { validateScene } from './scene-data.mjs';
import { createScene, CATALOG_KEY } from './scene-catalog.mjs';

export const sceneStorageKey = id => id === 'sandbox' ? 'sketchbook.scene.v1' : `sketchbook.scene.${id}`;
export function loadRevisions(storage, key) {
    try { const list = JSON.parse(storage.getItem(`${key}.revisions`) || '[]'); return Array.isArray(list) ? list.filter(r => r && typeof r.id === 'string' && r.scene) : []; }
    catch { return []; }
}
export function saveRevision(storage, key, scene, label, id, time = new Date().toISOString()) {
    const record = { id, label: String(label || 'Revisione').slice(0, 80), time, scene: validateScene(scene) };
    const previous = loadRevisions(storage, key);
    if (previous.some(r => r.id === id)) throw new Error('ID revisione già esistente.');
    // Keep the initial snapshot and the 19 most recent checkpoints.
    const list = [...previous, record]; if (list.length > 20) list.splice(1, list.length - 20);
    storage.setItem(`${key}.revisions`, JSON.stringify(list)); return record;
}
export function forkScene(storage, parent, scene, name, id) {
    const state = validateScene(scene);
    if (state.world && state.world !== parent.world) throw new Error('Mappa della copia non corrispondente.');
    const key = sceneStorageKey(id), catalog = storage.getItem(CATALOG_KEY);
    if (storage.getItem(key) !== null) throw new Error('La copia esiste già.');
    try {
        const copy = createScene(storage, name, parent.world, id, { parentId: parent.id, spawn: parent.spawn });
        storage.setItem(key, JSON.stringify(state));
        saveRevision(storage, key, state, 'Versione iniziale della copia', `${id}-initial`);
        return copy;
    } catch (error) {
        if (catalog === null) storage.removeItem(CATALOG_KEY); else storage.setItem(CATALOG_KEY, catalog);
        storage.removeItem(key); storage.removeItem(`${key}.revisions`); throw error;
    }
}
