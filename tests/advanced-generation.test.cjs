const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function runtime(fetchImpl) {
  let clock = Date.now();
  const context = { extensionSettings: {}, saveSettingsDebounced() {}, getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf' }) };
  const sandbox = {
    console, URL, Headers, Response, AbortController, DOMException, TextDecoder, Blob,
    Date: class extends Date { static now() { return clock; } },
    __advanceClock(ms) { clock += ms; },
    performance, structuredClone, atob, btoa,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    fetch: fetchImpl,
    document: {
      readyState: 'loading',
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {},
      createElement: () => ({ textContent: '', innerHTML: '' }),
    },
    SillyTavern: { getContext: () => context },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  // Load every production override, then expose hooks only in this test VM.
  const end = source.lastIndexOf('})();');
  const hooks = `globalThis.testApi = {
    settings, ngProbeAdvancedEndpoint, ngProbeAdvancedCapabilities,
    ngCapabilitiesCurrent, ngAdvancedCapabilityLabel, ngGenerationSeed,
    generateState, postGeneration, ngBuildNativeEnvelope, requestCandidates,
    modelIds, ngModelLabel, ngIsNaiImageModel, ngIsNai5Model, ngNewSeed, ngComposeVisualStyle,
    ngProviderFetch, ngFetchModels, ngPngGenerationMetadata, ngCooldownSeconds, ngRetryDelaySeconds,
    advanceClock: globalThis.__advanceClock,
    caps: ngProviderCaps, logs: debugLog,
    setKey(value) { apiKey = value; settings().proxyApiKey = value; },
    prepareWith(fn) { ngPrepareAdvancedImages = fn; },
  };`;
  vm.runInContext(source.slice(0, end) + hooks + source.slice(end), sandbox);
  const api = sandbox.testApi;
  Object.assign(api.settings(), {
    provider: 'proxy', baseUrl: 'https://new.xfxai.top/v1',
    proxyBaseUrl: 'https://new.xfxai.top/v1', model: 'nai-diffusion-5-full',
  });
  api.setKey('test-key');
  return api;
}

const state = (extra = {}) => ({
  prompt: 'a cat', negative: '', preset: 'portrait', width: 832, height: 1216,
  steps: 28, guidance: 5, seed: -1, n: 1, sampler: 'k_euler_ancestral',
  scheduler: 'native', vibes: [], precise: [], characters: [],
  editMode: 'img2img', source: null, mask: null, strength: 0.4, noise: 0.1,
  ...extra,
});

test('HTML fallback pages do not count as native API support', async () => {
  const api = runtime(async () => new Response('<!doctype html><html>app</html>', {
    status: 200, headers: { 'content-type': 'text/html' },
  }));
  const result = await api.ngProbeAdvancedEndpoint('/ai/generate-image');
  assert.equal(result.state, 'missing');
  assert.equal(result.url, '');
  assert.ok(result.attempts.length > 1);
});

test('405 and generic JSON success do not count as POST API support', async () => {
  for (const status of [200, 405]) {
    const api = runtime(async () => Response.json({ success: true, message: 'Welcome' }, { status }));
    assert.equal((await api.ngProbeAdvancedEndpoint('/ai/generate-image')).state, 'missing');
  }
});

test('probe skips HTML and detects a JSON validation error on an alternate route', async () => {
  const api = runtime(async url => url.endsWith('/v1/ai/generate-image')
    ? Response.json({ error: 'input is required' }, { status: 422 })
    : new Response('<html>app</html>', { headers: { 'content-type': 'text/html' } }));
  const result = await api.ngProbeAdvancedEndpoint('/ai/generate-image');
  assert.equal(result.state, 'supported');
  assert.equal(result.url, 'https://new.xfxai.top/v1/ai/generate-image');
  assert.match(api.ngAdvancedCapabilityLabel(result.state, false), /unverified/);
});

test('blocked and unhealthy APIs remain distinguishable from missing routes', async () => {
  for (const [status, expected] of [[401, 'blocked'], [503, 'unknown'], [429, 'unknown']]) {
    const api = runtime(async () => Response.json({ error: 'unavailable' }, { status }));
    assert.equal((await api.ngProbeAdvancedEndpoint('/ai/generate-image')).state, expected);
  }
});

test('capabilities are scoped to the current URL and credential', async () => {
  const api = runtime(async () => Response.json({ error: 'input required' }, { status: 400 }));
  await api.ngProbeAdvancedCapabilities();
  assert.equal(api.ngCapabilitiesCurrent(), true);
  api.setKey('replacement-key');
  assert.equal(api.ngCapabilitiesCurrent(), false);
  await api.ngProbeAdvancedCapabilities();
  api.settings().proxyBaseUrl = 'https://another.example/v1';
  assert.equal(api.ngCapabilitiesCurrent(), false);
});

test('V5 Precise Reference is rejected before a provider request', async () => {
  let calls = 0;
  const api = runtime(async () => { calls++; throw new Error('unexpected request'); });
  await assert.rejects(api.generateState(state({ precise: [{ base64: 'image' }] })), /V4\.5/);
  assert.equal(calls, 0);
});

test('Inpaint needs both a source and a nonempty mask', async () => {
  let calls = 0;
  const api = runtime(async () => { calls++; throw new Error('unexpected request'); });
  await assert.rejects(api.generateState(state({ editMode: 'inpaint' })), /source image/);
  await assert.rejects(api.generateState(state({ editMode: 'inpaint', source: { base64: 'image' } })), /mask/);
  assert.equal(calls, 0);
});

test('native Inpaint sends the model, strength and valid random seed together', async () => {
  const requests = [];
  const api = runtime(async (url, options) => {
    const body = JSON.parse(options.body);
    if (!body.input) return Response.json({ error: 'input required' }, { status: 400 });
    requests.push({ url, body });
    return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] });
  });
  api.prepareWith(async value => value);
  const input = state({ editMode: 'inpaint', source: { base64: 'source' }, mask: { base64: 'mask' } });
  await api.generateState(input);
  const body = requests[0].body;
  assert.equal(body.action, 'infill');
  assert.equal(body.model, 'nai-diffusion-5-full-inpainting');
  assert.equal(body.parameters.image, 'source');
  assert.equal(body.parameters.mask, 'mask');
  assert.equal(body.parameters.inpaintImg2ImgStrength, 0.4);
  assert.ok(Number.isInteger(body.parameters.seed) && body.parameters.seed >= 0 && body.parameters.seed <= 0xffffffff);
  assert.equal(input.seed, -1);
  assert.equal(api.caps.nativeGenerateTested, true);
});

test('V4.5 references carry aligned Director arrays and live strength/fidelity', () => {
  const api = runtime();
  api.settings().model = 'nai-diffusion-4-5-full';
  const body = api.ngBuildNativeEnvelope(state({ seed: 42, precise: [
    { base64: 'first', type: 'character', strength: 0.7, fidelity: 1 },
    { base64: 'second', type: 'style', strength: 0.2, fidelity: 0 },
  ] }));
  assert.deepEqual(Array.from(body.parameters.director_reference_images), ['first', 'second']);
  assert.deepEqual(Array.from(body.parameters.director_reference_strength_values), [0.7, 0.2]);
  assert.deepEqual(Array.from(body.parameters.director_reference_secondary_strength_values), [0, 1]);
  assert.equal(body.parameters.director_reference_descriptions[1].caption.base_caption, 'style');
});

test('a wrapper image response does not prove that references were applied', async () => {
  const api = runtime(async () => Response.json({
    data: [{ b64_json: 'aGVsbG8=' }], usage: { input_tokens_details: { image_tokens: 0 } },
  }));
  const result = await api.postGeneration('images', { name: 'test', payload: {} },
    state({ precise: [{ base64: 'image' }] }), new AbortController().signal);
  assert.equal(result.referenceVerified, false);
  assert.equal(api.logs[0].reference_consumption, 'unverified-wrapper');
});

test('fixed zero/max seeds are preserved and random seeds are unsigned', () => {
  const api = runtime();
  assert.equal(api.ngGenerationSeed(0), 0);
  assert.equal(api.ngGenerationSeed(0xffffffff), 0xffffffff);
  for (let i = 0; i < 20; i++) {
    const seed = api.ngGenerationSeed(-1);
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
  }
});

test('XFX NAI sends negative prompt and selected controls in Parameter text', async () => {
  const requests = [];
  const api = runtime(async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return Response.json({ choices: [{ message: { content: 'data:image/png;base64,aGVsbG8=' } }] });
  });
  const input = state({ seed: 123456, negative: 'spiral eyes, @_@, hypnotic eyes', scheduler: 'karras' });
  const result = await api.generateState(input);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://new.xfxai.top/v1/chat/completions');
  const body = requests[0].body;
  assert.deepEqual(Object.keys(body).sort(), ['messages', 'model']);
  assert.equal(body.model, 'nai-diffusion-5-full');
  assert.equal(body.messages[0].content,
    'a cat Parameter{size:832:1216,negative_prompt:spiral eyes, @_@, hypnotic eyes,steps:28,scale:5,sampler:k_euler_ancestral,scheduler:karras,seed:123456,base64:true}');
  assert.equal(result.schema, 'xfx-nai-chat-parameters');
  assert.equal(input.negative, 'spiral eyes, @_@, hypnotic eyes');
});

test('XFX sends presets, additional negative text and Studio text together once', async () => {
  let message;
  const api = runtime(async (_url, options) => {
    message = JSON.parse(options.body).messages[0].content;
    return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] });
  });
  Object.assign(api.settings().image, {
    prefix: 'portrait', suffix: 'round pupils', negativePreset: 'human', defaultNegative: 'spiral eyes',
  });
  const input = state({ prompt: 'a girl', negative: 'hypnotic eyes' });
  await api.generateState(input);
  assert.match(message, /^portrait, a girl, round pupils Parameter\{/);
  assert.match(message, /negative_prompt:lowres,.*@_@, mismatched pupils, glowing eyes, bad anatomy, spiral eyes, hypnotic eyes,steps:/);
  assert.equal((message.match(/spiral eyes/g) || []).length, 1);
  assert.equal(input.prompt, 'a girl');
  assert.equal(input.negative, 'hypnotic eyes');
});

test('XFX batches are sequential and get a resolved seed for every image', async () => {
  let pending = false;
  const bodies = [];
  const api = runtime(async (_url, options) => {
    assert.equal(pending, false);
    pending = true;
    await Promise.resolve();
    bodies.push(JSON.parse(options.body));
    pending = false;
    return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] });
  });
  const input = state({ n: 3 });
  const result = await api.generateState(input);
  assert.equal(bodies.length, 3);
  assert.equal(result.images.length, 3);
  assert.equal(result.seeds.length, 3);
  for (let index = 0; index < bodies.length; index++) {
    const seed = result.seeds[index];
    assert.ok(seed >= 100000 && seed <= 999999);
    assert.ok(bodies[index].messages[0].content.includes(`seed:${seed},`));
  }
  assert.equal(input.seed, -1);
});

test('XFX fixed seeds are reused and native scheduler preserves the provider default', async () => {
  const bodies = [];
  const api = runtime(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] });
  });
  await api.generateState(state({ seed: 123456, n: 2 }));
  for (const body of bodies) {
    assert.match(body.messages[0].content, /seed:123456,/);
    assert.doesNotMatch(body.messages[0].content, /scheduler:/);
    assert.doesNotMatch(body.messages[0].content, /negative_prompt:/);
  }
});

test('XFX backup domain works but similarly named hosts keep their existing adapter', async () => {
  for (const [baseUrl, xfx] of [
    ['https://new.xfxaigc.com/v1', true],
    ['https://new.xfxai.top.other.example/v1', false],
    ['https://other.example/v1', false],
  ]) {
    const api = runtime(async () => Response.json({ data: [{ b64_json: 'aGVsbG8=' }] }));
    api.settings().proxyBaseUrl = baseUrl;
    const result = await api.generateState(state());
    assert.equal(result.schema === 'xfx-nai-chat-parameters', xfx);
  }
});

test('an XFX V5 error is surfaced without switching to V4.5 or repeating generation', async () => {
  const requests = [];
  const api = runtime(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json({ error: 'upstream failed' }, { status: 503 });
  });
  await assert.rejects(api.generateState(state()), /503/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, 'nai-diffusion-5-full');
});

test('RVL keeps its compact request and Negative prompt block', async () => {
  let body;
  const api = runtime(async (_url, options) => {
    body = JSON.parse(options.body);
    return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] });
  });
  api.settings().proxyBaseUrl = 'https://rvlconnect.com/17/v1';
  await api.generateState(state({ seed: 123456, negative: 'spiral eyes' }));
  assert.equal(body.messages[0].content, 'a cat\n\nNegative prompt: spiral eyes');
  assert.equal(body.size, '832:1216');
  assert.equal(body.seed, 123456);
  assert.equal(body.max_tokens, 16);
  assert.doesNotMatch(body.messages[0].content, /Parameter\{/);
});

test('model discovery keeps only NAI image models and preserves provider IDs', () => {
  const api = runtime();
  const ids = ['gpt-4o', 'nai-diffusion-5-full', '[备用]nai-diffusion-4-5-full',
    'gpt-image-2', 'NAI 5 Curated', 'NovelAI v4.5 Full', 'nai-diffusion-5-full',
    'claude-sonnet', 'nai-embedding', 'novelai-erato'];
  assert.deepEqual(Array.from(api.modelIds({ data: ids.map(id => ({ id })) })),
    ['nai-diffusion-5-full', '[备用]nai-diffusion-4-5-full', 'NAI 5 Curated', 'NovelAI v4.5 Full']);
  assert.deepEqual(Array.from(api.modelIds({ models: ['nai-diffusion-5-curated', 'gpt-image-2'] })), ['nai-diffusion-5-curated']);
  assert.deepEqual(Array.from(api.modelIds({ data: [{ id: 'gpt-image-2' }] })), []);
});

test('New seed produces a valid positive seed different from the previous value', () => {
  const api = runtime();
  let previous = -1;
  for (let index = 0; index < 20; index++) {
    const next = api.ngNewSeed(previous);
    assert.ok(Number.isInteger(next) && next >= 100000 && next <= 999999);
    assert.notEqual(next, previous);
    previous = next;
  }
});

test('visual presets are applied once without changing the editable prompt', async () => {
  const requests = [];
  const api = runtime(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] });
  });
  const input = state({ prompt: 'a portrait', visualStyle: 'anime' });
  await api.generateState(input);
  await api.generateState(input);
  assert.equal(input.prompt, 'a portrait');
  for (const body of requests) {
    assert.match(body.messages[0].content, /^a portrait, anime style, clean lineart, vibrant colors Parameter\{/);
    assert.equal((body.messages[0].content.match(/anime style/g) || []).length, 1);
  }
  assert.equal(api.ngComposeVisualStyle('a portrait', 'none'), 'a portrait');
});

test('the quick Auto/Fixed toggle is scoped to NAI 5 model names', () => {
  const api = runtime();
  for (const model of ['nai-diffusion-5-full', 'nai-diffusion-5-curated', 'NAI 5 Full', 'NovelAI v5 Full']) assert.equal(api.ngIsNai5Model(model), true);
  for (const model of ['nai-diffusion-4-5-full', 'nai-diffusion-4-full', 'gpt-image-2']) assert.equal(api.ngIsNai5Model(model), false);
});

test('model labels distinguish OpenAI and other tagged Full models', () => {
  const api = runtime();
  assert.equal(api.ngModelLabel('[DM]-[AG]-[OAI]-nai-diffusion-5-full-[0.2]'), '[DM] [AG] [OpenAI] NAI 5 · Full [0.2]');
  assert.equal(api.ngModelLabel('[DM]-[AG]-nai-diffusion-5-full-[0.46]'), '[DM] [AG] NAI 5 · Full [0.46]');
});

test('CORS transport is chosen on the model GET and used once for generation', async () => {
  const calls = [];
  const api = runtime(async (url, options) => {
    calls.push({ url, options });
    if (!url.startsWith('/proxy/')) throw new TypeError('Failed to fetch');
    return Response.json({ data: [] });
  });
  await api.ngFetchModels({ headers: {} });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://new.xfxai.top/v1/models');
  assert.equal(calls[1].url, '/proxy/https://new.xfxai.top/v1/models');
  await api.ngProviderFetch('https://new.xfxai.top/v1/images/generations', { method: 'POST' });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, '/proxy/https://new.xfxai.top/v1/images/generations');
  api.settings().proxyBaseUrl = 'https://other.example/v1';
  await assert.rejects(api.ngProviderFetch('https://other.example/v1/images/generations', { method: 'POST' }), /Failed to fetch/);
  assert.equal(calls.at(-1).url, 'https://other.example/v1/images/generations');
});

test('disabled CORS proxy uses the normal ST backend with per-request credentials and exact image parameters', async () => {
  const calls = [];
  const api = runtime(async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith('https:')) throw new TypeError('Failed to fetch');
    if (url.startsWith('/proxy/')) return new Response('CORS proxy is disabled. Enable it in config.yaml', { status: 404 });
    return Response.json(url.endsWith('/status') ? { data: [{ id: 'nai-diffusion-5-full' }] } : { choices: [{ message: { content: 'image' } }] });
  });
  await api.ngFetchModels({ headers: { Authorization: 'Bearer image-only-key' } });
  assert.equal(calls.length, 3);
  const discovery = JSON.parse(calls[2].options.body);
  assert.equal(discovery.reverse_proxy, 'https://new.xfxai.top/v1');
  assert.equal(discovery.proxy_password, 'image-only-key');
  assert.equal(calls[2].options.headers['X-CSRF-Token'], 'test-csrf');
  assert.equal(api.settings().corsProxyBaseUrl, undefined);
  assert.equal(api.settings().serverBridgeBaseUrl, 'https://new.xfxai.top/v1');
  const payload = { model: 'nai-diffusion-5-full', messages: [{ role: 'user', content: 'portrait Parameter{seed:123456}' }], stream: false, parameters: { seed: 123456, steps: 28, negative_prompt: 'blurry' } };
  await api.ngProviderFetch('https://new.xfxai.top/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer image-only-key' }, body: JSON.stringify(payload) });
  assert.equal(calls.length, 4);
  assert.equal(calls[3].url, '/api/backends/chat-completions/generate');
  const forwarded = JSON.parse(calls[3].options.body);
  assert.deepEqual(JSON.parse(forwarded.custom_include_body), payload);
  assert.deepEqual(JSON.parse(forwarded.custom_include_headers), { Authorization: 'Bearer image-only-key' });
  assert.equal(calls[3].options.headers.Authorization, undefined);
  const blocked = await api.ngProviderFetch('https://new.xfxai.top/ai/generate-image', { method: 'POST', body: '{}' });
  assert.equal(blocked.status, 404);
  assert.equal(calls.length, 4, 'native probe must not cause a chat generation');
  api.settings().proxyBaseUrl = 'https://other.example/v1';
  await assert.rejects(api.ngProviderFetch('https://other.example/v1/chat/completions', { method: 'POST' }), /Failed to fetch/);
});

test('a saved proxy selection migrates when the hosted server disables CORS proxy', async () => {
  const calls = [];
  const api = runtime(async url => {
    calls.push(url);
    return url.startsWith('/proxy/') ? new Response('CORS proxy is disabled', { status: 404 }) : Response.json({ data: [{ id: 'nai-diffusion-5-full' }] });
  });
  api.settings().corsProxyBaseUrl = 'https://new.xfxai.top/v1';
  assert.equal((await api.ngFetchModels()).ok, true);
  assert.deepEqual(calls, ['/proxy/https://new.xfxai.top/v1/models', '/api/backends/chat-completions/status']);
  assert.equal(api.settings().corsProxyBaseUrl, undefined);
});

test('ST HTTP 200 upstream errors become failures without retrying generation', async () => {
  let calls = 0;
  const api = runtime(async () => { calls++; return Response.json({ error: { message: 'Bad Gateway' } }); });
  api.settings().serverBridgeBaseUrl = 'https://new.xfxai.top/v1';
  assert.equal((await api.ngFetchModels()).status, 502);
  const response = await api.ngProviderFetch('https://new.xfxai.top/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'nai-diffusion-5-full', messages: [] }) });
  assert.equal(response.status, 502);
  assert.match(await response.text(), /Bad Gateway/);
  assert.equal(calls, 2);
});

test('OpenAI NAI wrappers receive seed and controls at both supported levels', async () => {
  const requests = [];
  const api = runtime(async (url, options) => {
    if (!url.endsWith('/images/generations')) return new Response('missing', { status: 404 });
    requests.push(JSON.parse(options.body));
    return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] });
  });
  api.settings().proxyBaseUrl = 'https://shop.rvlconnect.com/v1';
  api.settings().model = '[DM]-[AG]-[OAI]-nai-diffusion-5-full-[0.2]';
  await api.generateState(state({ seed: 123456, negative: 'lowres' }));
  assert.equal(requests.length, 1);
  const body = requests[0];
  assert.equal(body.seed, 123456);
  assert.equal(body.parameters.seed, 123456);
  assert.equal(body.steps, 28);
  assert.equal(body.parameters.steps, 28);
  assert.equal(body.negative_prompt, 'lowres');
  assert.equal(body.parameters.negative_prompt, 'lowres');
});

test('OpenAI NAI chat wrappers receive portrait, square and landscape dimensions at the top level', async () => {
  for (const model of ['[DM]-[AG]-[OAI]-nai-diffusion-5-full-[0.2]', '[DM]-[AG]-[OAI]-nai-diffusion-4-5-full-[0.1]']) {
    for (const [preset, width, height, aspect] of [['portrait', 832, 1216, '2:3'], ['square', 1024, 1024, '1:1'], ['landscape', 1216, 832, '3:2']]) {
      const requests = [];
      const api = runtime(async (url, options) => {
        if (!url.endsWith('/chat/completions')) return new Response('missing', { status: 404 });
        requests.push(JSON.parse(options.body));
        return Response.json({ choices: [{ message: { content: 'https://example.test/image.png' } }] });
      });
      api.settings().proxyBaseUrl = 'https://shop.rvlconnect.com/v1';
      api.settings().model = model;
      // Deliberately stale manual dimensions must not override a fixed preset.
      await api.generateState(state({ preset, width: 512, height: 512, seed: 123456 }));
      assert.equal(requests.length, 1);
      const body = requests[0];
      assert.equal(body.size, `${width}x${height}`);
      assert.equal(body.width, width); assert.equal(body.height, height);
      assert.equal(body.aspect_ratio, aspect);
      for (const config of [body.image_config, body.image_generation, body.image_generation.image_config]) {
        assert.equal(config.size, body.size);
        assert.equal(config.width, width); assert.equal(config.height, height);
        assert.equal(config.aspect_ratio, aspect);
      }
      assert.equal(body.image_generation.parameters.width, width);
      assert.equal(body.image_generation.parameters.height, height);
    }
  }
});

test('uncertain generation outcomes are surfaced without another paid attempt', async () => {
  for (const outcome of ['network', 200, 500]) {
    let requests = 0;
    const api = runtime(async (url) => {
      if (!url.endsWith('/images/generations')) return new Response('missing', { status: 404 });
      requests++;
      if (outcome === 'network') throw new TypeError('Failed to fetch');
      return Response.json({ error: 'upstream failed' }, { status: outcome });
    });
    api.settings().proxyBaseUrl = 'https://shop.rvlconnect.com/v1';
    await assert.rejects(api.generateState(state()));
    assert.equal(requests, 1);
  }
});

test('PNG generation metadata preserves an actual zero seed and rejects broken chunks', () => {
  const api = runtime();
  const comment = Buffer.from('Comment\0' + JSON.stringify({ seed: 0, steps: 23 }));
  const chunk = Buffer.alloc(comment.length + 12);
  chunk.writeUInt32BE(comment.length);
  chunk.write('tEXt', 4);
  comment.copy(chunk, 8);
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk]);
  assert.deepEqual(JSON.parse(JSON.stringify(api.ngPngGenerationMetadata('data:image/png;base64,' + png.toString('base64')))), { seed: 0, steps: 23 });
  assert.equal(api.ngPngGenerationMetadata('https://example.com/image.png'), null);
  assert.equal(api.ngPngGenerationMetadata('data:image/png;base64,' + png.subarray(0, 20).toString('base64')), null);
});

test('Retry-After supports seconds and HTTP dates with a conservative missing-header default', () => {
  const api = runtime();
  const now = Date.parse('2026-10-16T00:00:00Z');
  assert.equal(api.ngRetryDelaySeconds('15', now), 15);
  assert.equal(api.ngRetryDelaySeconds('0', now), 1);
  assert.equal(api.ngRetryDelaySeconds('-1', now), 60);
  assert.equal(api.ngRetryDelaySeconds('Fri, 16 Oct 2026 00:00:30 GMT', now), 30);
  assert.equal(api.ngRetryDelaySeconds(null, now), 60);
  assert.equal(api.ngRetryDelaySeconds('invalid', now), 60);
});

test('429 stops the batch, blocks repeated generation and permits a manual retry after Retry-After', async () => {
  let calls = 0;
  const api = runtime(async () => ++calls === 1
    ? Response.json({ error: { message: 'Too Many Requests' } }, { status: 429, headers: { 'Retry-After': '2' } })
    : Response.json({ data: [{ url: 'https://example.test/image.png' }] }));
  await assert.rejects(api.generateState(state({ n: 3 })), error => error.status === 429);
  assert.equal(calls, 1);
  assert.equal(api.ngCooldownSeconds(), 2);
  await assert.rejects(api.generateState(state()), /wait 2 seconds/);
  assert.equal(calls, 1, 'cooldown must stop another upstream request');
  api.advanceClock(2100);
  assert.equal(api.ngCooldownSeconds(), 0);
  const result = await api.generateState(state());
  assert.equal(result.images.length, 1);
  assert.equal(calls, 2, 'expiry permits a user retry without an automatic retry');
});

test('ST-wrapped Too Many Requests keeps status 429 and starts a cooldown without changing models', async () => {
  const bodies = [];
  const api = runtime(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return Response.json({ error: { message: 'Too Many Requests' }, quota_error: false });
  });
  api.settings().serverBridgeBaseUrl = 'https://new.xfxai.top/v1';
  await assert.rejects(api.generateState(state()), error => error.status === 429);
  assert.equal(api.ngCooldownSeconds(), 60);
  assert.equal(bodies.length, 1);
  assert.equal(JSON.parse(bodies[0].custom_include_body).model, 'nai-diffusion-5-full');
  await assert.rejects(api.generateState(state()), /wait 60 seconds/);
  assert.equal(bodies.length, 1);
});

test('quota exhaustion is distinguished from a temporary rate limit', async () => {
  const api = runtime(async () => Response.json({ error: { message: 'Too Many Requests' }, quota_error: true }));
  api.settings().serverBridgeBaseUrl = 'https://new.xfxai.top/v1';
  await assert.rejects(api.generateState(state()), /quota exhausted/);
  assert.equal(api.ngCooldownSeconds(), 0, 'waiting alone cannot restore exhausted quota');
});

test('cooldown belongs to the connection that received it, including its credential', async () => {
  const api = runtime(async () => Response.json({}, { status: 429, headers: { 'Retry-After': '12' } }));
  await api.ngProviderFetch('https://new.xfxai.top/v1/chat/completions', { method: 'POST', body: '{"model":"nai-diffusion-5-full"}' });
  assert.equal(api.ngCooldownSeconds(), 12);
  api.setKey('another-user-key');
  assert.equal(api.ngCooldownSeconds(), 0);
  api.setKey('test-key');
  assert.equal(api.ngCooldownSeconds(), 12);
  api.settings().proxyBaseUrl = 'https://another.example/v1';
  assert.equal(api.ngCooldownSeconds(), 0);
});

test('Studio and quick generation cannot submit overlapping jobs or alter the running prompt', async () => {
  let finish;
  let calls = 0;
  const api = runtime(async () => {
    if (++calls === 1) await new Promise(resolve => { finish = resolve; });
    return Response.json({ data: [{ url: 'https://example.test/image.png' }] });
  });
  const input = state({ prompt: 'a cat', visualStyle: 'anime' });
  const first = api.generateState(input);
  await new Promise(resolve => setImmediate(resolve));
  const runningPrompt = input.prompt;
  await assert.rejects(api.generateState(input), /already in progress/);
  assert.equal(input.prompt, runningPrompt);
  assert.equal(calls, 1);
  finish();
  await first;
  assert.equal(input.prompt, 'a cat');
  await api.generateState(input);
  assert.equal(calls, 2);
});

test('RVL shop X/MI routes put generation controls in Parameter chat text', async () => {
  for (const prefix of ['[X]-[AG]', '[MI]-[AG]', '[X]-[AG]-[Img1]']) {
    const requests = [];
    const api = runtime(async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] });
    });
    api.settings().proxyBaseUrl = 'https://shop.rvlconnect.com/v1';
    api.settings().model = `${prefix}-nai-diffusion-5-full-[0.2]`;
    await api.generateState(state({ seed: 123456 }));
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /chat\/completions$/);
    assert.match(requests[0].body.messages[0].content, /Parameter\{size:832:1216,steps:28,scale:5,sampler:k_euler_ancestral,seed:123456,/);
  }
});

test('RVL shop native channels retain the input and native parameters through chat', async () => {
  const requests = [];
  const api = runtime(async (url, options) => {
    if (!url.endsWith('/chat/completions')) return new Response('missing', { status: 404 });
    requests.push(JSON.parse(options.body));
    return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] });
  });
  api.settings().proxyBaseUrl = 'https://shop.rvlconnect.com/v1';
  api.settings().model = '[DM]-[AG]-nai-diffusion-4-5-full-[0.1]';
  await api.generateState(state({ seed: 123456, negative: 'lowres' }));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].input, 'a cat');
  assert.equal(requests[0].messages[0].content, 'a cat');
  assert.equal(requests[0].parameters.seed, 123456);
  assert.equal(requests[0].parameters.negative_prompt, 'lowres');
});

test('a model-specific 404 does not disable the image route for another model', async () => {
  const requests = [];
  const api = runtime(async (url, options) => {
    const body = JSON.parse(options.body || '{}');
    if (!body.prompt && !body.messages) return new Response('missing', { status: 404 });
    requests.push({ url, model: body.model });
    if (url.endsWith('/images/generations') && body.model === 'nai-diffusion-5-full') return new Response('missing', { status: 404 });
    return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] });
  });
  api.settings().proxyBaseUrl = 'https://other.example/v1';
  await api.generateState(state());
  api.settings().model = 'nai-diffusion-4-5-full';
  await api.generateState(state());
  assert.match(requests.at(-1).url, /images\/generations$/);
  assert.equal(requests.at(-1).model, 'nai-diffusion-4-5-full');
});

test('RVL shop legacy V4.5 uses compact chat and Bak uses the image route', async () => {
  for (const [model, route] of [
    ['[X]-[AG]-nai-diffusion-4-5-full-[0.21]', 'chat/completions'],
    ['[X]-[AG]-[Bak]-nai-diffusion-4-5-full-[0.21]', 'images/generations'],
  ]) {
    const requests = [];
    const api = runtime(async (url, options) => {
      const body = JSON.parse(options.body || '{}');
      if (!body.prompt && !body.messages) return new Response('missing', { status: 404 });
      requests.push({ url, body });
      return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] });
    });
    api.settings().proxyBaseUrl = 'https://shop.rvlconnect.com/v1';
    api.settings().model = model;
    await api.generateState(state({ seed: 123456, negative: 'lowres' }));
    assert.equal(requests.length, 1);
    assert.ok(requests[0].url.endsWith(route));
    assert.equal(requests[0].body.seed, 123456);
    if (route.startsWith('chat')) assert.doesNotMatch(requests[0].body.messages[0].content, /Parameter\{/);
  }
});
