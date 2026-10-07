import { validateSurfaceEdits } from './surface-data.mjs';
import { WORLD_IDS, validateIsland } from './island-data.mjs';
import { validateUrban } from './urban-data.mjs';
export const PREFABS = ['box', 'building', 'road', 'tree', 'lamp', 'car', 'vehicle', 'pedestrian'];
export const SCENE_KEY = 'sketchbook.scene.v1';
export function validateScene(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.objects) || value.objects.length > 500)
        throw new Error('Scena non valida: versione 1, massimo 500 oggetti.');
    const ids = new Set();
    const objects = value.objects.map(item => {
        if (!item || typeof item.id !== 'string' || ids.has(item.id)) throw new Error('ID oggetto non valido o duplicato.');
        ids.add(item.id);
        if (!PREFABS.includes(item.prefab) && !(typeof item.assetId === 'string' && item.assetId.length <= 100))
            throw new Error('Oggetto senza prefab o modello.');
        for (const field of ['position', 'rotation', 'scale']) {
            if (!Array.isArray(item[field]) || item[field].length !== 3 || !item[field].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 10000))
                throw new Error('Trasformazione non valida.');
        }
        if (item.scale.some(n => n < 0.01 || n > 100)) throw new Error('Scala ammessa: 0.01–100.');
        return { id: item.id, name: String(item.name || 'Oggetto').slice(0, 120),
            ...(item.assetId ? { assetId: item.assetId } : { prefab: item.prefab }),
            position: [...item.position], rotation: [...item.rotation], scale: [...item.scale], collider: item.collider === true };
    });
    if (value.world !== undefined && !WORLD_IDS.includes(value.world)) throw new Error('Mappa scena non riconosciuta.');
    const mapEdits = value.mapEdits === undefined ? [] : validateSurfaceEdits(value.mapEdits);
    if (mapEdits.length && value.world !== 'liberty-city') throw new Error('Le modifiche alla mappa richiedono Liberty City.');
    if(value.generator !== undefined && !['procedural-island','procedural-city'].includes(value.world)) throw new Error('Generatore disponibile solo nelle scene procedurali.');
    const generator=value.generator === undefined ? undefined : value.world === 'procedural-city' ? validateUrban(value.generator) : validateIsland(value.generator);
    return { version: 1, ...(value.world ? { world: value.world } : {}), objects, ...(mapEdits.length ? {mapEdits} : {}), ...(generator ? {generator} : {}) };
}
export class History {
    constructor(initial, limit = 50) { this.states = [JSON.stringify(initial)]; this.index = 0; this.limit = limit; }
    push(scene) {
        const state = JSON.stringify(scene);
        if (state === this.states[this.index]) return;
        this.states.splice(this.index + 1);
        this.states.push(state);
        if (this.states.length > this.limit) this.states.shift();
        this.index = this.states.length - 1;
    }
    undo() { if (this.index > 0) return JSON.parse(this.states[--this.index]); }
    redo() { if (this.index < this.states.length - 1) return JSON.parse(this.states[++this.index]); }
}
