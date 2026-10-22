import * as THREE from 'three';

export function forEachCollisionChunk(root, consume, {includeMesh = () => true, onStats = () => {}} = {}) {
        // cannon-es stores Trimesh indices in Int16Array. Keep each shape below
        // 32768 vertices; a whole exported level can easily exceed that limit.
        let vertices = [], indices = [];
        const point = new THREE.Vector3(), instanceMatrix = new THREE.Matrix4();
        const triangle = [new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
        const normal = new THREE.Vector3(), edge = new THREE.Vector3();
        let chunks = 0;
        const stats = {meshes:0, triangles:0, degenerate_triangles:0, chunks:0};
        root.updateWorldMatrix(true, true);
        const flush = () => {
            if (!indices.length) return;
            consume(vertices, indices);
            chunks++;
            vertices = []; indices = [];
        };
        root.traverse(node => {
            if (!node.isMesh || !node.geometry?.getAttribute('position') || !includeMesh(node)) return;
            stats.meshes++;
            const geometry = node.geometry, position = geometry.getAttribute('position');
            const instances = node.isInstancedMesh ? node.count : 1;
            for (let instance = 0; instance < instances; instance++) {
                const matrix = node.matrixWorld.clone();
                if (node.isInstancedMesh) { node.getMatrixAt(instance, instanceMatrix); matrix.multiply(instanceMatrix); }
                const source = geometry.index;
                const count = source ? source.count : position.count;
                const start = geometry.drawRange.start;
                const end = Math.min(count, start + geometry.drawRange.count);
                if (!Number.isSafeInteger(start) || start < 0 || start % 3 || (end - start) % 3)
                    throw Error(`Invalid collision triangle range: ${node.name}`);
                const corners = matrix.determinant() < 0 ? [0, 2, 1] : [0, 1, 2];
                for (let i = start; i + 2 < end; i += 3) {
                    for (let c = 0; c < 3; c++) {
                        const corner = corners[c];
                        const index = source ? source.getX(i + corner) : i + corner;
                        if (!Number.isSafeInteger(index) || index < 0 || index >= position.count)
                            throw Error(`Invalid collision vertex index: ${node.name}`);
                        point.fromBufferAttribute(position, index).applyMatrix4(matrix);
                        if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z))
                            throw Error(`Non-finite collision vertex: ${node.name}`);
                        triangle[c].copy(point);
                    }
                    normal.subVectors(triangle[1],triangle[0]).cross(edge.subVectors(triangle[2],triangle[0]));
                    if (normal.lengthSq() === 0) { stats.degenerate_triangles++; continue; }
                    if (vertices.length / 3 + 3 > 30000) flush();
                    for (const point of triangle) {
                        indices.push(vertices.length / 3);
                        vertices.push(point.x, point.y, point.z);
                    }
                    stats.triangles++;
                }
            }
        });
        flush();
        stats.chunks = chunks;
        onStats(stats);
        return chunks;
}
