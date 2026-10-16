const test = require('node:test');
const assert = require('node:assert/strict');
const { zipStore, allowedOrigin, server } = require('../tools/fab-bridge.cjs');
const { FabClient } = require('../src/editor/fab-client.js');

test('Fab bridge refuses foreign browser origins', () => {
    assert.equal(allowedOrigin({headers:{origin:'https://example.com'}}), null);
    assert.equal(allowedOrigin({headers:{origin:'http://localhost:8765'}}), null);
    assert.equal(allowedOrigin({headers:{origin:'http://127.0.0.1:8401'}}), 'http://127.0.0.1:8401');
    assert.equal(allowedOrigin({headers:{origin:'http://localhost:8001'}}), 'http://localhost:8001');
    assert.equal(allowedOrigin({headers:{origin:'http://evil.example:8401'}}), null);
});
test('Fab zip packager creates standard entries without relying on external zip tools', () => {
    const data = Buffer.from('glTF test');
    const output = zipStore([{name:'scene.gltf',bytes:data}]);
    assert.equal(output.readUInt32LE(0), 0x04034b50);
    assert.equal(output.readUInt32LE(output.length-22), 0x06054b50);
    assert.equal(output.readUInt16LE(output.length-22+10), 1);
    assert.ok(output.includes(data));
});
test('Fab search translates a provider response to model picker metadata', async () => {
    const client = new FabClient(async (url) => {
        assert.ok(url.includes('/search?q=BMW'));
        return {ok:true,json:async()=>({results:[{
            uid:'12345678-aaaa-4567-89ab-123456789abc',title:'BMW 3D',owned:true,
            thumbnail_url:'https://example.com/bmw.png',publisher:{name:'Example'},
            license_type:'Fab Standard'}]})};
    });
    const result = await client.search('BMW');
    assert.equal(result.results.length,1);
    assert.equal(result.results[0].provider,'fab');
    assert.equal(result.results[0].owned,true);
    assert.equal(result.results[0].license.label,'Fab Standard');
});
test('Fab download URL is restricted to the local bridge', async () => {
    const client = new FabClient(async (_, options) => {
        assert.equal(options.method,'POST');
        return {ok:true,json:async()=>({path:'/assets/00000000-0000-4000-8000-000000000000'})};
    });
    assert.equal(await client.download('12345678-abcd'), 'http://127.0.0.1:8765/assets/00000000-0000-4000-8000-000000000000');
});
test('Fab bridge serves local routes but does not allow cross-site downloads', async () => {
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const address = 'http://127.0.0.1:' + server.address().port;
    try {
        const blocked = await fetch(address+'/download', {method:'POST',headers:{'Origin':'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({uid:'demo'})});
        assert.equal(blocked.status,403);
        const malformed = await fetch(address+'/download', {method:'POST',headers:{Origin:'http://127.0.0.1:8401','Content-Type':'application/json'},body:JSON.stringify({uid:'../etc/passwd'})});
        assert.equal(malformed.status,400);
    } finally { await new Promise(resolve => server.close(resolve)); }
});

const {handler,normalizeListing,searchPublicFab} = require('../netlify/functions/fab-catalog.cjs');

test('online Fab catalog lists only validated metadata without authenticated ownership claims', async () => {
    const listing=normalizeListing({uid:'abcdefab-1234-1234-1234-abcdefabcdef',
        title:'BMW M8',thumbnail_url:'https://example.org/bmw.webp',
        publisher:{name:'Studio'},licenses:[{name:'Fab Standard'}]});
    assert.equal(listing.uid,'abcdefab-1234-1234-1234-abcdefabcdef');
    assert.equal(listing.owned,null);
    assert.equal(listing.thumbnail_url,'https://example.org/bmw.webp');
    assert.equal(normalizeListing({uid:'../download',title:'Invalid'}),null);
});
test('online Fab catalog bridge uses only Fab fixed URL and query encoding', async () => {
    let requested;
    const data=await searchPublicFab('BMW & Ferrari',async(url,opts)=>{
        requested=new URL(url);assert.equal(opts.method,'GET');
        return {ok:true,text:async()=>JSON.stringify({results:[{uid:'abcdefab-1234-1234-1234-abcdefabcdef',title:'BMW'}]})};
    });
    assert.equal(requested.origin,'https://www.fab.com');
    assert.equal(requested.pathname,'/i/listings/search');
    assert.equal(requested.searchParams.get('q'),'BMW & Ferrari');
    assert.equal(data.downloadable,false);
    assert.equal(data.results.length,1);
});
test('online Fab bridge does not expose an unauthenticated download route',async()=>{
    const status=await handler({httpMethod:'GET',queryStringParameters:{operation:'status'}});
    const info=JSON.parse(status.body);
    assert.equal(info.connected,false);
    assert.equal(info.downloadable,false);
    const download=await handler({httpMethod:'POST',queryStringParameters:{operation:'download'}});
    assert.equal(download.statusCode,405);
    const invalid=await handler({httpMethod:'GET',queryStringParameters:{operation:'search',q:'x'}});
    assert.equal(invalid.statusCode,400);
});
test('Fab client uses authenticated hosted bridge from Netlify and preserves localhost mode',async()=>{
    const original=globalThis.location;
    globalThis.location={hostname:'my-test-site3.netlify.app'};
    try {
        let requested,headers;
        const online=new FabClient(async(url,options)=>{
            requested=url; headers=options.headers;
            return {ok:true,json:async()=>({results:[{uid:'abcde123-1234-1234-1234-abcdefabcdef',title:'Lambo'}]})};
        });
        online.key='test-private-key';
        const found=await online.search('Lambo');
        assert.ok(requested.startsWith('https://sketchbook-fab-bridge.onrender.com/search?q=Lambo'));
        assert.equal(headers['X-Fab-Bridge-Key'],'test-private-key');
        assert.equal(found.results[0].importAvailable,true);
        assert.equal(online.hosted,true);
        const local=new FabClient(async()=>({ok:true,json:async()=>({results:[]})}),'http://127.0.0.1:8765');
        assert.equal(local.hosted,false);
    }finally{globalThis.location=original;}
});
test('Fab cloud refuses operations without bridge key and rejects foreign origins',async()=>{
    process.env.FAB_BRIDGE_KEY='test-key-only-for-unit-test';
    const {server:cloud, isAllowedOrigin} = require('../fab-cloud/server.cjs');
    assert.equal(isAllowedOrigin('https://evil.example'),false);
    assert.equal(isAllowedOrigin('https://my-test-site3.netlify.app'),true);
    await new Promise(resolve=>cloud.listen(0,'127.0.0.1',resolve));
    try {
        const address='http://127.0.0.1:'+cloud.address().port;
        const unauthorized=await fetch(address+'/search?q=BMW');
        assert.equal(unauthorized.status,401);
        const health=await fetch(address+'/health');
        assert.equal(health.status,200);
        assert.equal((await health.json()).bridge,true);
        const origin=await fetch(address+'/search?q=BMW',{headers:{Origin:'https://evil.example'}});
        assert.equal(origin.status,403);
    }finally{await new Promise(resolve=>cloud.close(resolve));}
});
