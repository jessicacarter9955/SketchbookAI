// Production entry for the standalone City Player.
// Native browsers do not resolve bare specifiers such as "three" from source files.
const path=require('path');
module.exports={
  mode:'production',
  entry:'./src/editor/start.js',
  output:{
    filename:'editor.bundle.js',
    path:path.resolve(__dirname,'build'),
    publicPath:'auto'
  },
  resolve:{extensions:['.js','.mjs','.ts']},
  experiments:{topLevelAwait:true},
  optimization:{minimize:true},
  performance:{hints:false},
  devtool:false
};
