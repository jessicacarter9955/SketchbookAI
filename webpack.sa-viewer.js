// Browser-only exploration of legally sourced GTA SA nodes and converted GLB meshes.
const path=require('path');
module.exports={
 mode:'production',
 entry:'./src/editor/sa-viewer.js',
 output:{filename:'sa-viewer.bundle.js',path:path.resolve(__dirname,'build'),publicPath:'auto'},
 resolve:{extensions:['.js','.mjs','.ts']},
 optimization:{minimize:true},performance:{hints:false}
};
