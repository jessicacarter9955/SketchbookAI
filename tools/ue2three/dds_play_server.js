// Lightweight DDS Play server; separate from ue2three conversion/dashboard jobs.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const PORT = Number(process.env.DDS_PLAY_PORT || 8430);
const types = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript',
  '.css':'text/css','.json':'application/json','.glb':'model/gltf-binary',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.webp':'image/webp','.gif':'image/gif','.wasm':'application/wasm'};
http.createServer((req,res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {res.writeHead(405);return res.end();}
  let file;
  try {file = path.resolve(ROOT, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));}
  catch {res.writeHead(400);return res.end();}
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {res.writeHead(403);return res.end();}
  if (file === ROOT) file = path.join(ROOT,'editor.html');
  fs.stat(file,(err,stat) => {
    if (err || !stat.isFile()) {res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length':stat.size,'Cache-Control':'no-store'});
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  });
}).listen(PORT,'127.0.0.1',()=>console.log('DDS_PLAY_READY',PORT,ROOT));
