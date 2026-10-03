export const SURFACE_STYLES = { grass: 'Erba animata', asphalt: 'Asfalto', sand: 'Sabbia' };
export const MAX_SURFACE_EDITS = 32;

export function validateSurfaceEdits(edits) {
    if (!Array.isArray(edits) || edits.length > MAX_SURFACE_EDITS) throw new Error('Massimo 32 modifiche alla mappa.');
    const ids = new Set();
    return edits.map(edit => {
        if (!edit || typeof edit.id !== 'string' || !edit.id || edit.id.length > 100 || ids.has(edit.id)) throw new Error('ID modifica mappa non valido.');
        ids.add(edit.id);
        if (!Object.hasOwn(SURFACE_STYLES, edit.style) || typeof edit.texture !== 'string' || edit.texture.length > 200) throw new Error('Materiale della superficie non valido.');
        const b = edit.bounds;
        if (!Array.isArray(b) || b.length !== 6 || !b.every(n => Number.isFinite(n) && Math.abs(n) <= 10000) ||
            [0,1,2].some(i => b[i+3] <= b[i]) || b[3]-b[0] > 200 || b[5]-b[2] > 200 || b[4]-b[1] > 20) throw new Error('Area non valida: massimo 200 × 200 metri, altezza 20 metri.');
        if (!Number.isInteger(edit.seed) || edit.seed < 0 || edit.seed > 2147483647 || !Number.isFinite(edit.density) || edit.density < 1 || edit.density > 40 || !Number.isFinite(edit.height) || edit.height < 0.1 || edit.height > 1.5) throw new Error('Parametri erba non validi.');
        return { id:edit.id, name:String(edit.name || SURFACE_STYLES[edit.style]).slice(0,80), texture:edit.texture, style:edit.style,
            bounds:[...b], seed:edit.seed, density:edit.density, height:edit.height };
    });
}

export function insideBounds(p, b) { return [0,1,2].every(i => p[i] >= b[i] - 1e-6 && p[i] <= b[i+3] + 1e-6); }
export function intersectsBounds(a, b) { return [0,1,2].every(i => a[i] <= b[i+3] && a[i+3] >= b[i]); }

// Clip the actual triangles, not just their centers, so paint never crosses the selection edge.
export function clipTriangle(triangle, bounds) {
    let polygon = triangle.map(p => [...p]);
    for (let axis=0;axis<3;axis++) for (const side of [0,1]) {
        const edge=bounds[axis+side*3], sign=side ? -1 : 1, next=[];
        for (let i=0;i<polygon.length;i++) {
            const a=polygon[i], b=polygon[(i+1)%polygon.length], da=(a[axis]-edge)*sign, db=(b[axis]-edge)*sign;
            if (da >= -1e-8) next.push(a);
            if ((da >= -1e-8) !== (db >= -1e-8)) { const t=da/(da-db); next.push(a.map((v,j)=>v+(b[j]-v)*t)); }
        }
        polygon=next; if (polygon.length<3) return [];
    }
    const output=[];
    for (let i=1;i<polygon.length-1;i++) output.push([polygon[0],polygon[i],polygon[i+1]]);
    return output;
}

export function triangleArea(t) {
    const a=t[1].map((v,i)=>v-t[0][i]), b=t[2].map((v,i)=>v-t[0][i]);
    return Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])/2;
}

export function randomGenerator(seed) {
    let state=seed >>> 0;
    return () => { state=(Math.imul(1664525,state)+1013904223)>>>0; return state/4294967296; };
}

export function collectSurface(vertices, groups, edit) {
    const triangles=[]; let area=0;
    for (const group of groups) {
        if ((group.texture || '') !== edit.texture) continue;
        for (let i=group.start;i<group.start+group.count;i+=3) {
            const t=[0,1,2].map(j=>Array.from(vertices.subarray((i+j)*8,(i+j)*8+3)));
            if (!t.every(p=>p.length===3 && p.every(Number.isFinite))) continue;
            const min=[0,1,2].map(a=>Math.min(...t.map(p=>p[a]))), max=[0,1,2].map(a=>Math.max(...t.map(p=>p[a])));
            if (!intersectsBounds([...min,...max],edit.bounds)) continue;
            const a=t[1].map((v,j)=>v-t[0][j]), b=t[2].map((v,j)=>v-t[0][j]);
            const normal=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
            if (Math.abs(normal[1]) < Math.hypot(...normal)*0.65) continue; // Skip walls and steep slopes.
            if (normal[1]<0) [t[1],t[2]]=[t[2],t[1]];
            for (const clipped of clipTriangle(t,edit.bounds)) {
                const size=triangleArea(clipped); if (size<1e-7) continue;
                triangles.push(clipped); area+=size;
            }
        }
    }
    return {triangles,area};
}
