const EXT = 'novelGeneration';
const VERSION = '0.3.0';

const SIZES = {
  portrait: [832, 1216, 'Portrait'],
  square: [1024, 1024, 'Square'],
  landscape: [1216, 832, 'Horizontal'],
};

const DEFAULTS = {
  baseUrl: '',
  model: 'nai-diffusion-4-5-full',
  responseFormat: 'b64_json',
  compatibility: 'auto',
  routeMode: 'auto',
  timeoutMs: 120000,
  autoInsertTarget: 'assistant',
  image: {
    preset: 'portrait',
    width: 832,
    height: 1216,
    steps: 28,
    guidance: 5,
    sampler: 'k_euler_ancestral',
    scheduler: 'native',
    seed: -1,
    n: 1,
  },
  roleplay: {
    character: true,
    persona: true,
    lastMessage: true,
    gallery: true,
    autoInsert: true,
  },
};

let apiKey = '';
let models = [];
let studio = null;
let escapeHandler = null;
let mountTimer = null;
let mountAttempts = 0;
const gallery = [];
const debugLog = [];

const ctx = () => SillyTavern.getContext();
const clone = value => typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value));

function settings() {
  const c = ctx();
  c.extensionSettings[EXT] ??= clone(DEFAULTS);
  const s = c.extensionSettings[EXT];
  s.image ??= clone(DEFAULTS.image);
  s.roleplay ??= clone(DEFAULTS.roleplay);
  for (const [key, value] of Object.entries(DEFAULTS)) if (!(key in s)) s[key] = clone(value);
  for (const [key, value] of Object.entries(DEFAULTS.image)) if (!(key in s.image)) s.image[key] = clone(value);
  for (const [key, value] of Object.entries(DEFAULTS.roleplay)) if (!(key in s.roleplay)) s.roleplay[key] = clone(value);
  if (typeof s.apiKey === 'string' && s.apiKey && !apiKey) apiKey = s.apiKey;
  if ('apiKey' in s) {
    delete s.apiKey;
    c.saveSettingsDebounced?.();
  }
  return s;
}

const save = () => ctx().saveSettingsDebounced?.();

function esc(value = '') {
  const node = document.createElement('div');
  node.textContent = String(value);
  return node.innerHTML;
}
const attr = value => esc(value).replace(/"/g, '&quot;');

function toast(kind, message) {
  const t = globalThis.toastr;
  if (t?.[kind]) t[kind](message, 'Novel Generation');
  else console[kind === 'error' ? 'error' : 'log'](`[Novel Generation] ${message}`);
}

function field(label, control, help = '') {
  return `<label class="ng-field"><span class="ng-label">${label}</span>${control}${help ? `<small class="ng-help">${help}</small>` : ''}</label>`;
}

function section(id, icon, title, subtitle, body) {
  return `<details class="ng-section" id="${id}"><summary><span class="ng-section-icon"><i class="fa-solid ${icon}"></i></span><span class="ng-section-copy"><strong>${title}</strong><small>${subtitle}</small></span><i class="fa-solid fa-chevron-down ng-section-chevron"></i></summary><div class="ng-section-body">${body}</div></details>`;
}

function sizePicker(prefix, image) {
  const preset = image.preset || 'portrait';
  const buttons = Object.entries(SIZES).map(([key, [width, height, label]]) => `
    <button type="button" class="menu_button ng-size-choice ${preset === key ? 'is-active' : ''}" data-ng-size="${key}">
      <i class="fa-solid ${key === 'portrait' ? 'fa-mobile-screen' : key === 'square' ? 'fa-square' : 'fa-panorama'}"></i>
      <span><strong>${label}</strong><small>${width} × ${height}</small></span>
    </button>`).join('');

  return `<div class="ng-size-chooser">${buttons}
    <button type="button" class="menu_button ng-size-choice ${preset === 'custom' ? 'is-active' : ''}" data-ng-size="custom">
      <i class="fa-solid fa-crop-simple"></i><span><strong>Custom</strong><small>Manual size</small></span>
    </button>
  </div>
  <div class="ng-custom-size ${preset === 'custom' ? 'is-visible' : ''}" data-ng-custom="${prefix}">
    ${field('Width', `<input id="${prefix}-width" class="text_pole" type="number" min="64" step="64" value="${Number(image.width) || 832}">`)}
    ${field('Height', `<input id="${prefix}-height" class="text_pole" type="number" min="64" step="64" value="${Number(image.height) || 1216}">`)}
  </div>`;
}

function settingsHtml() {
  const s = settings();
  const connection = `
    ${field('Base URL', `<input id="ng-base-url" class="text_pole" type="url" value="${attr(s.baseUrl)}" placeholder="https://example.com/v1">`)}
    ${field('API Key', `<div class="ng-key-row"><input id="ng-api-key" class="text_pole" type="password" value="${attr(apiKey)}" placeholder="Paste API key"><button id="ng-key-eye" class="menu_button" type="button" title="Show or hide API key"><i class="fa-solid fa-eye"></i></button></div>`, 'The key stays in this browser session and is never exported with gallery metadata.')}
    <button id="ng-connect" class="menu_button" type="button"><i class="fa-solid fa-plug-circle-check"></i> Test connection & load models</button>
    <div id="ng-status" class="ng-status">Not connected yet.</div>
    ${field('Available model', `<select id="ng-model" class="text_pole" ${models.length ? '' : 'disabled'}>${models.length ? models.map(m => `<option value="${attr(m)}" ${m === s.model ? 'selected' : ''}>${esc(m)}</option>`).join('') : `<option>${esc(s.model)}</option>`}</select>`, 'After a successful connection test, models returned by /v1/models appear here.')}
    <div class="ng-grid ng-grid-2">
      ${field('Route mode', `<select id="ng-route" class="text_pole"><option value="auto" ${s.routeMode === 'auto' ? 'selected' : ''}>Auto</option><option value="images" ${s.routeMode === 'images' ? 'selected' : ''}>/v1/images/generations</option><option value="chat" ${s.routeMode === 'chat' ? 'selected' : ''}>/v1/chat/completions</option></select>`)}
      ${field('Payload mode', `<select id="ng-compat" class="text_pole"><option value="auto" ${s.compatibility === 'auto' ? 'selected' : ''}>Auto / NovelAI-aware</option><option value="strict" ${s.compatibility === 'strict' ? 'selected' : ''}>Strict OpenAI</option></select>`)}
      ${field('Response format', `<select id="ng-format" class="text_pole"><option value="b64_json" ${s.responseFormat === 'b64_json' ? 'selected' : ''}>b64_json</option><option value="url" ${s.responseFormat === 'url' ? 'selected' : ''}>url</option></select>`)}
      ${field('Timeout (ms)', `<input id="ng-timeout" class="text_pole" type="number" min="1000" step="1000" value="${s.timeoutMs}">`)}
    </div>`;

  const image = `<p class="ng-muted">Smart sizes use NovelAI-friendly portrait, square, and horizontal defaults. Custom remains available when the proxy accepts other dimensions.</p>${sizePicker('ng', s.image)}
    <div class="ng-grid ng-grid-2">
      ${field('Steps', `<input id="ng-steps" class="text_pole" type="number" min="1" max="100" value="${s.image.steps}">`)}
      ${field('Guidance', `<input id="ng-guidance" class="text_pole" type="number" min="0" max="30" step="0.1" value="${s.image.guidance}">`)}
      ${field('Sampler', `<select id="ng-sampler" class="text_pole"><option value="k_euler_ancestral">Euler Ancestral</option><option value="k_dpmpp_2m">DPM++ 2M</option><option value="k_euler">Euler</option><option value="k_dpmpp_sde">DPM++ SDE</option></select>`)}
      ${field('Scheduler', `<select id="ng-scheduler" class="text_pole"><option value="native">Provider default</option><option value="karras">Karras</option><option value="exponential">Exponential</option></select>`)}
      ${field('Seed', `<input id="ng-seed" class="text_pole" type="number" value="${s.image.seed}">`)}
      ${field('Images', `<input id="ng-n" class="text_pole" type="number" min="1" max="4" value="${s.image.n}">`)}
    </div>`;

  const roleplay = `
    <label class="checkbox_label"><input id="ng-rp-character" type="checkbox" ${s.roleplay.character ? 'checked' : ''}><span>Use active character data for quick generation</span></label>
    <label class="checkbox_label"><input id="ng-rp-persona" type="checkbox" ${s.roleplay.persona ? 'checked' : ''}><span>Use current user/persona name</span></label>
    <label class="checkbox_label"><input id="ng-rp-last" type="checkbox" ${s.roleplay.lastMessage ? 'checked' : ''}><span>Use the latest roleplay message as scene context</span></label>
    <label class="checkbox_label"><input id="ng-rp-gallery" type="checkbox" ${s.roleplay.gallery ? 'checked' : ''}><span>Keep successful generations in the session gallery</span></label>
    <label class="checkbox_label"><input id="ng-rp-insert" type="checkbox" ${s.roleplay.autoInsert ? 'checked' : ''}><span>Automatically insert Novel Image Gen results into the active chat</span></label>
    ${field('Insert target', `<select id="ng-insert-target" class="text_pole"><option value="assistant" ${s.autoInsertTarget === 'assistant' ? 'selected' : ''}>Latest assistant message</option><option value="user" ${s.autoInsertTarget === 'user' ? 'selected' : ''}>Latest user message</option><option value="latest" ${s.autoInsertTarget === 'latest' ? 'selected' : ''}>Latest message</option></select>`, 'Quick generation attaches generated media to this message without changing the roleplay text.')}`;

  const features = `<div class="ng-feature-actions">
      <button class="menu_button ng-feature-open" data-feature="vibe" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i><span><strong>Vibe Transfer</strong><small>Native NAI arrays + proxy fallback schemas</small></span></button>
      <button class="menu_button ng-feature-open" data-feature="precise" type="button"><i class="fa-solid fa-id-card-clip"></i><span><strong>Precise Reference</strong><small>Character / style + strength + fidelity</small></span></button>
      <button class="menu_button ng-feature-open" data-feature="edit" type="button"><i class="fa-solid fa-paintbrush"></i><span><strong>Inpaint / Image-to-Image</strong><small>Paint the area to regenerate directly on a mask canvas</small></span></button>
      <button class="menu_button ng-feature-open" data-feature="upscale" type="button"><i class="fa-solid fa-up-right-and-down-left-from-center"></i><span><strong>Upscale / Enhance</strong><small>2× / 4K provider attempt with img2img fallback</small></span></button>
    </div>`;

  const galleryHtml = `<div class="ng-actions"><button id="ng-gallery-open" class="menu_button" type="button"><i class="fa-solid fa-images"></i> Open gallery</button><button id="ng-gallery-export" class="menu_button" type="button"><i class="fa-solid fa-file-export"></i> Export metadata</button></div>`;
  const advanced = `<p class="ng-muted">Auto mode first sends NovelAI-native Vibe and Director Reference fields, then retries alternate proxy schemas only when the provider rejects a request. It does not silently fall back to a reference-free generation when Vibe or Precise is active.</p><button id="ng-debug-open" class="menu_button" type="button"><i class="fa-solid fa-bug"></i> Open request debug</button>`;

  return `<div id="ng-settings" class="ng-settings-root"><div class="inline-drawer">
    <div id="ng-drawer-toggle" class="inline-drawer-toggle inline-drawer-header interactable" tabindex="0" role="button" aria-expanded="false"><b><i class="fa-solid fa-image"></i> Novel Generation <span class="ng-version">v${VERSION}</span></b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
    <div class="inline-drawer-content"><p class="ng-settings-copy">NovelAI-oriented image generation for roleplay and standalone use.</p>
      ${section('ng-connection', 'fa-link', 'Connection & Provider', 'Connection, model and compatibility', connection)}
      ${section('ng-image', 'fa-sliders', 'Image Parameters', 'Smart size and generation defaults', image)}
      ${section('ng-roleplay', 'fa-comments', 'Roleplay Integration', 'Quick generation and chat insertion', roleplay)}
      ${section('ng-features', 'fa-layer-group', 'Vibe, Reference & Editing', 'Open the full Novel Gen workspace', features)}
      ${section('ng-gallery', 'fa-photo-film', 'Gallery & Export', 'Session images and metadata', galleryHtml)}
      ${section('ng-advanced', 'fa-code', 'Advanced / Debug', 'Provider fallback visibility', advanced)}
    </div>
  </div></div>`;
}
