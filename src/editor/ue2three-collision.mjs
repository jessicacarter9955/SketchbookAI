import * as THREE from 'three';

export function forEachCollisionChunk(root, consume) {
        // cannon-es stores Trimesh indices in Int16Array. Keep each shape below
        // 32768 vertices; a whole exported level can easily exceed that limit.
        // Imports may be processed before the first render-frame matrix update.
        root.updateWorldMatrix(true, true);
        let vertices = [], indices = [];
        const point = new THREE.Vector3(), instanceMatrix = new THREE.Matrix4();
        let chunks = 0;
        const flush = () => {
            if (!indices.length) return;
            consume(vertices, indices);
            chunks++;
            vertices = []; indices = [];
        };
        root.traverse(node => {
            if (!node.isMesh || !node.geometry?.getAttribute('position')) return;
            const geometry = node.geometry, position = geometry.getAttribute('position');
            const instances = node.isInstancedMesh ? node.count : 1;
            for (let instance = 0; instance < instances; instance++) {
                const matrix = node.matrixWorld.clone();
                if (node.isInstancedMesh) { node.getMatrixAt(instance, instanceMatrix); matrix.multiply(instanceMatrix); }
                const source = geometry.index;
                const count = source ? source.count : position.count;
                const corners = matrix.determinant() < 0 ? [0, 2, 1] : [0, 1, 2];
                const triangle = new Float64Array(9);
                for (let i = 0; i + 2 < count; i += 3) {
                    let valid = true;
                    for (let corner = 0; corner < 3; corner++) {
                        const index = source ? source.getX(i + corners[corner]) : i + corners[corner];
                        if (!Number.isInteger(index) || index < 0 || index >= position.count) { valid = false; break; }
                        point.fromBufferAttribute(position, index).applyMatrix4(matrix);
                        if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
                            valid = false; break;
                        }
                        triangle.set([point.x, point.y, point.z], corner * 3);
                    }
                    if (!valid) continue;
                    const ax = triangle[3] - triangle[0], ay = triangle[4] - triangle[1], az = triangle[5] - triangle[2];
                    const bx = triangle[6] - triangle[0], by = triangle[7] - triangle[1], bz = triangle[8] - triangle[2];
                    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
                    // Degenerate or malformed faces can produce invalid Cannon Trimesh normals.
                    if (!(cx * cx + cy * cy + cz * cz > 1e-16)) continue;
                    if (vertices.length / 3 + 3 > 30000) flush();
                    for (let corner = 0; corner < 3; corner++) {
                        indices.push(vertices.length / 3);
                        vertices.push(triangle[corner * 3], triangle[corner * 3 + 1], triangle[corner * 3 + 2]);
                    }
                }
            }
        });
        flush();
        return chunks;
}
