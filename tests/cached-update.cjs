const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Run against an isolated ST profile. A forwarding server changes only the
// extension assets. Do not use page.route: it disables the browser HTTP cache.
const upstream = new URL(process.env.ST_URL || 'http://127.0.0.1:8000');
const port = Number(process.env.CACHE_FIXTURE_PORT || 8011);
const origin = `http://127.0.0.1:${port}`;
const artifactDir = process.env.ARTIFACT_DIR || path.join(os.tmpdir(), 'novel-generation-cache');
const repo = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'manifest.json'), 'utf8'));
const currentJs = fs.readFileSync(path.join(repo, 'index.js'), 'utf8');
const currentCss = fs.readFileSync(path.join(repo, 'style.css'), 'utf8');
const runtimeVersion = currentJs.match(/const VERSION = '([^']+)'/)[1];
assert.equal(runtimeVersion, manifest.version, 'manifest and runtime versions must match');
for (const [field, filename] of [['js', 'index.js'], ['css', 'style.css']]) {
  const asset = new URL(manifest[field], 'http://extension.test/');
  assert.equal(asset.pathname, `/${filename}`);
  assert.equal(asset.searchParams.get('v'), manifest.version, 'asset URLs must advance with each release');
}
const oldJs = currentJs.replace(`const VERSION = '${runtimeVersion}'`, "const VERSION = '0.8.0'");
const oldCss = '/* cached-0.8.0 */\n' + currentCss;
const oldManifest = { ...manifest, version: '0.8.0', js: 'index.js', css: 'style.css' };
fs.mkdirSync(artifactDir, { recursive: true });

(async () => {
  let updated = false;
  const assetRequests = [], cacheClearingResponses = [], forwardingErrors = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, origin);
    const asset = url.pathname.match(/^\/scripts\/extensions\/(.+\/novel-generation)\/(manifest\.json|index\.js|style\.css)$/);
    if (asset) {
      assetRequests.push({ url: req.url, updated });
      if (asset[2] === 'manifest.json') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(updated ? manifest : oldManifest));
      }
      const isJs = asset[2] === 'index.js';
      const content = updated ? (isJs ? currentJs : currentCss) : (isJs ? oldJs : oldCss);
      res.writeHead(200, { 'Content-Type': isJs ? 'text/javascript' : 'text/css', 'Cache-Control': 'public, max-age=31536000, immutable' });
      return res.end(content);
    }
    const proxy = http.request({ hostname: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers: req.headers }, response => {
      if (response.headers['clear-site-data']) cacheClearingResponses.push(req.url);
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    proxy.on('error', error => { forwardingErrors.push(error.message); res.writeHead(502); res.end('Fixture forwarding failed'); });
    req.pipe(proxy);
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  let browser;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-cache-profile-'));
  try {
    const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
    // Persistent profiles enable WebKit's disk cache rather than a private,
    // ephemeral session. The profile remains intact for the entire update.
    const context = await engine.launchPersistentContext(profile, { headless: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...(engine === chromium && process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    browser = context;
    await context.addCookies([{ name: 'novel-cache-regression', value: 'keep', url: origin }]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    async function openStudio() {
      await page.waitForSelector('#ng-v051-open-studio', { state: 'attached' });
      await page.waitForTimeout(1200);
      await page.evaluate(() => document.getElementById('ng-v051-open-studio').click());
      await page.locator('#ng-studio-overlay').waitFor();
      await page.waitForTimeout(150);
    }
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await openStudio();
    const title = page.locator('#ng-studio-overlay .ng-studio-title small');
    assert.match(await title.innerText(), /^v0\.8\.0\b/);
    await page.screenshot({ path: path.join(artifactDir, 'cached-080.png') });
    const assets = await page.evaluate(() => ({
      js: [...document.scripts].find(n => /novel-generation\/index\.js$/.test(n.src)).src,
      css: [...document.querySelectorAll('link[rel="stylesheet"]')].find(n => /novel-generation\/style\.css$/.test(n.href)).href,
    }));
    await page.evaluate(() => localStorage.setItem('novel-cache-regression', 'keep'));
    const savedState = await page.evaluate(() => JSON.stringify(SillyTavern.getContext().extensionSettings.novelGeneration));
    const legacyRequests = () => assetRequests.filter(r => /\/(?:index\.js|style\.css)$/.test(r.url)).length;
    assert.equal(legacyRequests(), 2, 'warm both old files in the real HTTP cache');
    updated = true;
    // Normal navigation in the SAME context, with no cache/storage clearing and
    // no browser restart. New manifest URLs must escape the cached old assets.
    await page.goto(`${origin}/?novel-cache-update=1`, { waitUntil: 'domcontentloaded' });
    await openStudio();
    assert.ok((await title.innerText()).startsWith(`v${manifest.version} `));
    const loaded = await page.evaluate(() => ({
      js: [...document.scripts].find(n => /novel-generation\/index\.js\?/.test(n.src)).src,
      css: [...document.querySelectorAll('link[rel="stylesheet"]')].find(n => /novel-generation\/style\.css\?/.test(n.href)).href,
      local: localStorage.getItem('novel-cache-regression'),
      cookie: document.cookie.includes('novel-cache-regression=keep'),
      state: JSON.stringify(SillyTavern.getContext().extensionSettings.novelGeneration),
    }));
    assert.equal(new URL(loaded.js).searchParams.get('v'), manifest.version);
    assert.equal(new URL(loaded.css).searchParams.get('v'), manifest.version);
    assert.equal(loaded.local, 'keep'); assert.equal(loaded.cookie, true);
    assert.equal(loaded.state, savedState, 'saved API settings, seed and prompt draft must remain unchanged');
    assert.equal(legacyRequests(), 2, 'old unversioned URLs must not be requested during the update');
    const cached = await page.evaluate(async assets => ({
      js: await (await fetch(assets.js, { cache: 'force-cache' })).text(),
      css: await (await fetch(assets.css, { cache: 'force-cache' })).text(),
    }), assets);
    assert.ok(cached.js.includes("const VERSION = '0.8.0'"), `the old JS must still be cached after loading the new version: ${JSON.stringify(assetRequests)}`);
    assert.ok(cached.css.startsWith('/* cached-0.8.0 */'), 'the old stylesheet must still be cached');
    assert.equal(legacyRequests(), 2, 'old file reads must come from browser cache');
    assert.deepEqual(cacheClearingResponses, []); assert.deepEqual(forwardingErrors, []); assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(artifactDir, 'updated-081.png') });
    const report = { browser: engine.name(), before: '0.8.0', after: manifest.version, realHttpCache: true, legacyAssetsStillCached: true, cookiePreserved: loaded.cookie, localStoragePreserved: true, savedSettingsPreserved: true, cacheClearingResponses, assetRequests, browserErrors: errors };
    fs.writeFileSync(path.join(artifactDir, 'cache-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
