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
  let fixture, failGeneration = false, releaseGeneration;
  const upstream = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method, path: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && req.url === '/v1/models') return res.end(JSON.stringify({ data: ['gpt-4o', 'nai-diffusion-5-full', 'nai-diffusion-4-5-full'].map(id => ({ id })) }));
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let mode = Array.isArray(failGeneration) ? (failGeneration.shift() || false) : failGeneration;
      if (mode === 'hold') { await new Promise(resolve => { releaseGeneration = resolve; }); mode = false; }
      if (mode === 'rate') {
        res.writeHead(429, { 'Retry-After': '60' });
        return res.end(JSON.stringify({ error: { message: 'Too Many Requests', type: 'rate_limit_error', retry_after: 60 } }));
      }
      if (mode === 'pool') {
        res.writeHead(429);
        return res.end(JSON.stringify({ error: { message: '当前没有可用的 Token（可能全部已禁用、过期或正在冷却）', type: 'rate_limit_error' } }));
      }
      if (mode === 'auth' || mode === 'quota') {
        res.writeHead(mode === 'auth' ? 401 : 429);
        return res.end(JSON.stringify({ error: { message: mode === 'auth' ? 'Invalid key' : 'No credit', type: mode === 'auth' ? 'invalid_api_key' : 'insufficient_quota' } }));
      }
      res.writeHead(mode === true ? 500 : 200);
      return res.end(JSON.stringify(mode === true ? { error: { message: 'Fixture failure' } } : mode === 'empty' ? { choices: [] } : { choices: [{ message: { content: `data:image/png;base64,${fixture}` } }] }));
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
    assert.equal(generations[0].body.size, '832x1216');
    assert.equal(generations[0].body.width, 832);
    assert.equal(generations[0].body.height, 1216);
    assert.equal(generations[0].body.aspect_ratio, '2:3');
    assert.equal(generations[0].headers.authorization, 'Bearer fixture-image-key');
    assert.equal(generations[0].headers['x-csrf-token'], undefined, 'ST CSRF token must stay on same-origin request');
    failGeneration = true;
    await root.locator('#ng-generate').click();
    await page.waitForFunction(() => !document.getElementById('ng-generate').disabled);
    generations = requests.filter(r => r.method === 'POST');
    assert.equal(generations.length, 2, 'upstream failure must not trigger another paid request');
    await page.clock.install({ time: new Date() });
    const count = () => requests.filter(r => r.method === 'POST').length;
    const waitIdle = () => page.waitForFunction(() => document.getElementById('ng-generate').getAttribute('aria-busy') !== 'true');
    const waitRetry = attempt => page.waitForFunction(n => document.getElementById('ng-gen-status').textContent.includes(`attempt ${n} failed; retrying`), attempt);
    const checkButtons = async target => {
      const layout = await target.evaluate(() => {
        const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
        return { constant: rect('ng-constant-generate'), manual: rect('ng-generate'), height: innerHeight, width: innerWidth, headerTop: document.querySelector('.ng-studio-header').getBoundingClientRect().top };
      });
      for (const r of [layout.constant, layout.manual]) {
        assert.ok(r.width >= 120 && r.left >= 0 && r.right <= layout.width + 1 && r.bottom <= layout.height + 1, JSON.stringify(layout));
      }
      assert.ok(layout.constant.right <= layout.manual.left + 1 && layout.headerTop >= 0, JSON.stringify(layout));
    };
    failGeneration = 'rate';
    await root.locator('#ng-generate').click(); await waitIdle();
    assert.equal(await root.locator('#ng-generate').isDisabled(), false, 'no client cooldown, even with an explicit 60-second retry hint');
    assert.match(await root.locator('#ng-gen-status').innerText(), /rate limit/);
    assert.equal(count(), 3);
    await root.locator('#ng-generate').click(); await waitIdle();
    assert.equal(count(), 4, 'immediate manual retry must reach the provider');
    failGeneration = false;
    await root.locator('#ng-generate').click(); await waitIdle();
    assert.equal(count(), 5);

    failGeneration = ['rate', 'auth', 'quota', true, 'empty', false];
    // Isolate retry cycles from the generic adapter's validation-schema fallback.
    await page.evaluate(() => {
      const s = SillyTavern.getContext().extensionSettings.novelGeneration;
      s.compatibility = 'strict'; s.routeMode = 'chat';
    });
    await root.locator('#ng-studio-n').evaluate(n => { n.value = '3'; n.dispatchEvent(new Event('input', { bubbles: true })); });
    await root.locator('#ng-constant-generate').click();
    for (let attempt = 1; attempt <= 5; attempt++) {
      await waitRetry(attempt);
      assert.equal(await root.locator('#ng-generate').isDisabled(), false);
      assert.equal(await root.locator('#ng-constant-generate').getAttribute('aria-pressed'), 'true');
      await page.clock.fastForward(2000);
    }
    await page.waitForFunction(() => document.getElementById('ng-gen-status').textContent.includes('completed after 6 attempts'));
    assert.equal(count(), 11, 'one-image attempts retry all five error categories, then stop at one success');
    assert.equal(await root.locator('#ng-constant-generate').getAttribute('aria-pressed'), 'false');
    await page.clock.fastForward(10000);
    assert.equal(count(), 11, 'success cannot generate another image');

    failGeneration = 'pool';
    await root.locator('#ng-constant-generate').click(); await waitRetry(1);
    assert.match(await root.locator('#ng-gen-status').innerText(), /upstream channel unavailable/);
    await root.locator('.ng-v055-mobile-nav [data-tab="generate"]').click();
    await checkButtons(page);
    await page.screenshot({ path: path.join(artifactDir, 'constant-mobile.png') });
    await root.locator('#ng-constant-generate').click();
    const stoppedAt = count();
    await page.clock.fastForward(10000);
    assert.equal(count(), stoppedAt, 'Stop clears queued attempts');

    await root.locator('#ng-constant-generate').click(); await waitRetry(1);
    failGeneration = false;
    await root.locator('#ng-generate').click(); await waitIdle();
    assert.equal(await root.locator('#ng-constant-generate').getAttribute('aria-pressed'), 'false', 'manual Generate cancels the loop');
    const manualAt = count();
    await page.clock.fastForward(10000);
    assert.equal(count(), manualAt);

    failGeneration = 'hold'; releaseGeneration = null;
    await root.locator('#ng-constant-generate').click();
    while (!releaseGeneration) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(await root.locator('#ng-generate').isDisabled(), true);
    await root.locator('#ng-constant-generate').click();
    const inFlightAt = count();
    releaseGeneration(); await waitIdle();
    await page.clock.fastForward(10000);
    assert.equal(count(), inFlightAt, 'stopping in-flight permits completion without a new request');

    failGeneration = 'pool';
    await root.locator('#ng-constant-generate').click(); await waitRetry(1);
    await root.locator('#ng-close').click();
    const closedAt = count();
    await page.clock.fastForward(10000);
    assert.equal(count(), closedAt, 'closing Studio stops retries');
    await page.evaluate(() => document.getElementById('ng-v051-open-studio').click());
    assert.equal(await root.locator('#ng-constant-generate').getAttribute('aria-pressed'), 'false');

    const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false });
    await desktop.goto(studioUrl, { waitUntil: 'domcontentloaded' });
    await desktop.waitForSelector('#ng-v051-open-studio', { state: 'attached' }); await desktop.waitForTimeout(1200);
    await desktop.evaluate(() => document.getElementById('ng-v051-open-studio').click());
    const pc = desktop.locator('#ng-studio-overlay');
    const pcConnection = pc.locator('[data-focus="connection"]');
    if (!await pcConnection.evaluate(n => n.open)) await pcConnection.locator('summary').click();
    await pc.locator('#ng-studio-base').fill(provider); await pc.locator('#ng-studio-api-key').fill('fixture-image-key');
    await pc.locator('#ng-studio-connect').click(); await desktop.waitForFunction(() => !document.getElementById('ng-studio-connect').disabled);
    await pcConnection.locator('summary').click();
    await pc.locator('#ng-prompt').fill('portrait of an adult traveler, brown eyes, soft natural lighting');
    await pc.locator('#ng-constant-generate').click();
    await desktop.waitForFunction(() => document.getElementById('ng-gen-status').textContent.includes('retrying in 2s'));
    assert.equal(await pc.locator('#ng-constant-generate').isDisabled(), false);
    await checkButtons(desktop);
    await desktop.screenshot({ path: path.join(artifactDir, 'constant-pc.png') });
    await pc.locator('#ng-constant-generate').click(); await desktop.close();
    assert.equal(await page.evaluate(() => JSON.stringify(SillyTavern.getContext().chatCompletionSettings)), chatBefore);
    assert.deepEqual(errors, []);
    await root.locator('.ng-v055-mobile-nav [data-tab="generate"]').click();
    const restored = root.locator('[data-focus="connection"]');
    if (!await restored.evaluate(n => n.open)) await restored.locator('summary').click();
    await root.locator('#ng-studio-api-key').fill('');
    await root.locator('#ng-close').click();
    assert.equal(await page.evaluate(() => SillyTavern.getContext().extensionSettings.novelGeneration.apiKey), '');
    assert.equal(await page.evaluate(() => SillyTavern.getContext().extensionSettings.novelGeneration.proxyApiKey), '');
    const report = { browser: engine.name(), genericProxy: 'disabled', browserCors: 'blocked', backend: 'real SillyTavern status/generate', exactProviderPayload: 'passed', generationAttempts: count(), manualCooldown: 'removed', constantRetryAllErrors: 'passed', constantStopsOnSuccess: 'passed', stopQueuedAndInFlight: 'passed', manualOverride: 'passed', closeStopsRetries: 'passed', browserErrors: errors };
    fs.writeFileSync(path.join(artifactDir, 'hosted-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => upstream.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
