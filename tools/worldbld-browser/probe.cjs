/**
 * Read-only onboarding probe for Lightning AI and WorldBLD.
 * No sign-up attempts, no payments, no GPU allocation, no use of credentials.
 * Browser screenshots and a machine-readable report are uploaded by GitHub Actions.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const OUTPUT = path.join(__dirname, 'results');
fs.mkdirSync(OUTPUT, { recursive: true });
const targets = [
  { name: 'lightning-signup', url: 'https://lightning.ai/sign-up' },
  { name: 'worldbld-tools', url: 'https://worldbld.com/tools' },
  { name: 'worldbld-download', url: 'https://worldbld.com/download' },
  { name: 'worldbld-login', url: 'https://worldbld.com/login' },
  { name: 'worldbld-plans', url: 'https://worldbld.com/plans' },
];
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const reports = [];
  try {
    for (const target of targets) {
      const page = await browser.newPage({ viewport: { width: 1365, height: 900 }, deviceScaleFactor: 1 });
      const rec = { name: target.name, url: target.url };
      try {
        const response = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(2500);
        rec.status = response ? response.status() : null;
        rec.finalUrl = page.url();
        rec.title = await page.title();
        rec.content = (await page.locator('body').innerText({ timeout: 8000 }).catch(() => ''))
          .replace(/\s+/g, ' ').slice(0, 5000);
        rec.buttons = (await page.locator('button').allTextContents().catch(() => []))
          .map(x => x.trim()).filter(Boolean).slice(0, 40);
        rec.links = (await page.locator('a').evaluateAll(els => els.map(a => ({
          text: (a.innerText || '').trim().slice(0, 80), href: a.href,
        })).filter(a => a.text || /sign|login|register|download|free|trial|plan/i.test(a.href)).slice(0, 35)).catch(() => []));
        rec.visibleInputs = await page.locator('input:visible').evaluateAll(els => els.map(i => ({
          type: i.type, placeholder: i.placeholder, autocomplete: i.autocomplete,
        }))).catch(() => []);
        await page.screenshot({ path: path.join(OUTPUT, target.name + '.png'), fullPage: true, timeout: 10000 });
      } catch (e) { rec.error = String(e); }
      reports.push(rec);
      if (['worldbld-plans', 'worldbld-tools', 'worldbld-download', 'lightning-signup'].includes(rec.name)) {
        console.log('PUBLIC_SITE_DIAGNOSTIC', JSON.stringify({ name: rec.name, title: rec.title,
          content: (rec.content || '').slice(0, 2100), links: (rec.links || []).slice(0, 14),
          buttons: (rec.buttons || []).slice(0, 20) }));
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUTPUT, 'report.json'), JSON.stringify({
    timestamp: new Date().toISOString(), readOnly: true, gpuInstancesStarted: 0,
    accountsCreated: 0, moneySpent: 0, reports,
  }, null, 2));
  const rows = reports.map(r => '| ' + r.name + ' | ' + (r.status ?? '—') + ' | ' +
    (r.error ? r.error.replace(/\|/g, '/').slice(0, 120) : (r.title || '').replace(/\|/g, '/')) + ' |');
  const md = ['# WorldBLD / Lightning browser probe', '',
    'Read-only. No authentication, account creation, GPU activation, or billing.',
    '', '| Website | HTTP | Page title / error |', '| --- | --- | --- |', ...rows, ''].join('\n');
  fs.writeFileSync(path.join(OUTPUT, 'summary.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(md);
  // The probe succeeds if any target was reachable: failed pages remain visible in artifacts.
  if (!reports.some(r => r.status && r.status < 400)) process.exitCode = 1;
})().catch(err => { console.error(err); process.exitCode = 1; });
