const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Requires an isolated ST server with enableCorsProxy:false. Uses a local
// upstream without CORS headers, exercising the actual ST status/generate routes.
const studioUrl = process.env.ST_URL || 'http://127.0.0.1:8000';
const port = Number(process.env.FIXTURE_PORT || 8010);
const provider = `http://127.0.0.1:${port}/v1`;
const artifactDir = process.env.ARTIFACT_DIR || path.join(os.tmpdir(), 'novel-generation-hosted');
fs.mkdirSync(artifactDir, { recursive: true });

(async () => {
  const requests = [];
  let fixture, failGeneration = false;
  const upstream = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method, path: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && req.url === '/v1/models') return res.end(JSON.stringify({ data: ['gpt-4o', 'nai-diffusion-5-full', 'nai-diffusion-4-5-full'].map(id => ({ id })) }));
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      res.writeHead(failGeneration ? 500 : 200);
      return res.end(JSON.stringify(failGeneration ? { error: { message: 'Fixture failure' } } : { choices: [{ message: { content: `data:image/png;base64,${fixture}` } }] }));
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(resolve => upstream.listen(port, '127.0.0.1', resolve));
  const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
  let browser;
  try {
    browser = await engine.launch({ headless: true, ...(engine === chromium && process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [], corsErrors = [], bridgedBodies = [];
    // WebKit reports a rejected CORS fetch as a page error even when caught.
    page.on('pageerror', error => (/due to access control checks\.$/.test(error.message) ? corsErrors : errors).push(error.message));
    page.on('request', req => {
      if (req.url().endsWith('/api/backends/chat-completions/generate')) bridgedBodies.push(JSON.parse(req.postDataJSON().custom_include_body));
    });
    await page.goto(studioUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#ng-v051-open-studio', { state: 'attached' });
    await page.waitForTimeout(1200);
    fixture = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 832; c.height = 1216;
      const g = c.getContext('2d'); g.fillStyle = '#181818'; g.fillRect(0, 0, 832, 1216);
      g.fillStyle = '#eee'; g.font = '24px sans-serif'; g.fillText('Local backend test fixture', 220, 610);
      return c.toDataURL('image/png').split(',')[1];
    });
    assert.equal((await page.request.get(`${studioUrl}/proxy/${provider}/models`)).status(), 404, 'test ST must have generic proxy disabled');
    const chatBefore = await page.evaluate(() => JSON.stringify(SillyTavern.getContext().chatCompletionSettings));
    await page.evaluate(() => {
      const s = SillyTavern.getContext().extensionSettings.novelGeneration;
      delete s.serverBridgeBaseUrl; delete s.corsProxyBaseUrl;
      document.getElementById('ng-v051-open-studio').click();
    });
    const root = page.locator('#ng-studio-overlay');
    const connection = root.locator('[data-focus="connection"]');
    if (!await connection.evaluate(n => n.open)) await connection.locator('summary').click();
    await root.locator('#ng-studio-base').fill(provider);
    await root.locator('#ng-studio-api-key').fill('fixture-image-key');
    await root.locator('#ng-studio-connect').click();
    await page.waitForFunction(() => !document.getElementById('ng-studio-connect').disabled);
    assert.match(await root.locator('#ng-studio-connection-status').innerText(), /Connected via SillyTavern/);
    assert.deepEqual(await root.locator('#ng-studio-model option').evaluateAll(nodes => nodes.map(n => n.value)), ['nai-diffusion-5-full', 'nai-diffusion-4-5-full']);
    assert.equal(requests.some(r => r.method === 'OPTIONS'), true, 'direct browser CORS must actually fail');
    assert.equal(await page.evaluate(() => SillyTavern.getContext().extensionSettings.novelGeneration.serverBridgeBaseUrl), provider);
    // Migration also uses the same real server routes, with no cached bridge.
    await page.evaluate(provider => {
      const s = SillyTavern.getContext().extensionSettings.novelGeneration;
      delete s.serverBridgeBaseUrl; s.corsProxyBaseUrl = provider;
    }, provider);
    await root.locator('#ng-studio-connect').click();
    await page.waitForFunction(() => !document.getElementById('ng-studio-connect').disabled);
    assert.match(await root.locator('#ng-studio-connection-status').innerText(), /Connected via SillyTavern/);
    await root.locator('#ng-studio-model').selectOption('nai-diffusion-5-full');
    if (await connection.evaluate(n => n.open)) await connection.locator('summary').click();
    const prompt = root.locator('[data-focus="prompt"]');
    if (!await prompt.evaluate(n => n.open)) await prompt.locator('summary').click();
    await root.locator('#ng-prompt').fill('portrait of an adult traveler, brown eyes, soft natural lighting');
    await root.locator('#ng-negative').fill('blurry, text, watermark');
    await root.locator('#ng-generate').click();
    await root.locator('#ng-preview img').first().waitFor();
    await page.waitForFunction(() => !document.getElementById('ng-generate').disabled);
    let generations = requests.filter(r => r.method === 'POST');
    assert.equal(generations.length, 1, 'native probes and unavailable images route cannot generate');
    assert.deepEqual(generations[0].body, bridgedBodies[0], 'the real ST backend must preserve every provider field');
    assert.equal(generations[0].headers.authorization, 'Bearer fixture-image-key');
    assert.equal(generations[0].headers['x-csrf-token'], undefined, 'ST CSRF token must stay on same-origin request');
    failGeneration = true;
    await root.locator('#ng-generate').click();
    await page.waitForFunction(() => !document.getElementById('ng-generate').disabled);
    generations = requests.filter(r => r.method === 'POST');
    assert.equal(generations.length, 2, 'upstream failure must not trigger another paid request');
    assert.equal(await page.evaluate(() => JSON.stringify(SillyTavern.getContext().chatCompletionSettings)), chatBefore);
    assert.deepEqual(errors, []);
    await root.locator('.ng-v055-mobile-nav [data-tab="generate"]').click();
    const restored = root.locator('[data-focus="connection"]');
    if (!await restored.evaluate(n => n.open)) await restored.locator('summary').click();
    await root.locator('#ng-studio-api-key').fill('');
    await root.locator('#ng-close').click();
    assert.equal(await page.evaluate(() => SillyTavern.getContext().extensionSettings.novelGeneration.apiKey), '');
    assert.equal(await page.evaluate(() => SillyTavern.getContext().extensionSettings.novelGeneration.proxyApiKey), '');
    const report = { browser: engine.name(), genericProxy: 'disabled', browserCors: 'blocked', expectedCorsDiagnostics: corsErrors.length, backend: 'real SillyTavern status/generate', naiModels: 2, migration: 'passed', exactProviderPayload: 'passed', generationAttempts: 2, uncertainFailureRetries: 0, browserErrors: errors };
    fs.writeFileSync(path.join(artifactDir, 'hosted-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => upstream.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
