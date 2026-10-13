// Sketchbook City HD model assets, cached across reloads on a stable Netlify alias.
// Do not cache HTML, runtime bundles, login data, or any cross-origin responses.
const CACHE='sketchbook-hd-source-assets-20261013a';
const STATIC=/^\/(?:assets\/urban-kits\/|assets\/roadforge\/|build\/assets\/)/;
const MODEL=/\.(?:gltf|glb|bin|jpg|jpeg|png|webp|ktx2|hdr)(?:$)/i;
self.addEventListener('install',event=>{event.waitUntil(self.skipWaiting());});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    for(const name of await caches.keys())
      if(name.startsWith('sketchbook-hd-source-assets-')&&name!==CACHE)
        await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||!STATIC.test(url.pathname)||!MODEL.test(url.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const existing=await cache.match(event.request);
    if(existing)return existing;
    const response=await fetch(event.request);
    if(response.ok&&response.type==='basic'){
      // Storing is best-effort: browser quotas must not break the game.
      event.waitUntil(cache.put(event.request,response.clone()).catch(()=>{}));
    }
    return response;
  })());
});
