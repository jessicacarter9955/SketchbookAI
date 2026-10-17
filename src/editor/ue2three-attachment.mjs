// Apply the authored socket and local asset transform in the same order in every viewer.
export function applyAttachmentSocket(root, definition) {
    const socket = definition.socket_transform || definition.socketTransform;
    root.position.set(0, 0, 0);
    root.quaternion.set(0, 0, 0, 1);
    root.scale.set(1, 1, 1);
    if (socket) {
        for (const [key, length] of [['position', 3], ['quaternion', 4], ['scale', 3]])
            if (!Array.isArray(socket[key]) || socket[key].length !== length || socket[key].some(v => !Number.isFinite(v)))
                throw new Error(`Invalid source socket ${key}`);
        if (Math.abs(Math.hypot(...socket.quaternion) - 1) > 0.001 || socket.scale.some(v => v <= 0))
            throw new Error('Invalid source socket transform');
        root.position.fromArray(socket.position);
        root.quaternion.fromArray(socket.quaternion);
        root.scale.fromArray(socket.scale);
    }
    root.updateMatrix();
    return root;
}
