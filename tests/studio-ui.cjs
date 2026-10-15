const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Run against an isolated SillyTavern installation: this changes test settings.
// Every provider request is intercepted, so no live API key or generation is used.
const studioUrl = process.env.ST_URL || 'http://127.0.0.1:8000';
const artifactDir = process.env.ARTIFACT_DIR || path.join(os.tmpdir(), 'novel-generation-ui');
fs.mkdirSync(artifactDir, { recursive: true });

(async () => {
  const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
  const browser = await engine.launch({ ...(engine === chromium && process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true, args: engine === chromium && process.getuid?.() === 0 ? ['--no-sandbox'] : [] });
  const report = [];
  try {
    for (const mobile of [false, true]) {
      const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile });
      const errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      let fixture;
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
      await page.route('https://new.xfxai.top/**', async route => {
        const request = route.request();
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
        if (request.url().endsWith('/v1/models')) return route.fulfill({ status: 200, headers: cors, json: { data: ['gpt-4o', 'nai-diffusion-5-full', 'nai-diffusion-5-curated', '[备用]nai-diffusion-4-5-full', 'gpt-image-2', 'claude-sonnet'].map(id => ({ id })) } });
        if (request.url().endsWith('/v1/chat/completions')) {
          requests.push(JSON.parse(request.postData()));
          return route.fulfill({ status: 200, headers: cors, json: { choices: [{ message: { content: `data:image/png;base64,${fixture}` } }] } });
        }
        return route.fulfill({ status: 422, headers: cors, json: { error: 'input is required (UI test fixture)' } });
      });
      await page.goto(studioUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#ng-v051-open-studio', { state: 'attached' });
      await page.waitForTimeout(1200);
      if (await page.getByText('Welcome to SillyTavern!', { exact: true }).isVisible()) await page.locator('dialog[open]').getByText('Save', { exact: true }).click();
      fixture = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 832; canvas.height = 1216;
        const ctx = canvas.getContext('2d'); const gradient = ctx.createLinearGradient(0, 0, 832, 1216);
        gradient.addColorStop(0, '#242337'); gradient.addColorStop(1, '#744255'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 832, 1216);
        ctx.fillStyle = '#eee'; ctx.font = '32px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('UI response fixture', 416, 580); ctx.font = '20px sans-serif'; ctx.fillText('This is not a generated image', 416, 625);
        return canvas.toDataURL('image/png').split(',')[1];
      });
      await page.evaluate(() => document.getElementById('ng-v051-open-studio').click());
      const root = page.locator('#ng-studio-overlay');
      await root.waitFor({ state: 'visible' });
      await page.waitForTimeout(300);
      const opening = await root.evaluate(n => {
        const controls = n.querySelector('.ng-studio-controls');
        return { scrollTop: controls.scrollTop, modelTop: n.querySelector('.ng-studio-model-card').getBoundingClientRect().top, controlsTop: controls.getBoundingClientRect().top };
      });
      assert.equal(opening.scrollTop, 0, 'opening must keep model/API controls visible');
      assert.ok(opening.modelTop >= opening.controlsTop, JSON.stringify(opening));
      const connection = root.locator('[data-focus="connection"]');
      if (!await connection.evaluate(n => n.open)) await connection.locator('summary').click();
      await root.locator('#ng-studio-base').fill('https://new.xfxai.top/v1');
      assert.equal(await root.locator('#ng-studio-base').inputValue(), 'https://new.xfxai.top/v1');
      await root.locator('#ng-studio-api-key').fill('ui-test-key');
      await root.locator('#ng-studio-connect').click();
      await page.waitForFunction(() => !document.getElementById('ng-studio-model').disabled);
      assert.deepEqual(await root.locator('#ng-studio-model option').evaluateAll(options => options.map(n => n.value)), ['nai-diffusion-5-full', 'nai-diffusion-5-curated', '[备用]nai-diffusion-4-5-full']);
      await root.locator('#ng-studio-model').selectOption('nai-diffusion-5-full');
      const quick = root.locator('.ng-quick-seed');
      await root.locator('#ng-studio-model').selectOption('[备用]nai-diffusion-4-5-full');
      assert.equal(await quick.locator('.ng-quick-seed-modes').isVisible(), false);
      await root.locator('#ng-studio-model').selectOption('nai-diffusion-5-full');
      assert.equal(await quick.locator('.ng-quick-seed-modes').isVisible(), true);
      await quick.getByRole('button', { name: 'Fixed seed', exact: true }).click();
      assert.equal(await quick.getByRole('button', { name: 'Fixed seed', exact: true }).getAttribute('aria-pressed'), 'true');
      const fixedBeforeAuto = await root.locator('#ng-studio-seed').inputValue();
      await quick.getByRole('button', { name: 'Auto seed for NAI 5', exact: true }).focus();
      await page.keyboard.press('Space');
      assert.equal(await root.locator('#ng-studio-seed').inputValue(), '-1');
      assert.equal(await quick.getByRole('button', { name: 'Auto seed for NAI 5', exact: true }).getAttribute('aria-pressed'), 'true');
      await root.locator('#ng-close').click();
      await page.evaluate(() => document.getElementById('ng-v051-open-studio').click());
      await root.waitFor();
      assert.equal(await root.locator('#ng-studio-seed').inputValue(), '-1');
      await quick.getByRole('button', { name: 'Fixed seed', exact: true }).click();
      assert.equal(await root.locator('#ng-studio-seed').inputValue(), fixedBeforeAuto);
      await quick.getByRole('button', { name: 'Roll a new seed and use Fixed mode', exact: true }).click();
      assert.notEqual(await root.locator('#ng-studio-seed').inputValue(), fixedBeforeAuto);
      assert.match(await quick.locator('#ng-seed-mode-status').innerText(), /Fixed seed:/);

      if (await connection.evaluate(n => n.open)) await connection.locator('summary').click();
      const prompt = root.locator('[data-focus="prompt"]');
      if (!await prompt.evaluate(n => n.open)) await prompt.locator('summary').click();
      await root.locator('#ng-prompt').fill('portrait of an adult traveler, brown eyes, round pupils, soft natural lighting');
      await root.locator('#ng-negative').fill('spiral eyes, @_@, mismatched pupils');
      await root.locator('#ng-prompt').blur();
      const editor = await root.locator('#ng-prompt').evaluate(n => {
        const s = getComputedStyle(n);
        return { mirror: !!n.closest('.ng-weight-editor'), background: s.backgroundColor, text: s.webkitTextFillColor, border: s.borderTopWidth, height: n.getBoundingClientRect().height };
      });
      assert.equal(editor.mirror, false, 'use native selection/scrolling instead of transparent mirrored text');
      assert.notEqual(editor.background, 'rgba(0, 0, 0, 0)');
      assert.notEqual(editor.text, 'rgba(0, 0, 0, 0)');
      assert.equal(editor.border, '1px');
      assert.ok(editor.height >= 140 && editor.height < 240, JSON.stringify(editor));
      if (mobile) {
        await root.locator('.ng-studio-controls').evaluate(n => n.scrollTop = 200);
        const position = await root.locator('.ng-studio-controls').evaluate(n => n.scrollTop);
        await root.locator('.ng-v055-mobile-nav [data-mobile-pane="preview"]').click();
        await root.locator('.ng-v055-mobile-nav [data-tab="generate"]').click();
        assert.equal(await prompt.evaluate(n => n.open), true);
        assert.equal(await root.locator('.ng-studio-controls').evaluate(n => n.scrollTop), position);
      }
      await root.locator('#ng-studio-uc').selectOption('human');
      const style = root.locator('[data-focus="style"]');
      if (!await style.evaluate(n => n.open)) await style.locator('summary').click();
      await root.locator('[data-ng-style="anime"]').click();
      const canvas = root.locator('[data-focus="canvas"]');
      if (!await canvas.evaluate(n => n.open)) await canvas.locator('summary').click();
      await root.getByRole('button', { name: 'New random seed', exact: true }).click();
      const seed = Number(await root.locator('#ng-studio-seed').inputValue());
      assert.ok(seed > 0 && seed <= 0xffffffff);
      await root.getByRole('button', { name: 'New random seed', exact: true }).click();
      assert.notEqual(Number(await root.locator('#ng-studio-seed').inputValue()), seed);
      await root.locator('#ng-studio-seed').fill('123456');
      await root.locator('.ng-studio-controls').evaluate(n => n.scrollTop = document.querySelector('[data-focus="canvas"]').offsetTop - n.offsetTop - 10);
      await page.screenshot({ path: path.join(artifactDir, `studio-${mobile ? 'mobile' : 'pc'}-seed.png`) });
      await root.getByRole('button', { name: 'Use a fresh seed for every generation', exact: true }).click();
      assert.equal(await root.locator('#ng-studio-seed').inputValue(), '-1');
      await root.locator('#ng-generate').click();
      await root.locator('#ng-preview img').first().waitFor();
      await page.waitForFunction(() => !document.getElementById('ng-generate').disabled);
      assert.equal(requests.length, 1);
      const message = requests[0].messages[0].content;
      assert.ok(message.includes('spiral eyes'));
      assert.ok(message.includes('anime style'));
      assert.ok(message.includes('Parameter{'));
      const usedSeed = Number(message.match(/seed:(\d+)/)[1]);
      assert.ok(usedSeed > 0);
      assert.ok((await root.locator('#ng-last-seed').innerText()).includes(String(usedSeed)));
      if (mobile) assert.equal(await root.getAttribute('data-ng-mobile-pane'), 'preview');
      await quick.getByRole('button', { name: 'Fixed seed', exact: true }).click();
      assert.equal(Number(await root.locator('#ng-studio-seed').inputValue()), usedSeed);
      await root.locator('#ng-reuse-seed').click();
      if (mobile) await root.locator('.ng-v055-mobile-nav [data-tab="generate"]').click();
      assert.equal(Number(await root.locator('#ng-studio-seed').inputValue()), usedSeed);
      await root.locator(mobile ? '.ng-v055-mobile-nav [data-tab="gallery"]' : '.ng-studio-tabs [data-tab="gallery"]').click();
      await root.locator('#ng-gallery-grid img').first().waitFor();
      const dimension = await root.evaluate(n => ({ width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height, scroll: n.scrollWidth, viewport: innerWidth, footer: n.querySelector('.ng-studio-footer').getBoundingClientRect().bottom, viewportHeight: innerHeight }));
      assert.ok(dimension.width > 0 && dimension.height > 0);
      assert.ok(dimension.scroll <= dimension.viewport + 1);
      assert.ok(dimension.footer <= dimension.viewportHeight + 1);
      const widths = mobile ? [[320, 640], [844, 390], [390, 844]] : [[1024, 768], [1440, 1000]];
      for (const [width, height] of widths) {
        await page.setViewportSize({ width, height });
        const layout = await root.evaluate(n => ({
          scroll: n.scrollWidth, bottom: n.querySelector('.ng-studio-footer').getBoundingClientRect().bottom,
          targets: [...n.querySelectorAll('.ng-quick-seed button')].map(b => {
            const rect = b.getBoundingClientRect(); const style = getComputedStyle(b);
            return { width: rect.width, height: rect.height, left: rect.left, right: rect.right, radius: style.borderTopLeftRadius };
          }),
        }));
        assert.ok(layout.scroll <= width + 1, JSON.stringify(layout));
        assert.ok(layout.bottom <= height + 1, JSON.stringify(layout));
        for (const target of layout.targets) {
          assert.ok(target.width >= 44 && target.height >= 44, JSON.stringify(target));
          assert.ok(target.left >= 0 && target.right <= width, JSON.stringify(target));
          assert.equal(target.radius, '0px');
        }
        const top = await root.evaluate(n => {
          const mobileNav = n.querySelector('.ng-v055-mobile-nav');
          const nav = getComputedStyle(mobileNav).display !== 'none' ? mobileNav : n.querySelector('.ng-studio-tabs');
          return {
            tabs: [...nav.querySelectorAll('button')].map(b => {
              const r = b.getBoundingClientRect(); return { width: r.width, height: r.height };
            }),
            titleRight: n.querySelector('.ng-studio-title').getBoundingClientRect().right,
            actionsLeft: n.querySelector('.ng-studio-header-actions').getBoundingClientRect().left,
          };
        });
        const tabWidths = top.tabs.map(tab => tab.width);
        assert.ok(Math.max(...tabWidths) - Math.min(...tabWidths) <= 1, JSON.stringify(top));
        assert.ok(top.tabs.every(tab => tab.height >= 44), JSON.stringify(top));
        assert.ok(top.titleRight + 8 <= top.actionsLeft, JSON.stringify(top));
      }
      await root.locator('#ng-close').click();
      await page.evaluate(() => document.getElementById('ng-v051-open-studio').click());
      await root.waitFor();
      await page.waitForTimeout(100);
      assert.equal(await root.locator('.ng-studio-controls').evaluate(n => n.scrollTop), 0);
      assert.equal(await root.locator('#ng-prompt').inputValue(), 'portrait of an adult traveler, brown eyes, round pupils, soft natural lighting');
      assert.equal(Number(await root.locator('#ng-studio-seed').inputValue()), usedSeed);
      assert.equal(await root.locator('[data-ng-style="anime"]').getAttribute('aria-pressed'), 'true');
      const openConnection = root.locator('[data-focus="connection"]');
      if (!await openConnection.evaluate(n => n.open)) await openConnection.locator('summary').click();
      await root.locator('#ng-studio-api-key').fill('');
      await root.locator('#ng-close').click();
      assert.equal(await page.evaluate(() => SillyTavern.getContext().extensionSettings.novelGeneration.apiKey), '');
      assert.equal(await page.evaluate(() => SillyTavern.getContext().extensionSettings.novelGeneration.proxyApiKey), '');
      assert.deepEqual(errors, []);
      report.push({ device: mobile ? 'mobile 390×844' : 'PC 1440×1000', models: 3, generationRequests: requests.length, seedControls: 'passed', quickAutoFixed: 'passed (keyboard, model scope and Auto/Fixed persistence)', squareTouchControls: 'passed at desktop, tablet, 320px mobile and landscape', reuseSeed: 'passed', persistence: 'passed', layout: dimension, browserErrors: errors });
      await page.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(artifactDir, 'e2e-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
