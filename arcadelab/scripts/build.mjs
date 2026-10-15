import{mkdir,copyFile}from'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const p of ['index.html','app.css','app.js','economy.js'])await copyFile(p,`dist/${p}`);
console.log('Static production build ready: dist/');