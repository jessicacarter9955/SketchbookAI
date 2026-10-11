/** Small, local browser audit. Screenshots are evidence, not a claim of UE fidelity. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';

const [url, directory] = process.argv.slice(2);
if (!url || !directory || !/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) {
    throw new Error('Usage: node visual-audit.mjs <loopback scene URL> <output directory>');
}
const output = path.resolve(directory);
await fs.mkdir(output, {recursive:true});
const report = {schema_version:1, url, created_at:new Date().toISOString(),
    fidelity:'not_verified_against_source', errors:[], views:[]};
let page, browser;
try {
    const require = createRequire(import.meta.url);
    const {chromium} = require(process.env.UE2THREE_PLAYWRIGHT_PATH || 'playwright');
    browser = await chromium.launch({channel:'chrome', headless:true});
    page = await browser.newPage({viewport:{width:1120,height:700},deviceScaleFactor:1});
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if(message.type()==='error') report.errors.push(message.text()); });
    page.on('response', response => { if(response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(url, {waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(() => window.__ue2threeAudit?.ready || window.__ue2threeAudit?.error, null, {timeout:30000});
    const error = await page.evaluate(() => window.__ue2threeAudit.error);
    if(error) throw new Error(error);
    report.scene = await page.evaluate(() => window.__ue2threeAudit.stats());
    if(report.scene.invalid_vertices) report.errors.push('Scene contains non-finite vertices');
    for (const view of ['overview','ground','detail']) {
        await page.evaluate(view => window.__ue2threeAudit.setView(view),view);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const filename = view + '.png';
        await page.screenshot({path:path.join(output,filename)});
        const pixels = await page.evaluate(() => window.__ue2threeAudit.pixels());
        const framing=await page.evaluate(()=>window.__ue2threeAudit.framing || null);
        report.views.push({name:view,image:filename,...pixels,framing});
        if(pixels.distinct_colors < 8) report.errors.push(`${view}: render appears empty or uniform`);
        if(pixels.dark_fraction > 0.85) report.errors.push(`${view}: over 85% of the scene is almost black`);
    }
    report.status = report.errors.length ? 'failed' : 'captured';
} catch(error) {
    report.errors.push(error.message); report.status = 'failed';
    if(page) {
        await page.screenshot({path:path.join(output,'failed.png')})
            .then(()=>report.views.push({name:'Caricamento non riuscito',image:'failed.png'})).catch(()=>{});
        report.page_status=await page.locator('#status').textContent().catch(()=>null);
    }
} finally { if(browser) await browser.close(); }
const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
await fs.writeFile(path.join(output,'index.html'),`<!doctype html><html lang="it"><meta charset="utf-8"><title>ue2three · Verifica visiva</title><style>body{font:16px system-ui;background:#101923;color:#ecf3f9;margin:24px;max-width:1150px}img{width:100%;border:1px solid #496176}p{color:#bacbd8}section{margin:30px 0}pre{white-space:pre-wrap}</style><h1>Verifica visiva della mappa</h1><p>${esc(report.created_at)} · ${esc(report.status)}. Screenshot acquisiti automaticamente; fedeltà al progetto Unreal ancora da verificare.</p>${report.views.map(v=>`<section><h2>${esc(v.name)}</h2><img src="${esc(v.image)}" alt="${esc(v.name)}"></section>`).join('')}<h2>Risultati</h2><pre>${esc(JSON.stringify(report,null,2))}</pre></html>`);
console.log(JSON.stringify({status:report.status,report:path.join(output,'report.json'),gallery:path.join(output,'index.html'),errors:report.errors}));
if(report.status === 'failed') process.exitCode=1;
