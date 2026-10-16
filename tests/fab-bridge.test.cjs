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
