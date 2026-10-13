const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function runtime(fetchImpl) {
  const context = { extensionSettings: {}, saveSettingsDebounced() {} };
  const sandbox = {
    console, URL, Response, AbortController, DOMException, TextDecoder, Blob,
    performance, structuredClone,
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
