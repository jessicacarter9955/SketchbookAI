
const CACHE_NAME = 'file-drop-cache';
self.addEventListener('install', function(event) {
    console.log('Service Worker installing...');
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function(event) {
    console.log('Service Worker activating...');
    event.waitUntil(self.clients.claim());
});
let title='';

self.addEventListener('fetch', function(event) {
    let request = event.request;
    const url = request.url;
   

    let image = request.headers.get('accept')?.startsWith('image/') || /\.(jpg|jpeg|png|gif|bmp|ico|tiff|webp)(\?.*)?$/i.test(request.url);

    if (url.startsWith(self.location.origin)) {
        return event.respondWith((async () => {

            const networkResponse = await fetch(request);
            const cache = await caches.open(CACHE_NAME);

            const cachedResponse = await cache.match(request);
            if (cachedResponse && url.endsWith('/index.html')) {
                const indexContent = await cachedResponse.text();
                title = indexContent.match(/<title>(.*?)<\/title>/i)?.[1] || '';
                return new Response(indexContent, { status: 200, headers: { 'Content-Type': 'text/html' } });
            }
            
            if (networkResponse.status === 404) {
                
                if (request.headers.get('accept').includes('text/')) {
                    return new Response(null, { status: 404 });
                }
                
                if (cachedResponse && cachedResponse.status === 200)
                    return new Response(cachedResponse.body, { status: 200 });

                if (image)
                    return Response.redirect(GetRedirectImage(url), 302);

                throw new Error('Not found' + request.url);

            }
            cache.put(request, networkResponse.clone());
            return networkResponse;
        })().catch(async (e) => {
            console.error(e);
            const cache = await caches.open(CACHE_NAME);
            return await cache.match(request);
        }));
    }
   

    function GetRedirectImage(url) {
        let imageName = url.replace(/^https?:\/\/[^\/]+/, '')
        imageName = imageName.replace(/\W/g, ' ');
        let prompt = [title,imageName].join(' ');
        return 'https://image.pollinations.ai/prompt/'+ encodeURIComponent(prompt);
    }

   
});


self.addEventListener('message', function(event) {
    if (event.data.action === 'uploadFiles') {
        uploadFiles(event.data.files, event.data.chatId);
    }
});

async function uploadFiles(files) {
    files.forEach(async file => {
        const url = self.registration.scope +  file.name;
        const response = new Response(new Uint8Array(file.buffer));
        await caches.open(CACHE_NAME).then(cache => cache.put(url, response));
    });
}
