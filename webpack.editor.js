const path = require('path');
const common = require('./webpack.common.js');

module.exports = {
    ...common,
    mode: 'production',
    entry: './src/editor/start.js',
    output: {
        path: path.resolve(__dirname, 'build'),
        filename: 'editor.min.js',
        globalObject: 'globalThis'
    },
    // The world and renderer are provided by sketchbook.min.js. Share that
    // exact Three.js module instance so CSM lights, cameras, and editor GLTF
    // objects never cross duplicate Three.js class/runtime copies.
    externals: { three: 'THREE' },
    optimization: { minimize: true },
    performance: { hints: false }
};
