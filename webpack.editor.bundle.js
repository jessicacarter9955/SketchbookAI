const path = require('path');
// The editor imports Three.js/TypeScript packages, which browsers cannot resolve as bare modules.
// Keep the original Sketchbook global UMD player, compile the editor into a second browser bundle.
module.exports = {
  mode: 'production',
  entry: './src/editor/start.js',
  output: {filename: 'build/editor.bundle.js',path: __dirname},
  resolve: {extensions: ['.mjs','.js','.ts','.tsx']},
  module: {rules: [
    {test:/\\.tsx?$/,use:'ts-loader',exclude:/node_modules/},
    {test:/\\.css$/,use:['style-loader','css-loader']}
  ]},
  performance:{hints:false},
  devtool:false
};
