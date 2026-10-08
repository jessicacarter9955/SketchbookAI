import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const base=process.env.URBAN_URL||'http://127.0.0.1:8401';
const out=(process.env.URBAN_ARTIFACTS||'artifacts')+'/assets';await fs.mkdir(out,{recursive:true});
const reports=[];
for(const asset of ['brick','residential','tree','bench','lamp','materials']){
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1100,height:850},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${base}/urban-assets.html?asset=${asset}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>globalThis.__urbanAsset?.ready||globalThis.__urbanAsset?.error,null,{polling:500,timeout:90000});
    const shot=await page.evaluate(()=>({report:__urbanAsset.report,error:__urbanAsset.error,data:__urbanAsset.capture?.()}));
    if(shot.error||errors.length||!shot.data?.startsWith('data:image/png;base64,'))throw Error(JSON.stringify({asset,error:shot.error,errors}));
    await fs.writeFile(`${out}/${asset}.png`,Buffer.from(shot.data.split(',')[1],'base64'));reports.push(shot.report);
    console.log('Asset verified:',asset,shot.report.assetId);
  }finally{await browser.close();}
}
await fs.writeFile(`${out}/proof.json`,JSON.stringify({commit:process.env.GITHUB_SHA||null,assets:reports},null,2));
