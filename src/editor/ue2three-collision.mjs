import * as THREE from 'three';

export function forEachCollisionChunk(root, consume) {
        // cannon-es stores Trimesh indices in Int16Array. Keep each shape below
        // 32768 vertices; a whole exported level can easily exceed that limit.
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
                for (let i = 0; i + 2 < count; i += 3) {
                    if (vertices.length / 3 + 3 > 30000) flush();
                    for (const corner of corners) {
                        point.fromBufferAttribute(position, source ? source.getX(i + corner) : i + corner).applyMatrix4(matrix);
                        indices.push(vertices.length / 3);
                        vertices.push(point.x, point.y, point.z);
                    }
                }
            }
        });
        flush();
        return chunks;
}
