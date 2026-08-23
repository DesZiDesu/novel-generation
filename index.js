(() => {

/* ===== Runtime 01: configuration, settings, and shared utilities ===== */
const EXT = 'novelGeneration';
const VERSION = '0.7.10';

const SIZES = {
  portrait: [832, 1216, 'Vertical / Portrait'],
  square: [1024, 1024, 'Square'],
  landscape: [1216, 832, 'Horizontal / Landscape'],
};

const NAI_DIRECT_BASE_URL = 'https://image.novelai.net';
const NAI_DIRECT_MODELS = [
  'nai-diffusion-5-full',
  'nai-diffusion-5-curated',
  'nai-diffusion-4-5-full',
  'nai-diffusion-4-5-curated',
  'nai-diffusion-4-full',
  'nai-diffusion-4-curated-preview',
];

const DEFAULTS = {
  provider: 'proxy',
  baseUrl: '',
  apiKey: '',
  proxyBaseUrl: '',
  proxyApiKey: '',
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
    galleryLimit: 16,
  },
};

let apiKey = '';
let models = [];
let studio = null;
let escapeHandler = null;
let mountTimer = null;
let mountAttempts = 0;
let studioLaunchTimer = null;
let studioLaunchSequence = 0;
const gallery = [];
const debugLog = [];
const unavailableAutoRoutes = new Set();
const ngRvlRequestSeeds = new WeakMap();

const ctx = () => SillyTavern.getContext();
const clone = value => typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value));

function ngCanvasOrientation(width, height) {
  if (width === height) return 'square';
  return width < height ? 'vertical' : 'horizontal';
}

function ngUsesCompactChatImageRoute(model) {
  const value = String(model || '').trim();
  return ngIsRvlProxy()
    && !/^\[备用\]/.test(value)
    && /nai-diffusion-(?:5|4-5)(?:-|$)/i.test(value);
}

function ngUsesBackupImagesRoute(model) {
  return ngIsRvlProxy() && /^\[备用\]/.test(String(model || '').trim());
}

function ngIsRvlProxy() {
  return /^https?:\/\/(?:www\.)?rvlconnect\.com(?:\/|$)/i.test(base());
}

function ngImageSizeValue(model, width, height, route = 'images') {
  const separator = route === 'chat' && ngUsesCompactChatImageRoute(model) ? ':' : 'x';
  return `${Math.round(width)}${separator}${Math.round(height)}`;
}

function ngRvlChatSeed(state) {
  const selected = Math.trunc(Number(state?.seed));
  if (Number.isSafeInteger(selected) && selected >= 0) return selected;
  if (state && typeof state === 'object' && ngRvlRequestSeeds.has(state)) {
    return ngRvlRequestSeeds.get(state);
  }
  // RVL's Go request schema uses uint64, so Novel Generation's -1 random
  // sentinel must become a positive seed before the request is serialized.
  const generated = Math.floor(Math.random() * 900000) + 100000;
  if (state && typeof state === 'object') ngRvlRequestSeeds.set(state, generated);
  return generated;
}

function ngResolveCanvasSize(image) {
  const original = {
    preset: String(image?.preset || 'custom'),
    width: Number(image?.width),
    height: Number(image?.height),
  };
  const canonical = SIZES[original.preset];
  const width = canonical
    ? canonical[0]
    : Math.max(64, Math.round(Number.isFinite(original.width) ? original.width : DEFAULTS.image.width));
  const height = canonical
    ? canonical[1]
    : Math.max(64, Math.round(Number.isFinite(original.height) ? original.height : DEFAULTS.image.height));
  return {
    preset: canonical ? original.preset : 'custom',
    width,
    height,
    orientation: ngCanvasOrientation(width, height),
    corrected: original.preset !== (canonical ? original.preset : 'custom')
      || original.width !== width
      || original.height !== height,
    original,
  };
}

function ngApplyCanvasSize(image) {
  if (!image || typeof image !== 'object') return null;
  const resolved = ngResolveCanvasSize(image);
  image.preset = resolved.preset;
  image.width = resolved.width;
  image.height = resolved.height;
  return resolved;
}

function ngUpdateCanvasStatus(prefix, image) {
  const node = document.querySelector(`[data-ng-size-status="${prefix}"]`);
  if (!node || !image) return;
  const resolved = ngResolveCanvasSize(image);
  node.textContent = `Canvas sent to the image model: ${resolved.width} × ${resolved.height} · ${resolved.orientation}`;
}

function settings() {
  const c = ctx();
  c.extensionSettings[EXT] ??= clone(DEFAULTS);
  const s = c.extensionSettings[EXT];
  if (!['proxy', 'novelai'].includes(s.provider)) s.provider = 'proxy';
  s.image ??= clone(DEFAULTS.image);
  s.roleplay ??= clone(DEFAULTS.roleplay);
  for (const [key, value] of Object.entries(DEFAULTS)) if (!(key in s)) s[key] = clone(value);
  for (const [key, value] of Object.entries(DEFAULTS.image)) if (!(key in s.image)) s.image[key] = clone(value);
  for (const [key, value] of Object.entries(DEFAULTS.roleplay)) if (!(key in s.roleplay)) s.roleplay[key] = clone(value);
  // A few older builds could persist a preset name and the dimensions from a
  // different preset. Make the visible fixed preset authoritative so Portrait
  // can never silently leave a stale 1216 × 832 landscape canvas behind.
  ngApplyCanvasSize(s.image);
  if (typeof s.apiKey !== 'string') s.apiKey = '';
  if (typeof s.proxyBaseUrl !== 'string') s.proxyBaseUrl = s.provider === 'proxy' ? s.baseUrl : '';
  if (typeof s.proxyApiKey !== 'string') s.proxyApiKey = s.provider === 'proxy' ? s.apiKey : '';

  if (s.provider === 'proxy') {
    if (!s.proxyBaseUrl && s.baseUrl) s.proxyBaseUrl = s.baseUrl;
    if (!s.proxyApiKey && s.apiKey) s.proxyApiKey = s.apiKey;
    if (!apiKey && s.proxyApiKey) apiKey = s.proxyApiKey;
    if (apiKey !== s.proxyApiKey) s.proxyApiKey = apiKey;
    if (s.baseUrl !== s.proxyBaseUrl) s.baseUrl = s.proxyBaseUrl;
    if (s.apiKey !== apiKey) s.apiKey = apiKey;
  } else {
    // Never persist or restore the official NovelAI key. It is session-only.
    s.baseUrl = NAI_DIRECT_BASE_URL;
    s.apiKey = '';
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
  const resolved = ngResolveCanvasSize(image);
  const preset = resolved.preset;
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
  </div>
  <small class="ng-help ng-canvas-size-status" data-ng-size-status="${prefix}">Canvas sent to the image model: ${resolved.width} × ${resolved.height} · ${resolved.orientation}</small>`;
}

function settingsHtml() {
  const s = settings();
  const connection = `
    ${field('Provider', `<select id="ng-provider" class="text_pole"><option value="proxy" ${s.provider === 'proxy' ? 'selected' : ''}>OpenAI-compatible proxy</option><option value="novelai" ${s.provider === 'novelai' ? 'selected' : ''}>Direct NovelAI API</option></select>`, 'Direct NovelAI mode uses the official image.novelai.net native image API. Proxy mode keeps the existing OpenAI-compatible routes.')}
    ${field('Base URL', `<input id="ng-base-url" class="text_pole" type="url" value="${attr(s.baseUrl)}" placeholder="${s.provider === 'novelai' ? NAI_DIRECT_BASE_URL : 'https://example.com/v1'}" ${s.provider === 'novelai' ? 'readonly' : ''}>`, s.provider === 'novelai' ? 'Official NovelAI URL is used automatically.' : 'Enter the base URL exposed by your image proxy.')}
    ${field('API Key', `<div class="ng-key-row"><input id="ng-api-key" class="text_pole" type="password" value="${attr(apiKey)}" placeholder="Paste API key"><button id="ng-key-eye" class="menu_button" type="button" title="Show or hide API key"><i class="fa-solid fa-eye"></i></button></div>`, 'Proxy credentials are stored in SillyTavern extension settings on this device; the Direct NovelAI key is session-only and is never exported with gallery metadata.')}
    <button id="ng-connect" class="menu_button" type="button"><i class="fa-solid fa-plug-circle-check"></i> Test connection & load models</button>
    <div id="ng-status" class="ng-status">Not connected yet.</div>
    ${field('Available model', `<select id="ng-model" class="text_pole" ${models.length ? '' : 'disabled'}>${models.length ? models.map(m => `<option value="${attr(m)}" ${m === s.model ? 'selected' : ''}>${esc(m)}</option>`).join('') : `<option>${esc(s.model)}</option>`}</select>`, s.provider === 'novelai' ? 'Direct mode uses the supported NovelAI Diffusion model list; the official image API does not expose /v1/models.' : 'After a successful connection test, models returned by /v1/models appear here.')}
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

  const galleryHtml = `${field('Session gallery limit', `<input id="ng-gallery-limit" class="text_pole" type="number" inputmode="numeric" min="1" max="40" value="${Math.max(1, Math.min(40, Number(s.roleplay.galleryLimit) || 16))}">`, 'Full-resolution images use browser memory. A lower limit is safer on iPhone and iPad.')}<div class="ng-actions"><button id="ng-gallery-open" class="menu_button" type="button"><i class="fa-solid fa-images"></i> Open gallery</button><button id="ng-gallery-export" class="menu_button" type="button"><i class="fa-solid fa-file-export"></i> Export metadata</button><button id="ng-gallery-clear-drawer" class="menu_button" type="button"><i class="fa-solid fa-trash"></i> Clear gallery</button></div>`;
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


/* ===== Runtime 02: settings drawer and connection controls ===== */
function bindDrawer() {
  const toggle = document.getElementById('ng-drawer-toggle');
  const content = document.querySelector('#ng-settings .inline-drawer-content');
  const icon = toggle?.querySelector('.inline-drawer-icon');
  if (!toggle || !content) return;

  // SillyTavern's own .inline-drawer-content CSS is hidden by default. Setting
  // display back to an empty string therefore leaves the drawer invisible.
  // Keep control local to this extension and explicitly set a visible display.
  const setOpen = open => {
    toggle.setAttribute('aria-expanded', String(open));
    content.style.display = open ? 'block' : 'none';
    icon?.classList.toggle('down', !open);
    icon?.classList.toggle('up', open);
  };

  setOpen(false);

  const flip = event => {
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    if (event.type === 'keydown') event.preventDefault();

    // Prevent SillyTavern's generic inline-drawer handler from toggling the
    // same node a second time after our extension-specific handler runs.
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  };

  // Capture phase makes this deterministic even when SillyTavern has a
  // delegated/native drawer listener installed elsewhere in the document.
  toggle.addEventListener('click', flip, { capture: true });
  toggle.addEventListener('keydown', flip, { capture: true });
}

function bindSettings() {
  const s = settings();
  const bind = (id, fn, event = 'input') => document.getElementById(id)?.addEventListener(event, e => { fn(e.currentTarget); save(); });
  bind('ng-provider', el => {
    if (el.value === s.provider) return;
    if (s.provider === 'proxy') {
      s.proxyBaseUrl = s.baseUrl;
      s.proxyApiKey = apiKey;
    }
    s.provider = el.value;
    const baseInput = document.getElementById('ng-base-url');
    const keyInput = document.getElementById('ng-api-key');
    const modelSelect = document.getElementById('ng-model');
    models = [];
    if (s.provider === 'novelai') {
      s.compatibility = 'auto';
      s.baseUrl = NAI_DIRECT_BASE_URL;
      apiKey = '';
      s.apiKey = '';
      if (baseInput) {
        baseInput.value = NAI_DIRECT_BASE_URL;
        baseInput.readOnly = true;
      }
      if (keyInput) {
        keyInput.value = '';
        keyInput.type = 'password';
      }
    } else {
      s.baseUrl = s.proxyBaseUrl || '';
      apiKey = s.proxyApiKey || '';
      s.apiKey = apiKey;
      if (baseInput) {
        baseInput.value = s.baseUrl;
        baseInput.readOnly = false;
      }
      if (keyInput) keyInput.value = apiKey;
    }
    if (modelSelect) modelSelect.disabled = true;
    ngProviderCaps.checked = false;
  }, 'change');
  bind('ng-base-url', el => {
    s.baseUrl = el.value.trim();
    if (s.provider === 'proxy') s.proxyBaseUrl = s.baseUrl;
  });
  bind('ng-format', el => s.responseFormat = el.value, 'change');
  bind('ng-compat', el => s.compatibility = el.value, 'change');
  bind('ng-route', el => s.routeMode = el.value, 'change');
  bind('ng-model', el => s.model = el.value, 'change');
  bind('ng-timeout', el => s.timeoutMs = +el.value || 120000);
  bind('ng-steps', el => s.image.steps = +el.value || 28);
  bind('ng-guidance', el => s.image.guidance = +el.value || 5);
  bind('ng-sampler', el => s.image.sampler = el.value, 'change');
  bind('ng-scheduler', el => s.image.scheduler = el.value, 'change');
  bind('ng-seed', el => s.image.seed = Number.isFinite(+el.value) ? +el.value : -1);
  bind('ng-n', el => s.image.n = Math.max(1, Math.min(4, +el.value || 1)));
  bind('ng-rp-character', el => s.roleplay.character = el.checked, 'change');
  bind('ng-rp-persona', el => s.roleplay.persona = el.checked, 'change');
  bind('ng-rp-last', el => s.roleplay.lastMessage = el.checked, 'change');
  bind('ng-rp-gallery', el => s.roleplay.gallery = el.checked, 'change');
  bind('ng-rp-insert', el => s.roleplay.autoInsert = el.checked, 'change');
  bind('ng-insert-target', el => s.autoInsertTarget = el.value, 'change');
  bind('ng-width', el => { s.image.width = +el.value || 832; s.image.preset = 'custom'; ngUpdateCanvasStatus('ng', s.image); });
  bind('ng-height', el => { s.image.height = +el.value || 1216; s.image.preset = 'custom'; ngUpdateCanvasStatus('ng', s.image); });

  document.getElementById('ng-api-key')?.addEventListener('input', e => {
    const s = settings();
    apiKey = e.currentTarget.value;
    if (s.provider === 'proxy') {
      s.proxyApiKey = apiKey;
      s.apiKey = apiKey;
    } else {
      s.apiKey = '';
    }
    save();
  });
  document.getElementById('ng-key-eye')?.addEventListener('click', () => {
    const input = document.getElementById('ng-api-key');
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('ng-connect')?.addEventListener('click', connectAndLoadModels);
  document.querySelectorAll('#ng-settings .ng-size-choice').forEach(btn => btn.addEventListener('click', () => setSize('settings', btn.dataset.ngSize)));
  document.querySelectorAll('#ng-settings .ng-feature-open').forEach(btn => btn.addEventListener('click', () => openStudio('free', btn.dataset.feature)));
  document.getElementById('ng-gallery-open')?.addEventListener('click', () => openStudio('free', 'gallery'));
  document.getElementById('ng-gallery-export')?.addEventListener('click', exportGallery);
  document.getElementById('ng-gallery-clear-drawer')?.addEventListener('click', () => ngV068ClearGallery(true));
  document.getElementById('ng-gallery-limit')?.addEventListener('change', event => {
    const limit = Math.max(1, Math.min(40, Math.round(Number(event.currentTarget.value) || 16)));
    s.roleplay.galleryLimit = limit;
    event.currentTarget.value = limit;
    ngV068TrimGallery(limit);
    save();
  });
  document.getElementById('ng-debug-open')?.addEventListener('click', () => openStudio('free', 'debug'));
  const sampler = document.getElementById('ng-sampler');
  const scheduler = document.getElementById('ng-scheduler');
  if (sampler) sampler.value = s.image.sampler;
  if (scheduler) scheduler.value = s.image.scheduler;
  bindDrawer();
}

function setSize(target, preset) {
  const data = target === 'settings' ? settings().image : studio;
  if (!data) return;
  data.preset = preset;
  if (SIZES[preset]) [data.width, data.height] = SIZES[preset];
  ngApplyCanvasSize(data);
  if (target === 'settings') save();
  const root = target === 'settings' ? document.getElementById('ng-settings') : document.getElementById('ng-studio-overlay');
  root?.querySelectorAll('.ng-size-choice').forEach(btn => btn.classList.toggle('is-active', btn.dataset.ngSize === preset));
  const prefix = target === 'settings' ? 'ng' : 'ng-studio';
  root?.querySelector(`[data-ng-custom="${prefix}"]`)?.classList.toggle('is-visible', preset === 'custom');
  const width = document.getElementById(`${prefix}-width`);
  const height = document.getElementById(`${prefix}-height`);
  if (width) width.value = data.width;
  if (height) height.value = data.height;
  ngUpdateCanvasStatus(prefix, data);
}

function isDirectNovelAI() {
  return settings().provider === 'novelai';
}

const base = () => {
  const configured = String(settings().baseUrl || '').trim();
  return (isDirectNovelAI() ? (configured || NAI_DIRECT_BASE_URL) : configured).replace(/\/+$/, '');
};
const endpoint = path => /\/v1$/i.test(base()) ? `${base()}${path.replace(/^\/v1/, '')}` : `${base()}${path}`;
const headers = () => ({ 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) });

async function errText(response) {
  try {
    const text = await response.text();
    return text ? text.slice(0, 1200) : response.statusText;
  } catch {
    return response.statusText;
  }
}

function modelIds(data) {
  const source = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  return [...new Set(source.map(item => typeof item === 'string' ? item : item?.id || item?.name).filter(Boolean))];
}

function status(text, state = '') {
  const el = document.getElementById('ng-status');
  if (el) {
    el.textContent = text;
    el.className = `ng-status ${state ? `is-${state}` : ''}`;
  }
}

async function connectAndLoadModels() {
  const s = settings();
  if (!base()) return toast('warning', 'Enter a Base URL first.');
  if (!apiKey) return toast('warning', 'Enter an API key first.');
  const button = document.getElementById('ng-connect');
  button?.setAttribute('disabled', 'disabled');
  status('Testing connection and loading models…', 'testing');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, s.timeoutMs));
  try {
    const response = await fetch(endpoint('/v1/models'), { headers: headers(), signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await errText(response)}`);
    models = modelIds(await response.json());
    if (!models.length) throw new Error('Connected, but /v1/models returned no selectable model list.');
    const select = document.getElementById('ng-model');
    select.innerHTML = models.map(model => `<option value="${attr(model)}">${esc(model)}</option>`).join('');
    const preferred = models.includes(s.model) ? s.model : models.find(model => /nai.*4.?5.*full/i.test(model)) || models[0];
    s.model = preferred;
    select.value = preferred;
    select.disabled = false;
    save();
    status(`Connected. ${models.length} model${models.length === 1 ? '' : 's'} available.`, 'ok');
    toast('success', 'Connected. Choose a model from the list.');
  } catch (error) {
    status(`Connection failed: ${error.message}`, 'error');
    toast('error', `Connection failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
    button?.removeAttribute('disabled');
  }
}

function makeWandRow(id, icon, label, className = '') {
  const row = document.createElement('div');
  row.id = id;
  row.className = `list-group-item flex-container flexGap5 interactable ${className}`.trim();
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.innerHTML = `<i class="fa-solid ${icon}"></i><span>${label}</span>`;
  return row;
}

function bindPress(row, handler, options = {}) {
  const run = event => {
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    if (event.type === 'keydown') event.preventDefault();
    // AstraProjecta closes its modal extensions drawer from a delegated click
    // listener on the menu host. Action rows must bubble so Astra can release
    // its focus/scroll lock before our full-screen editor is used.
    if (!options.allowHostClose) event.stopPropagation();
    handler(event);
  };
  row.addEventListener('click', run);
  row.addEventListener('keydown', run);
}


/* ===== Runtime 03: Wand menu integration ===== */
function initWand() {
  const menu = document.getElementById('extensionsMenu');
  if (!menu) return false;
  if (document.getElementById('ng-wand-image')) return true;

  const quick = makeWandRow('ng-wand-image', 'fa-image', 'Novel Image Gen');
  quick.insertAdjacentHTML('beforeend', '<i class="fa-solid fa-chevron-down ng-wand-chevron"></i>');
  menu.appendChild(quick);

  const items = [
    ['portrait', 'fa-user', 'Portrait'],
    ['selfie', 'fa-face-smile', 'Selfie'],
    ['user', 'fa-user', 'User'],
    ['last', 'fa-message', 'Last Message'],
    ['manga', 'fa-table-cells-large', 'Manga Panel'],
    ['free', 'fa-pen-nib', 'Free / Scene'],
  ];

  const rows = [];
  let anchor = quick;
  for (const [mode, icon, label] of items) {
    const row = makeWandRow(`ng-wand-${mode}`, icon, label, 'ng-wand-subitem');
    row.hidden = true;
    anchor.insertAdjacentElement('afterend', row);
    anchor = row;
    rows.push(row);
    bindPress(row, async () => {
      rows.forEach(item => { item.hidden = true; });
      quick.classList.remove('is-open');
      if (mode === 'free') {
        const promptText = window.prompt('Describe the image you want to generate:');
        if (!promptText?.trim()) return;
        await quickGenerate(mode, promptText.trim());
      } else {
        await quickGenerate(mode);
      }
    });
  }

  bindPress(quick, () => {
    const next = !rows[0].hidden;
    rows.forEach(row => { row.hidden = next; });
    quick.classList.toggle('is-open', !next);
  });

  const studioRow = makeWandRow('ng-wand-studio', 'fa-wand-magic-sparkles', 'Novel Gen');
  anchor.insertAdjacentElement('afterend', studioRow);
  bindPress(studioRow, () => scheduleStudioOpen('free', 'prompt'), { allowHostClose: true });
  return true;
}

function stripMarkup(text) {
  const temp = document.createElement('div');
  temp.innerHTML = String(text || '');
  return (temp.textContent || '').replace(/\s+/g, ' ').trim();
}

function lastMessage() {
  try { return stripMarkup(ctx().chat?.at(-1)?.mes || ''); } catch { return ''; }
}

function characterData() {
  try {
    const c = ctx();
    const character = c.characters?.[c.characterId];
    return {
      name: String(c.name2 || character?.name || '').trim(),
      description: stripMarkup(character?.description || character?.data?.description || '').slice(0, 1800),
    };
  } catch {
    return { name: '', description: '' };
  }
}

function personaName() {
  try { return String(ctx().name1 || 'the user').trim(); } catch { return 'the user'; }
}

function modePrompt(mode) {
  const s = settings();
  const char = characterData();
  const scene = s.roleplay.lastMessage ? lastMessage() : '';
  const charContext = s.roleplay.character && char.description ? ` Character appearance: ${char.description}.` : '';
  const userContext = s.roleplay.persona ? ` User/persona: ${personaName()}.` : '';

  if (mode === 'portrait') return `portrait of ${char.name || 'the active character'}, solo, detailed character illustration.${charContext}`;
  if (mode === 'selfie') return `${char.name || 'the active character'} taking a selfie, candid close framing, natural pose.${charContext}${scene ? ` Current scene: ${scene}` : ''}`;
  if (mode === 'user') return `portrait of ${personaName()}, detailed character illustration.${userContext}${scene ? ` Current scene context: ${scene}` : ''}`;
  if (mode === 'last') return `${scene || 'current roleplay scene'}.${charContext}${userContext}`;
  if (mode === 'manga') return `manga panel, dynamic composition, cinematic storytelling. Scene: ${scene || 'current roleplay scene'}.${charContext}${userContext}`;
  return '';
}

function newStudio(mode = 'free', focus = 'prompt') {
  const defaults = settings().image;
  return {
    mode,
    focus,
    prompt: modePrompt(mode),
    negative: '',
    preset: defaults.preset,
    width: defaults.width,
    height: defaults.height,
    steps: defaults.steps,
    guidance: defaults.guidance,
    sampler: defaults.sampler,
    scheduler: defaults.scheduler,
    seed: defaults.seed,
    n: defaults.n,
    characters: [],
    vibes: [],
    precise: [],
    normalizeVibes: true,
    source: null,
    mask: null,
    editMode: 'img2img',
    strength: 0.6,
    noise: 0.1,
    maskTool: 'brush',
    brushSize: 48,
    generated: [],
  };
}


/* ===== Runtime 04: Studio layout and controls ===== */
function studioSection(focus, icon, title, body, open = false) {
  return `<details class="ng-studio-section" data-focus="${focus}" ${open ? 'open' : ''}><summary><i class="fa-solid ${icon}"></i><span>${title}</span><i class="fa-solid fa-chevron-down"></i></summary><div class="ng-studio-section-body">${body}</div></details>`;
}

function range(id, label, value, min = 0, max = 1, step = 0.01) {
  return `<label class="ng-range-row"><span>${label} <output>${Number(value).toFixed(2)}</output></span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}

function studioHtml() {
  const s = studio;
  const modeName = ({ portrait: 'Portrait', selfie: 'Selfie', user: 'User', last: 'Last Message', manga: 'Manga Panel', free: 'Free / Scene' })[s.mode] || 'Free / Scene';
  return `<div class="ng-studio-shell" role="dialog" aria-modal="true">
    <header class="ng-studio-header"><div class="ng-studio-title"><i class="fa-solid fa-wand-magic-sparkles"></i><span><strong>Novel Gen</strong><small>${modeName}</small></span></div><button id="ng-close" class="menu_button ng-studio-close" type="button"><i class="fa-solid fa-xmark"></i></button></header>
    <nav class="ng-v055-mobile-nav" aria-label="Novel Gen mobile workspace">
      <button class="menu_button" type="button" data-mobile-pane="preview"><i class="fa-regular fa-image"></i><span>Image</span></button>
      <button class="menu_button is-active" type="button" data-mobile-pane="controls" data-tab="generate" aria-pressed="true"><i class="fa-solid fa-wand-magic-sparkles"></i><span>Generate</span></button>
      <button class="menu_button" type="button" data-mobile-pane="controls" data-tab="gallery"><i class="fa-solid fa-images"></i><span>Gallery</span></button>
    </nav>
    <main class="ng-studio-main">
      <section id="ng-preview" class="ng-studio-preview"><div class="ng-preview-empty"><i class="fa-regular fa-image"></i><strong>Ready to generate</strong><span>Generated images appear here and can be reused without downloading.</span></div></section>
      <aside class="ng-studio-controls">
        <div class="ng-studio-tabs"><button class="menu_button is-active" data-tab="generate" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate</button><button class="menu_button" data-tab="gallery" type="button"><i class="fa-solid fa-images"></i> Gallery <span id="ng-gallery-count">${gallery.length}</span></button></div>
        <div id="ng-generate-panel">
          ${studioSection('prompt', 'fa-pen', 'Prompt', `${field('Prompt', `<textarea id="ng-prompt" class="text_pole" rows="7">${esc(s.prompt)}</textarea>`)}${field('Undesired Content', `<textarea id="ng-negative" class="text_pole" rows="4">${esc(s.negative)}</textarea>`)}`, true)}
          ${studioSection('characters', 'fa-people-group', 'Character Prompts', `<div id="ng-character-list"></div><button id="ng-character-add" class="menu_button" type="button"><i class="fa-solid fa-plus"></i> Add Character</button>`)}
          ${studioSection('vibe', 'fa-wand-magic-sparkles', 'Vibe Transfer', `<div id="ng-vibe-lock" class="ng-compat-note"></div><div class="ng-actions"><label class="menu_button ng-file-button"><i class="fa-solid fa-upload"></i> Add vibe image<input id="ng-vibe-file" type="file" accept="image/*" multiple></label><button id="ng-vibe-normalize" class="menu_button" type="button"><i class="fa-solid fa-scale-balanced"></i> Normalize strengths</button></div><div id="ng-vibe-list" class="ng-reference-list"></div>`)}
          ${studioSection('precise', 'fa-id-card-clip', 'Precise Reference', `<div id="ng-precise-lock" class="ng-compat-note"></div><label class="menu_button ng-file-button"><i class="fa-solid fa-upload"></i> Add precise reference<input id="ng-precise-file" type="file" accept="image/*" multiple></label><div id="ng-precise-list" class="ng-reference-list"></div>`)}
          ${studioSection('edit', 'fa-paintbrush', 'Image-to-Image / Inpaint', `${field('Mode', `<select id="ng-edit-mode" class="text_pole"><option value="img2img">Image-to-Image</option><option value="inpaint">Inpaint</option></select>`)}<div class="ng-actions"><label class="menu_button ng-file-button"><i class="fa-solid fa-upload"></i> Choose source image<input id="ng-source-file" type="file" accept="image/*"></label></div><div id="ng-source-card" class="ng-source-card"><span>No source image selected. You can also choose “Inpaint” or “Use as source” from any generated image.</span></div><div id="ng-mask-editor" class="ng-mask-editor" hidden><div class="ng-mask-toolbar"><button class="menu_button is-active" data-mask-tool="brush" type="button"><i class="fa-solid fa-paintbrush"></i> Brush</button><button class="menu_button" data-mask-tool="eraser" type="button"><i class="fa-solid fa-eraser"></i> Eraser</button><button id="ng-mask-clear" class="menu_button" type="button"><i class="fa-solid fa-trash"></i> Clear</button><label class="ng-brush-size">Size <input id="ng-brush-size" type="range" min="8" max="180" step="2" value="${s.brushSize}"></label></div><div class="ng-mask-stage"><img id="ng-mask-source" alt="Inpaint source"><canvas id="ng-mask-canvas"></canvas></div><small class="ng-help">Paint white over the area that should be regenerated. Use Eraser to remove mask strokes.</small></div>${range('ng-strength', 'Strength', s.strength)}${range('ng-noise', 'Noise', s.noise)}`)}
          ${studioSection('upscale', 'fa-up-right-and-down-left-from-center', 'Upscale / Enhance', `<p class="ng-muted">Select any generated image, then use 2× or 4K. The extension first tries a provider upscale route; if unavailable it falls back to a low-strength high-resolution img2img pass.</p><div id="ng-upscale-source" class="ng-source-card"><span>No source selected.</span></div><div class="ng-actions"><button id="ng-upscale-2x" class="menu_button" type="button"><i class="fa-solid fa-up-right-and-down-left-from-center"></i> Upscale 2×</button><button id="ng-upscale-4k" class="menu_button" type="button"><i class="fa-solid fa-display"></i> Enhance to 4K</button></div>`)}
          ${studioSection('parameters', 'fa-sliders', 'Image Parameters', `${sizePicker('ng-studio', s)}<div class="ng-grid ng-grid-2">${field('Steps', `<input id="ng-studio-steps" class="text_pole" type="number" min="1" max="100" value="${s.steps}">`)}${field('Guidance', `<input id="ng-studio-guidance" class="text_pole" type="number" min="0" max="30" step=".1" value="${s.guidance}">`)}${field('Sampler', `<select id="ng-studio-sampler" class="text_pole"><option value="k_euler_ancestral">Euler Ancestral</option><option value="k_dpmpp_2m">DPM++ 2M</option><option value="k_euler">Euler</option><option value="k_dpmpp_sde">DPM++ SDE</option></select>`)}${field('Scheduler', `<select id="ng-studio-scheduler" class="text_pole"><option value="native">Provider default</option><option value="karras">Karras</option><option value="exponential">Exponential</option></select>`)}${field('Seed', `<input id="ng-studio-seed" class="text_pole" type="number" value="${s.seed}">`)}${field('Images', `<input id="ng-studio-n" class="text_pole" type="number" min="1" max="4" value="${s.n}">`)}</div>`)}
          ${studioSection('debug', 'fa-bug', 'Request Debug', `<div class="ng-actions"><button id="ng-debug-clear" class="menu_button" type="button"><i class="fa-solid fa-trash"></i> Clear debug</button></div><pre id="ng-debug-output" class="ng-debug-output"></pre>`)}
        </div>
        <div id="ng-gallery-panel" hidden><div id="ng-gallery-grid" class="ng-gallery-grid"></div></div>
      </aside>
    </main>
    <footer class="ng-studio-footer"><div id="ng-gen-status" class="ng-generation-status"></div><button id="ng-generate" class="menu_button" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate</button></footer>
  </div>`;
}

function isMobileStudioEnvironment() {
  let contextMobile = false;
  try {
    const context = ctx();
    const value = context?.isMobile;
    contextMobile = typeof value === 'function' ? Boolean(value.call(context)) : Boolean(value);
  } catch {}
  const screenWidth = Math.min(
    Number(window.screen?.width) || Number.POSITIVE_INFINITY,
    Number(window.screen?.height) || Number.POSITIVE_INFINITY,
  );
  return contextMobile
    || window.innerWidth <= 760
    || screenWidth <= 760
    || Boolean(window.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches);
}

function recoverStaleStudioState() {
  if (!document.getElementById('ng-studio-overlay')) {
    document.body?.classList.remove('ng-studio-open');
  }
  document.querySelectorAll('[data-ng-studio-suspended="true"]').forEach(node => {
    delete node.dataset.ngStudioSuspended;
    node.inert = false;
    if (node.getAttribute('aria-hidden') === 'true') node.removeAttribute('aria-hidden');
  });
}

function scheduleStudioOpen(mode = 'free', focus = 'prompt') {
  const sequence = ++studioLaunchSequence;
  if (studioLaunchTimer) clearTimeout(studioLaunchTimer);
  const initialDrawer = document.getElementById('astra-send-form-extensions-drawer');
  const waitForAstra = Boolean(initialDrawer && initialDrawer.dataset.state !== 'closed');
  const deadline = Date.now() + 2400;

  const finishAfterPaint = () => {
    const nextFrame = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : callback => setTimeout(callback, 16);
    nextFrame(() => nextFrame(() => {
      if (sequence !== studioLaunchSequence) return;
      studioLaunchTimer = null;
      openStudio(mode, focus);
    }));
  };

  const checkRelease = () => {
    if (sequence !== studioLaunchSequence) return;
    const drawer = document.getElementById('astra-send-form-extensions-drawer');
    const host = document.getElementById('astra-send-form-extensions-menu-host');
    const menu = document.getElementById('extensionsMenu');
    const drawerOpen = Boolean(drawer && drawer.dataset.state !== 'closed');
    const menuStillPortaled = Boolean(host && menu && host.contains(menu));

    if (!waitForAstra || (!drawerOpen && !menuStillPortaled)) {
      finishAfterPaint();
      return;
    }
    if (Date.now() < deadline) {
      studioLaunchTimer = setTimeout(checkRelease, 50);
      return;
    }

    studioLaunchTimer = null;
    console.warn('[Novel Generation] AstraProjecta did not release its extensions drawer; Studio launch was cancelled to protect interaction.');
    toast('warning', 'AstraProjecta is still closing its menu. Close the menu and tap Novel Gen again.');
  };

  studioLaunchTimer = setTimeout(checkRelease, 0);
}

function openStudio(mode = 'free', focus = 'prompt') {
  closeStudio();
  let overlay = null;
  try {
    studio = newStudio(mode, focus);
    overlay = document.createElement('div');
    overlay.id = 'ng-studio-overlay';
    overlay.className = 'ng-studio-overlay';
    overlay.dataset.ngMobileLayout = isMobileStudioEnvironment() ? 'true' : 'false';
    overlay.dataset.ngMobilePane = 'controls';
    overlay.setAttribute('data-vaul-no-drag', '');
    overlay.setAttribute('data-astra-extension-surface', 'novel-generation');
    overlay.innerHTML = studioHtml();
    document.documentElement.appendChild(overlay);
    document.body?.classList.add('ng-studio-open');
    bindStudio();
    if (focus === 'gallery') switchTab('gallery');
    else {
      const target = overlay.querySelector(`[data-focus="${focus}"]`);
      if (target) {
        target.open = true;
        setTimeout(() => target.isConnected && target.scrollIntoView({ block: 'nearest' }), 30);
      }
    }
    escapeHandler = event => { if (event.key === 'Escape') closeStudio(); };
    document.addEventListener('keydown', escapeHandler);
  } catch (error) {
    overlay?.remove();
    document.body?.classList.remove('ng-studio-open');
    if (escapeHandler) document.removeEventListener('keydown', escapeHandler);
    escapeHandler = null;
    studio = null;
    console.error('[Novel Generation] Studio failed to open:', error);
    toast('error', 'Studio failed to open safely. Check the browser console for details.');
  }
}

function closeStudio() {
  document.getElementById('ng-studio-overlay')?.remove();
  document.body?.classList.remove('ng-studio-open');
  if (escapeHandler) document.removeEventListener('keydown', escapeHandler);
  escapeHandler = null;
}
function bindStudio() {
  document.getElementById('ng-close')?.addEventListener('click', closeStudio);
  document.querySelector('#ng-studio-overlay [data-mobile-pane="preview"]')?.addEventListener('click', () => {
    if (typeof ngV055SetMobilePane === 'function') ngV055SetMobilePane('preview');
  });
  document.querySelector('#ng-studio-overlay [data-mobile-pane="controls"][data-tab="generate"]')?.addEventListener('click', () => {
    switchTab('generate');
    if (typeof ngV055SetMobilePane === 'function') ngV055SetMobilePane('controls');
  });
  document.querySelector('#ng-studio-overlay [data-mobile-pane="controls"][data-tab="gallery"]')?.addEventListener('click', () => {
    switchTab('gallery');
    if (typeof ngV055SetMobilePane === 'function') ngV055SetMobilePane('controls');
  });
  const interactionSurface = document.getElementById('ng-studio-overlay');
  interactionSurface?.addEventListener('pointerdown', event => {
    event.stopPropagation();
    const target = event.target instanceof Element
      ? event.target.closest('textarea, input, select, [contenteditable="true"]')
      : null;
    if (target instanceof HTMLElement) {
      try { target.focus({ preventScroll: true }); } catch { target.focus(); }
    }
  });
  interactionSurface?.addEventListener('click', event => event.stopPropagation());
  interactionSurface?.addEventListener('touchstart', event => event.stopPropagation(), { passive: true });
  document.querySelectorAll('#ng-studio-overlay .ng-studio-tabs [data-tab]').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  document.getElementById('ng-prompt')?.addEventListener('input', event => { studio.prompt = event.currentTarget.value; });
  document.getElementById('ng-negative')?.addEventListener('input', event => { studio.negative = event.currentTarget.value; });
  document.getElementById('ng-edit-mode')?.addEventListener('change', event => {
    studio.editMode = event.currentTarget.value;
    refreshMaskEditor();
  });
  document.getElementById('ng-character-add')?.addEventListener('click', () => {
    studio.characters.push({ prompt: '', position: 'auto' });
    renderCharacters();
  });
  document.getElementById('ng-vibe-file')?.addEventListener('change', async event => {
    if (studio.precise.length) return toast('warning', 'Precise Reference is active. Remove it before using Vibe Transfer.');
    await addRefs(event.currentTarget.files, 'vibe');
    event.currentTarget.value = '';
  });
  document.getElementById('ng-precise-file')?.addEventListener('change', async event => {
    if (studio.vibes.length) return toast('warning', 'Vibe Transfer is active. Remove it before using Precise Reference.');
    await addRefs(event.currentTarget.files, 'precise');
    event.currentTarget.value = '';
  });
  document.getElementById('ng-vibe-normalize')?.addEventListener('click', normalizeVibes);
  document.getElementById('ng-source-file')?.addEventListener('change', async event => {
    const ref = await readRef(event.currentTarget.files?.[0]);
    if (ref) setStudioSource(ref);
    event.currentTarget.value = '';
  });

  [['ng-strength', 'strength'], ['ng-noise', 'noise']].forEach(([id, key]) => {
    const el = document.getElementById(id);
    el?.addEventListener('input', () => {
      studio[key] = +el.value;
      el.closest('.ng-range-row')?.querySelector('output')?.replaceChildren(document.createTextNode((+el.value).toFixed(2)));
    });
  });

  [['ng-studio-steps', 'steps'], ['ng-studio-guidance', 'guidance'], ['ng-studio-seed', 'seed'], ['ng-studio-n', 'n'], ['ng-studio-width', 'width'], ['ng-studio-height', 'height']].forEach(([id, key]) => {
    document.getElementById(id)?.addEventListener('input', event => {
      studio[key] = +event.currentTarget.value;
      if (key === 'width' || key === 'height') {
        studio.preset = 'custom';
        ngUpdateCanvasStatus('ng-studio', studio);
      }
    });
  });

  const sampler = document.getElementById('ng-studio-sampler');
  const scheduler = document.getElementById('ng-studio-scheduler');
  if (sampler) {
    sampler.value = studio.sampler;
    sampler.addEventListener('change', () => { studio.sampler = sampler.value; });
  }
  if (scheduler) {
    scheduler.value = studio.scheduler;
    scheduler.addEventListener('change', () => { studio.scheduler = scheduler.value; });
  }
  document.querySelectorAll('#ng-studio-overlay .ng-size-choice').forEach(btn => btn.addEventListener('click', () => setSize('studio', btn.dataset.ngSize)));
  document.getElementById('ng-generate')?.addEventListener('click', generateStudio);
  document.getElementById('ng-upscale-2x')?.addEventListener('click', () => runUpscale('2x'));
  document.getElementById('ng-upscale-4k')?.addEventListener('click', () => runUpscale('4k'));
  document.getElementById('ng-debug-clear')?.addEventListener('click', () => { debugLog.splice(0); renderDebug(); });
  bindMaskTools();
  renderCharacters();
  renderRefs('vibe');
  renderRefs('precise');
  renderGallery();
  renderDebug();
  refreshReferenceLocks();
  refreshMaskEditor();
}

function switchTab(tab) {
  document.querySelectorAll('#ng-studio-overlay [data-tab]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.tab === tab));
  const gen = document.getElementById('ng-generate-panel');
  const gal = document.getElementById('ng-gallery-panel');
  const button = document.getElementById('ng-generate');
  if (gen) gen.hidden = tab !== 'generate';
  if (gal) gal.hidden = tab !== 'gallery';
  if (button) button.hidden = tab !== 'generate';
  if (tab === 'gallery') renderGallery();
}

function dataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function readRef(file) {
  if (!file) return null;
  const url = await dataUrl(file);
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: file.name || 'image.png', url, base64: url.split(',')[1] || '' };
}

async function refFromSrc(src, name = 'generated.png') {
  const normalized = norm(src);
  if (!normalized) return null;
  if (normalized.startsWith('data:image/')) return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name, url: normalized, base64: normalized.split(',')[1] || '' };
  try {
    const response = await fetch(normalized);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const file = new File([blob], name, { type: blob.type || 'image/png' });
    return await readRef(file);
  } catch {
    return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name, url: normalized, base64: '' };
  }
}

async function addRefs(files, kind) {
  const list = kind === 'vibe' ? studio.vibes : studio.precise;
  for (const file of Array.from(files || [])) {
    const ref = await readRef(file);
    if (!ref) continue;
    if (kind === 'vibe') list.push({ ...ref, strength: 0.6, information: 1 });
    else list.push({ ...ref, type: 'character', strength: 1, fidelity: 1 });
  }
  if (kind === 'vibe' && studio.normalizeVibes) normalizeVibes(false);
  renderRefs(kind);
  refreshReferenceLocks();
}


/* ===== Runtime 05: reference-image controls ===== */
function normalizeVibes(showToast = true) {
  if (!studio?.vibes?.length) return;
  const total = studio.vibes.reduce((sum, ref) => sum + Math.max(0, Number(ref.strength) || 0), 0);
  if (total > 1) studio.vibes.forEach(ref => { ref.strength = (Number(ref.strength) || 0) / total; });
  renderRefs('vibe');
  if (showToast) toast('success', total > 1 ? 'Vibe strengths normalized to a total of 1.0.' : 'Vibe strengths are already at or below 1.0.');
}

function refreshReferenceLocks() {
  if (!studio) return;
  const vibeInput = document.getElementById('ng-vibe-file');
  const preciseInput = document.getElementById('ng-precise-file');
  if (vibeInput) vibeInput.disabled = studio.precise.length > 0;
  if (preciseInput) preciseInput.disabled = studio.vibes.length > 0;
  const vibeNote = document.getElementById('ng-vibe-lock');
  const preciseNote = document.getElementById('ng-precise-lock');
  if (vibeNote) vibeNote.textContent = studio.precise.length ? 'Disabled while Precise Reference is active.' : 'V4/V4.5 uses native reference_image_multiple arrays when the proxy accepts them.';
  if (preciseNote) preciseNote.textContent = studio.vibes.length ? 'Disabled while Vibe Transfer is active.' : 'V4.5 Director Reference uses Character / Style / Character & Style plus Strength and Fidelity.';
}

function renderRefs(kind) {
  const container = document.getElementById(kind === 'vibe' ? 'ng-vibe-list' : 'ng-precise-list');
  if (!container || !studio) return;
  const list = kind === 'vibe' ? studio.vibes : studio.precise;
  if (!list.length) {
    container.innerHTML = '<p class="ng-muted">No reference images added.</p>';
    refreshReferenceLocks();
    return;
  }
  container.innerHTML = list.map((ref, index) => `<article class="ng-reference-card"><img src="${attr(ref.url)}"><div class="ng-reference-controls"><div class="ng-reference-head"><strong>${esc(ref.name)}</strong><button class="menu_button ng-ref-delete" data-i="${index}" type="button"><i class="fa-solid fa-trash"></i></button></div>${kind === 'precise' ? field('Type', `<select class="text_pole ng-ref-type" data-i="${index}"><option value="character">Character</option><option value="style">Style</option><option value="character&style">Character + Style</option></select>`) : ''}${refRange(index, 'strength', 'Strength', ref.strength)}${kind === 'vibe' ? refRange(index, 'information', 'Information Extracted', ref.information) : refRange(index, 'fidelity', 'Fidelity', ref.fidelity)}</div></article>`).join('');
  container.querySelectorAll('.ng-ref-delete').forEach(btn => btn.addEventListener('click', () => {
    list.splice(+btn.dataset.i, 1);
    renderRefs(kind);
    refreshReferenceLocks();
  }));
  container.querySelectorAll('.ng-ref-type').forEach(select => {
    select.value = list[+select.dataset.i].type;
    select.addEventListener('change', () => { list[+select.dataset.i].type = select.value; });
  });
  container.querySelectorAll('[data-ref-key]').forEach(input => input.addEventListener('input', () => {
    list[+input.dataset.i][input.dataset.refKey] = +input.value;
    const output = input.closest('.ng-range-row')?.querySelector('output');
    if (output) output.textContent = (+input.value).toFixed(2);
  }));
  refreshReferenceLocks();
}

function refRange(index, key, label, value) {
  return `<label class="ng-range-row"><span>${label} <output>${Number(value).toFixed(2)}</output></span><input data-i="${index}" data-ref-key="${key}" type="range" min="0" max="1" step=".01" value="${value}"></label>`;
}

function renderCharacters() {
  const container = document.getElementById('ng-character-list');
  if (!container || !studio) return;
  if (!studio.characters.length) {
    container.innerHTML = '<p class="ng-muted">No separate character prompts yet.</p>';
    return;
  }
  container.innerHTML = studio.characters.map((character, index) => `<div class="ng-character-card"><div class="ng-reference-head"><strong>Character ${index + 1}</strong><button class="menu_button ng-char-delete" data-i="${index}" type="button"><i class="fa-solid fa-trash"></i></button></div>${field('Prompt', `<textarea class="text_pole ng-char-prompt" data-i="${index}" rows="3">${esc(character.prompt)}</textarea>`)}${field('Position', `<select class="text_pole ng-char-pos" data-i="${index}"><option value="auto">Auto</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select>`)}</div>`).join('');
  container.querySelectorAll('.ng-char-delete').forEach(btn => btn.addEventListener('click', () => { studio.characters.splice(+btn.dataset.i, 1); renderCharacters(); }));
  container.querySelectorAll('.ng-char-prompt').forEach(input => input.addEventListener('input', () => { studio.characters[+input.dataset.i].prompt = input.value; }));
  container.querySelectorAll('.ng-char-pos').forEach(select => {
    select.value = studio.characters[+select.dataset.i].position;
    select.addEventListener('change', () => { studio.characters[+select.dataset.i].position = select.value; });
  });
}

function setStudioSource(ref) {
  if (!studio || !ref) return;
  studio.source = ref;
  const sourceCard = document.getElementById('ng-source-card');
  const upscaleCard = document.getElementById('ng-upscale-source');
  const cardHtml = `<img src="${attr(ref.url)}"><span>${esc(ref.name || 'Selected source')}</span>`;
  if (sourceCard) sourceCard.innerHTML = cardHtml;
  if (upscaleCard) upscaleCard.innerHTML = cardHtml;
  refreshMaskEditor();
}

function refreshMaskEditor() {
  const editor = document.getElementById('ng-mask-editor');
  if (!editor || !studio) return;
  const active = studio.editMode === 'inpaint' && studio.source;
  editor.hidden = !active;
  if (!active) return;
  const img = document.getElementById('ng-mask-source');
  if (!img) return;
  img.onload = () => initializeMaskCanvas(img);
  if (img.src !== studio.source.url) img.src = studio.source.url;
  else if (img.complete) initializeMaskCanvas(img);
}

function initializeMaskCanvas(img) {
  const canvas = document.getElementById('ng-mask-canvas');
  if (!canvas || !img.naturalWidth || !img.naturalHeight) return;
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const context = canvas.getContext('2d');
  context.save();
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = '#000000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
  studio.mask = null;
}

function bindMaskTools() {
  const canvas = document.getElementById('ng-mask-canvas');
  if (!canvas || !studio) return;
  document.querySelectorAll('[data-mask-tool]').forEach(button => button.addEventListener('click', () => {
    studio.maskTool = button.dataset.maskTool;
    document.querySelectorAll('[data-mask-tool]').forEach(item => item.classList.toggle('is-active', item === button));
  }));
  document.getElementById('ng-mask-clear')?.addEventListener('click', () => {
    const context = canvas.getContext('2d');
    if (context) { context.save(); context.globalCompositeOperation = 'source-over'; context.fillStyle = '#000000'; context.fillRect(0, 0, canvas.width, canvas.height); context.restore(); }
    studio.mask = null;
  });
  document.getElementById('ng-brush-size')?.addEventListener('input', event => { studio.brushSize = +event.currentTarget.value || 48; });

  let drawing = false;
  let previous = null;
  const position = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
  };
  const draw = event => {
    if (!drawing) return;
    const next = position(event);
    const context = canvas.getContext('2d');
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = Math.max(2, studio.brushSize * (canvas.width / Math.max(1, canvas.getBoundingClientRect().width)));
    context.globalCompositeOperation = 'source-over';
    context.strokeStyle = studio.maskTool === 'eraser' ? '#000000' : '#ffffff';
    context.beginPath();
    context.moveTo(previous?.x ?? next.x, previous?.y ?? next.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    context.restore();
    previous = next;
    event.preventDefault();
  };
  canvas.addEventListener('pointerdown', event => {
    drawing = true;
    previous = position(event);
    canvas.setPointerCapture?.(event.pointerId);
    draw(event);
  });
  canvas.addEventListener('pointermove', draw);
  const stop = event => {
    if (!drawing) return;
    draw(event);
    drawing = false;
    previous = null;
    updateMaskFromCanvas();
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('pointerleave', event => { if (drawing && event.buttons === 0) stop(event); });
}

function updateMaskFromCanvas() {
  const canvas = document.getElementById('ng-mask-canvas');
  if (!canvas || !studio) return;
  try {
    const url = canvas.toDataURL('image/png');
    studio.mask = { id: `mask-${Date.now()}`, name: 'mask.png', url, base64: url.split(',')[1] || '' };
  } catch (error) {
    console.warn('[Novel Generation] Could not export mask', error);
  }
}


/* ===== Runtime 06: provider payload builders ===== */
function hasAdvancedReferences(state) {
  return Boolean(state.vibes?.length || state.precise?.length);
}

function imageValue(ref) {
  return ref?.base64 || ref?.url || '';
}

function nativeReferenceFields(state) {
  const fields = {};
  if (state.vibes?.length) {
    fields.reference_image_multiple = state.vibes.map(imageValue);
    fields.reference_strength_multiple = state.vibes.map(ref => Number(ref.strength));
    fields.reference_information_extracted_multiple = state.vibes.map(ref => Number(ref.information));
  }
  if (state.precise?.length) {
    fields.director_reference_images = state.precise.map(imageValue);
    fields.director_reference_descriptions = state.precise.map(ref => ({
      caption: {
        base_caption: ref.type || 'character',
        char_captions: [],
      },
      legacy_uc: false,
    }));
    fields.director_reference_strength_values = state.precise.map(ref => Number(ref.strength));
    // NovelAI's API uses the inverse of the UI Fidelity value here.
    fields.director_reference_secondary_strength_values = state.precise.map(ref => 1 - Number(ref.fidelity));
    fields.director_reference_information_extracted = state.precise.map(() => 1);
  }
  return fields;
}

function genericReferenceFields(state) {
  const fields = {};
  if (state.vibes?.length) {
    fields.vibe_transfer = state.vibes.map(ref => ({
      image: imageValue(ref),
      strength: Number(ref.strength),
      information_extracted: Number(ref.information),
    }));
  }
  if (state.precise?.length) {
    fields.precise_reference = state.precise.map(ref => ({
      image: imageValue(ref),
      type: ref.type || 'character',
      strength: Number(ref.strength),
      fidelity: Number(ref.fidelity),
    }));
  }
  return fields;
}

function strictPayload(state) {
  const s = settings();
  return {
    model: s.model,
    prompt: state.prompt.trim(),
    n: Math.max(1, Math.min(4, +state.n || 1)),
    size: ngImageSizeValue(s.model, state.width, state.height),
    response_format: s.responseFormat,
  };
}

function coreExtendedFields(state) {
  const fields = {
    negative_prompt: state.negative?.trim() || undefined,
    width: Math.round(state.width),
    height: Math.round(state.height),
    steps: Math.round(state.steps),
    guidance: Number(state.guidance),
    scale: Number(state.guidance),
    cfg_scale: Number(state.guidance),
    sampler: state.sampler,
    scheduler: state.scheduler,
    noise_schedule: state.scheduler === 'native' ? undefined : state.scheduler,
    seed: Number(state.seed),
  };
  if (state.characters?.some(item => item.prompt?.trim())) {
    fields.character_prompts = state.characters
      .filter(item => item.prompt?.trim())
      .map(item => ({ prompt: item.prompt.trim(), position: item.position || 'auto' }));
  }
  if (state.source) {
    fields.action = state.editMode === 'inpaint' ? 'infill' : 'img2img';
    fields.image = imageValue(state.source);
    fields.strength = Number(state.strength);
    fields.noise = Number(state.noise);
    fields.add_original_image = true;
  }
  if (state.editMode === 'inpaint' && state.mask) fields.mask = imageValue(state.mask);
  return cleanObject(fields);
}

function cleanObject(value) {
  if (Array.isArray(value)) return value.map(cleanObject);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null || item === '') continue;
    out[key] = cleanObject(item);
  }
  return out;
}

function naiAction(state) {
  return state.editMode === 'inpaint' && state.source ? 'infill' : state.source ? 'img2img' : 'generate';
}

function naiCharacterCaptions(state) {
  const centers = {
    left: { x: 0.25, y: 0.5 },
    center: { x: 0.5, y: 0.5 },
    right: { x: 0.75, y: 0.5 },
    auto: { x: 0.5, y: 0.5 },
  };
  return (state.characters || [])
    .filter(item => item.prompt?.trim())
    .map(item => ({
      char_caption: item.prompt.trim(),
      centers: [centers[item.position] || centers.auto],
    }));
}

function naiParameters(state) {
  const charCaptions = naiCharacterCaptions(state);
  const negative = state.negative?.trim() || '';
  const selectedModel = String(settings().model || '');
  const isV5 = /nai-diffusion-5(?:-|$)/i.test(selectedModel);
  const isV45 = /nai-diffusion-4-5(?:-|$)/i.test(selectedModel);
  const isV4 = /nai-diffusion-4(?:-|$)/i.test(selectedModel);
  const seed = Number(state.seed);
  const characterPrompts = (state.characters || [])
    .filter(item => item.prompt?.trim())
    .map(item => ({
      prompt: item.prompt.trim(),
      uc: '',
      center: naiCharacterCaptions({ characters: [item] })[0]?.centers?.[0] || { x: 0.5, y: 0.5 },
      enabled: true,
    }));
  const parameters = {
    // NovelAI V5 moved to parameter schema v4. V4/V4.5 remain on v3.
    params_version: isV5 ? 4 : 3,
    width: Math.round(state.width),
    height: Math.round(state.height),
    scale: Number(state.guidance),
    sampler: state.sampler,
    steps: Math.round(state.steps),
    seed,
    extra_noise_seed: seed >= 0 ? seed : undefined,
    n_samples: Math.max(1, Math.min(4, +state.n || 1)),
    noise_schedule: state.scheduler === 'native' ? 'karras' : state.scheduler,
    sm: false,
    sm_dyn: false,
    dynamic_thresholding: true,
    controlnet_strength: 1,
    legacy: false,
    legacy_v3_extend: false,
    add_original_image: true,
    cfg_rescale: 0,
    prefer_brownian: false,
    deliberate_euler_ancestral_bug: state.sampler === 'k_euler_ancestral' ? false : undefined,
    skip_cfg_above_sigma: isV45 ? 58 : (isV4 && !isV5 ? 19 : undefined),
    ucPreset: isV5 ? undefined : 0,
    qualityToggle: isV5 ? undefined : true,
    ucPresetId: isV5 ? 0 : undefined,
    qualityPresetId: isV5 ? 0 : undefined,
    autoSmea: isV5 ? false : undefined,
    straight_alpha: isV5 ? false : undefined,
    use_coords: charCaptions.length > 0,
    normalize_reference_strength_multiple: true,
    inpaintImg2ImgStrength: 1,
    legacy_uc: false,
    uc: negative,
    negative_prompt: negative,
    characterPrompts: isV5 && characterPrompts.length ? characterPrompts : undefined,
    v4_prompt: {
      caption: {
        base_caption: state.prompt.trim(),
        char_captions: charCaptions,
      },
      use_coords: charCaptions.length > 0,
      use_order: true,
      legacy_uc: false,
    },
    v4_negative_prompt: {
      caption: {
        base_caption: negative,
        char_captions: charCaptions.map(item => ({
          char_caption: '',
          centers: item.centers,
        })),
      },
      use_coords: false,
      use_order: false,
      legacy_uc: false,
    },
    ...nativeReferenceFields(state),
  };

  if (state.source) {
    parameters.image = imageValue(state.source);
    parameters.strength = Number(state.strength);
    parameters.add_original_image = true;
    if (naiAction(state) === 'img2img') {
      parameters.noise = Number(state.noise);
      parameters.extra_noise_seed = Number(state.seed);
    }
  }
  if (naiAction(state) === 'infill' && state.mask) parameters.mask = imageValue(state.mask);
  return cleanObject(parameters);
}

function requestCandidates(state) {
  const s = settings();
  const strict = strictPayload(state);
  if (s.compatibility === 'strict') {
    if (hasAdvancedReferences(state) || state.source) {
      throw new Error('Strict OpenAI payload mode cannot carry Vibe, Precise Reference, img2img or inpaint fields. Switch Payload mode to Auto / NovelAI-aware.');
    }
    return [{ name: 'strict-openai', payload: strict }];
  }

  const action = naiAction(state);
  const parameters = naiParameters(state);
  const generic = cleanObject({
    ...strict,
    ...coreExtendedFields(state),
    ...genericReferenceFields(state),
  });

  // Most OpenAI-compatible NovelAI proxies still require the OpenAI fields at
  // the top level, but pass an embedded NovelAI request through in `parameters`.
  // This is now the first advanced schema instead of the old flat Director
  // fields, which many wrappers silently ignored while still returning HTTP 200.
  const openAiWithNai = cleanObject({
    ...strict,
    input: state.prompt.trim(),
    action,
    parameters,
  });

  // Exact NovelAI V4.5 request envelope. Some reverse proxies expose the NAI
  // backend through /v1/images/generations without requiring OpenAI-only fields.
  const nativeEnvelope = cleanObject({
    model: s.model,
    input: state.prompt.trim(),
    action,
    parameters,
  });

  if (hasAdvancedReferences(state) || state.source) {
    return [
      { name: 'openai-with-nai-parameters', payload: openAiWithNai },
      { name: 'nai-native-envelope', payload: nativeEnvelope },
      { name: 'proxy-generic-aliases', payload: generic },
    ];
  }

  // Keep the proven simple path first for ordinary text-to-image generation.
  const legacyFlat = cleanObject({ ...strict, ...coreExtendedFields(state) });
  return [
    { name: 'openai-extended-flat', payload: legacyFlat },
    { name: 'openai-with-nai-parameters', payload: openAiWithNai },
    { name: 'strict-openai-fallback', payload: strict },
  ];
}

function routeCandidates() {
  const s = settings();
  const mode = s.routeMode;
  if (mode === 'images') return ['images'];
  if (mode === 'chat') return ['chat'];
  // RVL's normal NAI V5/V4.5 models use the compact chat-completions schema.
  // Only the model explicitly marked [备用] uses images/generations.
  if (ngUsesCompactChatImageRoute(s.model)) return ['chat'];
  if (ngUsesBackupImagesRoute(s.model)) return ['images'];
  return ['images', 'chat'];
}

function ngAspectRatioLabel(width, height) {
  const divisor = (left, right) => {
    let a = Math.abs(Math.round(left));
    let b = Math.abs(Math.round(right));
    while (b) [a, b] = [b, a % b];
    return a || 1;
  };
  const ratioDivisor = divisor(width, height);
  const exact = width / height;
  const common = [
    ['1:1', 1], ['2:3', 2 / 3], ['3:2', 3 / 2], ['3:4', 3 / 4], ['4:3', 4 / 3],
    ['9:16', 9 / 16], ['16:9', 16 / 9], ['4:5', 4 / 5], ['5:4', 5 / 4],
  ];
  const closest = common.reduce((best, item) => Math.abs(item[1] - exact) < Math.abs(best[1] - exact) ? item : best);
  return Math.abs(closest[1] - exact) / exact <= 0.04
    ? closest[0]
    : `${width / ratioDivisor}:${height / ratioDivisor}`;
}

function chatPayloadFrom(payload, state) {
  const canvas = ngResolveCanvasSize(state);
  const model = payload.model || settings().model;
  const imageConfig = {
    size: ngImageSizeValue(model, canvas.width, canvas.height, 'chat'),
    aspect_ratio: ngAspectRatioLabel(canvas.width, canvas.height),
    width: canvas.width,
    height: canvas.height,
  };
  if (ngUsesCompactChatImageRoute(model)) {
    const negative = state.negative?.trim();
    const content = negative
      ? `${state.prompt.trim()}\n\nNegative prompt: ${negative}`
      : state.prompt.trim();
    return cleanObject({
      model,
      messages: [{ role: 'user', content }],
      max_tokens: 16,
      size: imageConfig.size,
      width: imageConfig.width,
      height: imageConfig.height,
      seed: ngRvlChatSeed(state),
    });
  }
  return {
    model,
    messages: [{ role: 'user', content: state.prompt.trim() }],
    modalities: ['text', 'image'],
    // Chat-completion image wrappers commonly read canvas controls here rather
    // than from a provider-specific nested envelope. These are the same values,
    // never reversed: Portrait remains 832 by 1216 at every layer.
    image_config: imageConfig,
    image_generation: cleanObject({
      ...payload,
      size: imageConfig.size,
      width: imageConfig.width,
      height: imageConfig.height,
      aspect_ratio: imageConfig.aspect_ratio,
      image_config: imageConfig,
      parameters: payload.parameters
        ? { ...payload.parameters, width: imageConfig.width, height: imageConfig.height }
        : undefined,
    }),
  };
}

function debugAttempt(entry) {
  debugLog.unshift({ time: new Date().toISOString(), ...entry });
  debugLog.splice(40);
  renderDebug();
}

function safePayloadForDebug(payload) {
  const replacer = (_key, value) => typeof value === 'string' && value.length > 500
    ? `${value.slice(0, 80)}…[${value.length} chars]`
    : value;
  return JSON.parse(JSON.stringify(payload, replacer));
}

function renderDebug() {
  const output = document.getElementById('ng-debug-output');
  if (!output) return;
  output.textContent = debugLog.length ? JSON.stringify(debugLog, null, 2) : 'No requests yet.';
}

function advancedReferenceWasIgnored(state, data) {
  if (!hasAdvancedReferences(state)) return false;
  const imageTokens = data?.usage?.input_tokens_details?.image_tokens;
  // This proxy reports image_tokens explicitly. A zero means it parsed no
  // image input at all. The previous broken flat Precise payload produced
  // exactly this signature while still returning a normal generated image.
  return imageTokens === 0;
}

async function postGeneration(route, candidate, state, signal) {
  const path = route === 'chat' ? '/v1/chat/completions' : '/v1/images/generations';
  const body = route === 'chat' ? chatPayloadFrom(candidate.payload, state) : candidate.payload;
  const url = endpoint(path);
  const started = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal,
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  const elapsed = Math.round(performance.now() - started);
  debugAttempt({
    route,
    schema: candidate.name,
    status: response.status,
    ms: elapsed,
    payload: safePayloadForDebug(body),
    response: safePayloadForDebug(data),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`HTTP ${response.status}: ${raw.slice(0, 700) || response.statusText}`), { status: response.status });
  }
  const images = extractImages(data);
  if (!images.length) {
    throw Object.assign(new Error('Provider returned success but no image URL/base64 was found in the response.'), { status: 200 });
  }
  if (advancedReferenceWasIgnored(state, data)) {
    throw Object.assign(new Error(`Provider returned an image but reported image_tokens=0, so ${state.precise?.length ? 'Precise Reference' : 'Vibe Transfer'} was not consumed by this schema.`), { status: 200, ignoredReference: true });
  }
  return { images, data, schema: candidate.name, route };
}

async function generateState(state, label = 'Generating…') {
  ngRvlRequestSeeds.delete(state);
  const s = settings();
  if (!base()) throw new Error('Set Base URL in the Novel Generation drawer first.');
  if (!apiKey) throw new Error('Enter and test the API key first.');
  if (!s.model) throw new Error('Select a model first.');
  if (!state.prompt?.trim()) throw new Error('Enter a prompt first.');
  if (state.vibes?.length && state.precise?.length) {
    throw new Error('NovelAI V4.5 does not allow Vibe Transfer and Precise Reference at the same time. Remove one reference type.');
  }
  if (state.precise?.length && !/4[-_. ]?5/i.test(String(s.model))) {
    throw new Error('Precise Reference requires a NovelAI V4.5 model.');
  }
  if (state.editMode === 'inpaint' && state.source && !state.mask) updateMaskFromCanvas();
  if (state.editMode === 'inpaint' && state.source && !state.mask) throw new Error('Paint an inpaint mask before generating.');

  const candidates = requestCandidates(state);
  const routes = routeCandidates();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, s.timeoutMs));
  const failures = [];
  try {
    for (const route of routes) {
      if (route === 'chat' && (hasAdvancedReferences(state) || state.source)) continue;
      for (const candidate of candidates) {
        try {
          return await postGeneration(route, candidate, state, controller.signal);
        } catch (error) {
          failures.push(`${route}/${candidate.name}: ${error.message}`);
          if (error.name === 'AbortError') throw error;
          if (error.status === 401 || error.status === 403) throw error;
          if (error.status === 200 || error.ignoredReference) continue;
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (hasAdvancedReferences(state)) {
    throw new Error(`The proxy did not confirm that the reference image was consumed. Open Request Debug and send the newest attempts. Last error: ${failures.at(-1) || 'unknown'}`);
  }
  throw new Error(failures.at(-1) || label);
}


/* ===== Runtime 07: provider requests and image responses ===== */
function ngImageCandidatesFromText(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const out = [];

  // Chat-completion image proxies commonly put the complete image in the
  // assistant's string content instead of OpenAI's `data[].b64_json` shape.
  // Extract embedded data URLs first so Markdown wrappers and surrounding
  // explanatory text cannot make the value fail validation.
  const dataUrls = text.match(/data:image\/(?:png|jpe?g|webp|gif|avif);base64,[a-z0-9+/=\r\n]+/gi) || [];
  out.push(...dataUrls.map(item => item.replace(/\s+/g, '')));

  if (!out.length && /^(?:https?:\/\/|blob:|\/)/i.test(text)) out.push(norm(text));
  if (!out.length && text.length > 200 && /^[a-z0-9+/=\s]+$/i.test(text)) {
    out.push(`data:image/png;base64,${text.replace(/\s+/g, '')}`);
  }
  return out;
}

function extractImages(data) {
  const out = [];
  const addText = value => out.push(...ngImageCandidatesFromText(value));
  const addItem = item => {
    if (typeof item === 'string') return addText(item);
    if (!item || typeof item !== 'object') return;
    if (item.b64_json) addText(`data:image/png;base64,${item.b64_json}`);
    if (item.base64) addText(item.base64);
    if (item.url) addText(item.url);
    if (item.image_url?.url) addText(item.image_url.url);
    if (typeof item.image_url === 'string') addText(item.image_url);
    if (item.source?.data) addText(`data:${item.source.media_type || 'image/png'};base64,${item.source.data}`);
  };
  const items = Array.isArray(data?.data) ? data.data : Array.isArray(data?.images) ? data.images : [];
  items.forEach(addItem);
  addItem(data);

  // Support every choice rather than assuming only choices[0]. Providers use
  // both a string content data URL and multipart image content in this route.
  for (const choice of Array.isArray(data?.choices) ? data.choices : []) {
    const message = choice?.message || choice?.delta || {};
    const content = message.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part === 'string') addText(part);
        else {
          addItem(part);
          if (typeof part?.text === 'string') addText(part.text);
        }
      }
    } else if (typeof content === 'string') {
      addText(content);
    }
    if (Array.isArray(message.images)) message.images.forEach(addItem);
    if (Array.isArray(choice?.images)) choice.images.forEach(addItem);
  }

  // Also accept the OpenAI Responses API content layout used by some wrapper
  // implementations even when the request itself used Chat Completions.
  for (const output of Array.isArray(data?.output) ? data.output : []) {
    addItem(output);
    for (const part of Array.isArray(output?.content) ? output.content : []) {
      addItem(part);
      if (typeof part?.text === 'string') addText(part.text);
    }
  }
  return [...new Set(out.filter(Boolean))];
}

function norm(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^(data:image\/|https?:\/\/|blob:|\/)/i.test(text)) return text;
  return text.length > 200 ? `data:image/png;base64,${text.replace(/\s+/g, '')}` : text;
}

function rememberImages(images, state, extra = {}) {
  if (!settings().roleplay.gallery) return;
  images.forEach(src => gallery.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    src,
    prompt: state.prompt,
    negative: state.negative,
    model: settings().model,
    width: state.width,
    height: state.height,
    seed: state.seed,
    createdAt: new Date().toISOString(),
    ...extra,
  }));
  ngV068TrimGallery(settings().roleplay.galleryLimit);
  ngV068UpdateGalleryCount();
}

async function generateStudio() {
  const button = document.getElementById('ng-generate');
  const out = document.getElementById('ng-gen-status');
  button?.setAttribute('disabled', 'disabled');
  if (out) out.textContent = 'Generating…';
  try {
    const result = await generateState(studio);
    studio.generated = result.images;
    showImages(result.images);
    rememberImages(result.images, studio, { schema: result.schema, route: result.route });
    if (out) out.textContent = `Generated ${result.images.length} image${result.images.length === 1 ? '' : 's'} using ${result.schema}.`;
  } catch (error) {
    if (out) out.textContent = `Generation failed: ${error.message}`;
    toast('error', error.message);
  } finally {
    button?.removeAttribute('disabled');
  }
}

async function quickGenerate(mode, manualPrompt = '') {
  const state = newStudio(mode, 'prompt');
  if (manualPrompt) state.prompt = manualPrompt;
  state.n = settings().image.n;
  toast('info', `Generating ${mode === 'last' ? 'the current scene' : mode}…`);
  try {
    const result = await generateState(state);
    rememberImages(result.images, state, { schema: result.schema, route: result.route, quick: true });
    if (settings().roleplay.autoInsert) await insertImagesIntoChat(result.images, state.prompt);
    toast('success', settings().roleplay.autoInsert ? `Generated ${result.images.length} image${result.images.length === 1 ? '' : 's'} and inserted into chat.` : `Generated ${result.images.length} image${result.images.length === 1 ? '' : 's'}.`);
  } catch (error) {
    toast('error', error.message);
  }
}

async function uploadDataImage(src) {
  if (!src.startsWith('data:image/')) return src;
  const c = ctx();
  const [, meta = '', data = ''] = src.match(/^data:([^;]+);base64,(.*)$/) || [];
  if (!data) return src;
  const extension = /jpeg/i.test(meta) ? 'jpg' : /webp/i.test(meta) ? 'webp' : 'png';
  const response = await fetch('/api/files/upload', {
    method: 'POST',
    headers: c.getRequestHeaders?.() || { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `novel-generation-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`, data }),
  });
  if (!response.ok) throw new Error(`Could not save generated image to SillyTavern media storage: HTTP ${response.status}`);
  const body = await response.json();
  return body.path || body.url || src;
}

function findChatTarget(target) {
  const chat = ctx().chat || [];
  if (!chat.length) return -1;
  if (target === 'latest') return chat.length - 1;
  const wantUser = target === 'user';
  for (let index = chat.length - 1; index >= 0; index--) {
    const message = chat[index];
    if (!message || message.is_system) continue;
    if (Boolean(message.is_user) === wantUser) return index;
  }
  return chat.length - 1;
}

async function insertImagesIntoChat(images, promptText = '') {
  const c = ctx();
  const messageId = findChatTarget(settings().autoInsertTarget);
  if (messageId < 0) throw new Error('There is no roleplay message to attach the generated image to yet.');
  const message = c.chat[messageId];
  message.extra ??= {};
  if (!Array.isArray(message.extra.media)) message.extra.media = [];
  for (let index = 0; index < images.length; index++) {
    const url = await uploadDataImage(images[index]);
    message.extra.media.push({ url, type: 'image', title: `Novel Generation${images.length > 1 ? ` ${index + 1}` : ''}`, source: 'generation', prompt: promptText });
  }
  message.extra.media_index = message.extra.media.length - 1;
  message.extra.inline_image = true;
  await c.saveChat?.();
  try { c.updateMessageBlock?.(messageId, message); } catch (error) { console.debug('[Novel Generation] updateMessageBlock fallback', error); }
  try {
    const block = globalThis.$?.(`.mes[mesid="${messageId}"]`);
    if (block?.length) c.appendMediaToMessage?.(message, block);
  } catch (error) {
    console.debug('[Novel Generation] appendMediaToMessage fallback', error);
  }
  c.scrollChatToBottom?.();
}

function generatedActions(src, index) {
  return `<div class="ng-generated-actions"><a class="menu_button" href="${attr(src)}" download="novel-generation-${Date.now()}-${index + 1}.png"><i class="fa-solid fa-download"></i> Save</a><button class="menu_button ng-use-source" data-src-index="${index}" type="button"><i class="fa-solid fa-image"></i> Use as source</button><button class="menu_button ng-use-inpaint" data-src-index="${index}" type="button"><i class="fa-solid fa-paintbrush"></i> Inpaint</button><button class="menu_button ng-use-vibe" data-src-index="${index}" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Vibe</button><button class="menu_button ng-use-precise" data-src-index="${index}" type="button"><i class="fa-solid fa-id-card-clip"></i> Precise</button></div>`;
}

function showImages(images) {
  const preview = document.getElementById('ng-preview');
  if (!preview) return;
  studio.generated = images;
  preview.innerHTML = `<div class="ng-generated-grid">${images.map((src, index) => `<figure class="ng-generated-card"><img src="${attr(src)}"><figcaption>${generatedActions(src, index)}</figcaption></figure>`).join('')}</div>`;
  bindGeneratedActions(preview, images);
}

function bindGeneratedActions(root, images) {
  root.querySelectorAll('.ng-use-source').forEach(button => button.addEventListener('click', async () => {
    const ref = await refFromSrc(images[+button.dataset.srcIndex], 'generated-source.png');
    if (ref) setStudioSource(ref);
    openStudioSection('edit');
  }));
  root.querySelectorAll('.ng-use-inpaint').forEach(button => button.addEventListener('click', async () => {
    const ref = await refFromSrc(images[+button.dataset.srcIndex], 'generated-inpaint.png');
    if (!ref) return;
    setStudioSource(ref);
    studio.editMode = 'inpaint';
    const select = document.getElementById('ng-edit-mode');
    if (select) select.value = 'inpaint';
    openStudioSection('edit');
    refreshMaskEditor();
  }));
  root.querySelectorAll('.ng-use-vibe').forEach(button => button.addEventListener('click', async () => {
    if (studio.precise.length) return toast('warning', 'Remove Precise Reference before using Vibe Transfer.');
    const ref = await refFromSrc(images[+button.dataset.srcIndex], 'generated-vibe.png');
    if (!ref) return;
    studio.vibes.push({ ...ref, strength: 0.6, information: 1 });
    normalizeVibes(false);
    renderRefs('vibe');
    openStudioSection('vibe');
  }));
  root.querySelectorAll('.ng-use-precise').forEach(button => button.addEventListener('click', async () => {
    if (studio.vibes.length) return toast('warning', 'Remove Vibe Transfer before using Precise Reference.');
    const ref = await refFromSrc(images[+button.dataset.srcIndex], 'generated-precise.png');
    if (!ref) return;
    studio.precise.push({ ...ref, type: 'character', strength: 1, fidelity: 1 });
    renderRefs('precise');
    openStudioSection('precise');
  }));
}


/* ===== Runtime 08: provider capability discovery ===== */
// Novel Generation v0.3.1: provider capability discovery and connection UI.
const NG_V031_RELEASE = VERSION;
const ngProviderCaps = {
  checked: false,
  wrapper: 'unknown',
  nativeGenerate: 'unknown',
  nativeGenerateUrl: '',
  encodeVibe: 'unknown',
  encodeVibeUrl: '',
  checkedAt: '',
};

function ngCapabilityLabel(value) {
  if (value === 'direct') return 'Direct NovelAI API';
  if (value === 'supported') return 'Supported';
  if (value === 'blocked') return 'Route found, access blocked';
  if (value === 'missing') return 'Not exposed';
  if (value === 'testing') return 'Testing…';
  return 'Unknown';
}

function ngRenderCapabilities() {
  const statusNode = document.getElementById('ng-status');
  if (!statusNode) return false;
  let box = document.getElementById('ng-capabilities');
  if (!box) {
    box = document.createElement('div');
    box.id = 'ng-capabilities';
    box.className = 'ng-status';
    statusNode.insertAdjacentElement('afterend', box);
  }
  box.innerHTML = `<strong>Provider capabilities</strong><br>`
    + `Provider: ${esc(ngCapabilityLabel(ngProviderCaps.wrapper))}<br>`
    + `NovelAI native generate: ${esc(ngCapabilityLabel(ngProviderCaps.nativeGenerate))}<br>`
    + `V4/V4.5 vibe encoder: ${esc(ngCapabilityLabel(ngProviderCaps.encodeVibe))}`
    + (ngProviderCaps.checkedAt ? `<br><small>Checked ${esc(new Date(ngProviderCaps.checkedAt).toLocaleTimeString())}</small>` : '');
  box.classList.toggle('is-ok', (ngProviderCaps.wrapper === 'supported' || ngProviderCaps.wrapper === 'direct') && (ngProviderCaps.nativeGenerate === 'supported' || ngProviderCaps.encodeVibe === 'supported'));
  return true;
}

function ngInstallV031Ui() {
  document.querySelectorAll('#ng-settings .ng-version').forEach(node => { node.textContent = `v${NG_V031_RELEASE}`; });
  ngRenderCapabilities();
}

let ngV031UiAttempts = 0;
const ngV031UiTimer = setInterval(() => {
  ngV031UiAttempts += 1;
  ngInstallV031Ui();
  if (document.getElementById('ng-settings') || ngV031UiAttempts >= 40) clearInterval(ngV031UiTimer);
}, 250);

function ngProviderPathCandidates(path) {
  const current = base();
  if (!current) return [];
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const trimmed = current.replace(/\/+$/, '');
  const root = trimmed.replace(/\/v1$/i, '');
  const candidates = [
    `${root}${normalizedPath}`,
    `${trimmed}${normalizedPath}`,
  ];
  if (!/\/v1$/i.test(trimmed)) candidates.push(`${trimmed}/v1${normalizedPath}`);
  return [...new Set(candidates)];
}

async function ngProbeAdvancedEndpoint(path) {
  let sawNetworkFailure = false;
  for (const url of ngProviderPathCandidates(path)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: headers(),
        body: '{}',
        signal: controller.signal,
      });
      response.body?.cancel?.().catch?.(() => {});
      const statusCode = response.status;
      if (statusCode === 404) continue;
      if (statusCode === 401 || statusCode === 403) return { state: 'blocked', url, status: statusCode };
      if ([200, 400, 405, 415, 422].includes(statusCode)) return { state: 'supported', url, status: statusCode };
      if (statusCode >= 500) continue;
      return { state: 'supported', url, status: statusCode };
    } catch (error) {
      sawNetworkFailure = true;
      if (error?.name === 'AbortError') continue;
    } finally {
      clearTimeout(timer);
    }
  }
  return { state: sawNetworkFailure ? 'unknown' : 'missing', url: '', status: 0 };
}

async function ngProbeAdvancedCapabilities() {
  ngProviderCaps.nativeGenerate = 'testing';
  ngProviderCaps.encodeVibe = 'testing';
  ngRenderCapabilities();
  const [nativeGenerate, encodeVibe] = await Promise.all([
    ngProbeAdvancedEndpoint('/ai/generate-image'),
    ngProbeAdvancedEndpoint('/ai/encode-vibe'),
  ]);
  ngProviderCaps.nativeGenerate = nativeGenerate.state;
  ngProviderCaps.nativeGenerateUrl = nativeGenerate.url;
  ngProviderCaps.encodeVibe = encodeVibe.state;
  ngProviderCaps.encodeVibeUrl = encodeVibe.url;
  ngProviderCaps.checked = true;
  ngProviderCaps.checkedAt = new Date().toISOString();
  ngRenderCapabilities();
  debugAttempt({
    route: 'capability-probe',
    schema: 'provider-capabilities',
    status: 0,
    response: {
      native_generate: nativeGenerate,
      encode_vibe: encodeVibe,
    },
  });
  return ngProviderCaps;
}

// Overrides the v0.3 connection test before the settings UI is mounted.
async function connectAndLoadModels() {
  const s = settings();
  if (!base()) return toast('warning', 'Enter a Base URL first.');
  if (!apiKey) return toast('warning', 'Enter an API key first.');
  const button = document.getElementById('ng-connect');
  button?.setAttribute('disabled', 'disabled');
  status('Testing connection and loading models…', 'testing');
  ngProviderCaps.wrapper = 'testing';
  ngProviderCaps.nativeGenerate = 'unknown';
  ngProviderCaps.encodeVibe = 'unknown';
  ngRenderCapabilities();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, s.timeoutMs));
  try {
    if (isDirectNovelAI()) {
      models = [...NAI_DIRECT_MODELS];
      const select = document.getElementById('ng-model');
      if (select) {
        select.innerHTML = models.map(model => `<option value="${attr(model)}">${esc(model)}</option>`).join('');
        const preferred = models.includes(s.model) ? s.model : NAI_DIRECT_MODELS[0];
        s.model = preferred;
        select.value = preferred;
        select.disabled = false;
      }
      ngProviderCaps.wrapper = 'direct';
      status('Checking the official NovelAI native routes…', 'testing');
      ngRenderCapabilities();
      await ngProbeAdvancedCapabilities();
      if (ngProviderCaps.nativeGenerate !== 'supported' || !ngProviderCaps.nativeGenerateUrl) {
        throw new Error('The official NovelAI image route was not confirmed. Check the API key, Base URL, or browser CORS access.');
      }
      save();
      status(ngProviderCaps.encodeVibe === 'supported'
        ? 'Connected directly to NovelAI. Native generation and Vibe Transfer are available.'
        : 'Connected directly to NovelAI. Native generation is available; Vibe Transfer encoder was not confirmed.', 'ok');
      toast('success', ngProviderCaps.encodeVibe === 'supported'
        ? 'Direct NovelAI connected with advanced image features.'
        : 'Direct NovelAI connected. Vibe Transfer is unavailable on this endpoint.');
      return;
    }

    const response = await fetch(endpoint('/v1/models'), { headers: headers(), signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await errText(response)}`);
    models = modelIds(await response.json());
    if (!models.length) throw new Error('Connected, but /v1/models returned no selectable model list.');
    const select = document.getElementById('ng-model');
    select.innerHTML = models.map(model => `<option value="${attr(model)}">${esc(model)}</option>`).join('');
    const preferred = models.includes(s.model) ? s.model : models.find(model => /nai.*4.?5.*full/i.test(model)) || models[0];
    s.model = preferred;
    select.value = preferred;
    select.disabled = false;
    save();
    ngProviderCaps.wrapper = 'supported';
    status(`Connected. ${models.length} model${models.length === 1 ? '' : 's'} available. Checking NovelAI advanced routes…`, 'testing');
    ngRenderCapabilities();
    await ngProbeAdvancedCapabilities();
    const advanced = ngProviderCaps.nativeGenerate === 'supported' || ngProviderCaps.encodeVibe === 'supported';
    status(advanced
      ? `Connected. ${models.length} model${models.length === 1 ? '' : 's'} available. Advanced NovelAI route(s) detected.`
      : `Connected. ${models.length} model${models.length === 1 ? '' : 's'} available. Advanced native routes were not confirmed.`, 'ok');
    toast('success', advanced ? 'Connected. Advanced NovelAI capability detected.' : 'Connected. Basic image generation is available.');
  } catch (error) {
    ngProviderCaps.wrapper = 'unknown';
    status(`Connection failed: ${error.message}`, 'error');
    ngRenderCapabilities();
    toast('error', `Connection failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
    button?.removeAttribute('disabled');
  }
}


/* ===== Runtime 09: native NovelAI advanced routing ===== */
// Novel Generation v0.3.1: native NovelAI advanced routing.
// Loaded before v030-08.js so these function declarations replace the v0.3
// compatibility shims before the UI binds its handlers.

function ngCanonicalNativeModel(model, action = 'generate') {
  const raw = String(model || 'nai-diffusion-4-5-full');
  const matched = raw.match(/nai-diffusion-[a-z0-9-]+/i)?.[0] || raw.replace(/^\[[^\]]+\]/, '');
  if (action === 'infill' && !/-inpainting$/i.test(matched)) return `${matched}-inpainting`;
  return matched;
}

function ngNativeReferenceFields(state) {
  const fields = {};
  if (state.vibes?.length) {
    fields.reference_image_multiple = state.vibes.map(ref => ref.encodedVibe || imageValue(ref));
    fields.reference_strength_multiple = state.vibes.map(ref => Number(ref.strength));
    fields.reference_information_extracted_multiple = state.vibes.map(ref => Number(ref.information));
  }
  if (state.precise?.length) {
    fields.director_reference_images = state.precise.map(imageValue);
    fields.director_reference_descriptions = state.precise.map(ref => ({
      caption: { base_caption: ref.type || 'character', char_captions: [] },
      legacy_uc: false,
    }));
    fields.director_reference_strength_values = state.precise.map(ref => Number(ref.strength));
    fields.director_reference_secondary_strength_values = state.precise.map(ref => Math.max(0, Math.min(1, 1 - Number(ref.fidelity))));
    fields.director_reference_information_extracted = state.precise.map(() => 1);
  }
  return fields;
}

// Override the older helper so all existing parameter builders automatically
// use encoded V4 vibe vectors when the provider exposes /ai/encode-vibe.
function nativeReferenceFields(state) {
  return ngNativeReferenceFields(state);
}

function ngBuildNativeParameters(state) {
  const params = naiParameters(state);
  Object.assign(params, ngNativeReferenceFields(state));
  return cleanObject(params);
}

function ngBuildNativeEnvelope(state) {
  const action = naiAction(state);
  const model = ngCanonicalNativeModel(settings().model, action);
  return cleanObject({
    input: state.prompt.trim(),
    model,
    action,
    parameters: ngBuildNativeParameters(state),
    use_new_shared_trial: /nai-diffusion-5(?:-|$)/i.test(model) ? true : undefined,
  });
}

function ngBuildOpenAiWithNativeParameters(state) {
  const native = ngBuildNativeEnvelope(state);
  return cleanObject({
    ...strictPayload(state),
    input: native.input,
    action: native.action,
    parameters: native.parameters,
    use_new_shared_trial: native.use_new_shared_trial,
  });
}

// The pure native envelope is no longer sent through /v1/images/generations.
// The user's proxy explicitly rejects that shape because its wrapper requires a
// top-level `prompt`. Native envelopes are now reserved for a discovered
// /ai/generate-image route.
function requestCandidates(state) {
  const s = settings();
  const strict = strictPayload(state);
  if (s.compatibility === 'strict') {
    if (hasAdvancedReferences(state) || state.source) {
      throw new Error('Strict OpenAI payload mode cannot carry Vibe, Precise Reference, img2img or inpaint fields. Switch Payload mode to Auto / NovelAI-aware.');
    }
    return [{ name: 'strict-openai', payload: strict }];
  }

  const nativeWrapped = ngBuildOpenAiWithNativeParameters(state);
  const generic = cleanObject({
    ...strict,
    ...coreExtendedFields(state),
    ...genericReferenceFields(state),
  });

  if (hasAdvancedReferences(state) || state.source) {
    return [
      { name: 'openai-with-nai-parameters', payload: nativeWrapped },
      { name: 'proxy-generic-aliases', payload: generic },
    ];
  }

  const legacyFlat = cleanObject({ ...strict, ...coreExtendedFields(state) });
  return [
    { name: 'openai-with-full-nai-json', payload: nativeWrapped },
    { name: 'openai-extended-flat-fallback', payload: legacyFlat },
    { name: 'strict-openai-fallback', payload: strict },
  ];
}

function ngBytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunk)));
  }
  return btoa(binary);
}

function ngBlobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read image response.'));
    reader.readAsDataURL(blob);
  });
}

async function ngInflateRaw(bytes) {
  if (globalThis.pako?.inflateRaw) return new Uint8Array(globalThis.pako.inflateRaw(bytes));
  if (typeof DecompressionStream === 'function') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error('This Safari build cannot decompress the NovelAI ZIP response. Update iOS/Safari or use the OpenAI wrapper route.');
}

function ngFindZipEocd(view) {
  const minimum = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

async function ngExtractFirstImageFromZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const eocd = ngFindZipEocd(view);
  if (eocd < 0) throw new Error('NovelAI returned ZIP data but the central directory could not be found.');
  const entries = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  let fallback = null;
  const decoder = new TextDecoder();

  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > view.byteLength || view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const entry = { method, compressedSize, localOffset, name };
    if (!fallback) fallback = entry;
    if (/\.(png|jpe?g|webp)$/i.test(name)) {
      fallback = entry;
      break;
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  if (!fallback) throw new Error('NovelAI ZIP response contained no files.');
  const { method, compressedSize, localOffset, name } = fallback;
  if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('NovelAI ZIP local file header is invalid.');
  const localNameLength = view.getUint16(localOffset + 26, true);
  const localExtraLength = view.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
  let imageBytes;
  if (method === 0) imageBytes = compressed;
  else if (method === 8) imageBytes = await ngInflateRaw(compressed);
  else throw new Error(`Unsupported ZIP compression method ${method}.`);

  const mime = /\.jpe?g$/i.test(name) ? 'image/jpeg' : /\.webp$/i.test(name) ? 'image/webp' : 'image/png';
  return ngBlobToDataUrl(new Blob([imageBytes], { type: mime }));
}

async function ngNativeResponseImages(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json') || contentType.includes('text/json')) {
    const data = await response.json();
    return { images: extractImages(data), debug: safePayloadForDebug(data) };
  }
  if (contentType.startsWith('image/')) {
    const blob = await response.blob();
    return { images: [await ngBlobToDataUrl(blob)], debug: { content_type: contentType, bytes: blob.size } };
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (isZip) return { images: [await ngExtractFirstImageFromZip(buffer)], debug: { content_type: contentType || 'application/zip', bytes: bytes.length } };
  if (isPng || isJpeg) {
    const mime = isPng ? 'image/png' : 'image/jpeg';
    return { images: [await ngBlobToDataUrl(new Blob([bytes], { type: mime }))], debug: { content_type: mime, bytes: bytes.length } };
  }

  const text = new TextDecoder().decode(bytes);
  try {
    const data = JSON.parse(text);
    return { images: extractImages(data), debug: safePayloadForDebug(data) };
  } catch {
    throw new Error(`Unrecognized native image response (${contentType || 'unknown content type'}, ${bytes.length} bytes).`);
  }
}

async function ngEncodeVibeReference(ref, signal) {
  if (!ref?.base64 && !ref?.url) throw new Error('Vibe reference image data is missing.');
  const information = Number(ref.information ?? 1);
  if (ref.encodedVibe && ref.encodedVibeInformation === information) return ref.encodedVibe;
  const url = ngProviderCaps.encodeVibeUrl;
  if (!url) throw new Error('The provider did not expose an /ai/encode-vibe route.');
  const payload = {
    image: imageValue(ref),
    model: ngCanonicalNativeModel(settings().model, 'generate').replace(/-inpainting$/i, ''),
    information_extracted: information,
  };
  const started = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const raw = await response.text();
    debugAttempt({ route: 'native-encode-vibe', schema: 'nai-encode-vibe', status: response.status, ms: Math.round(performance.now() - started), payload: safePayloadForDebug(payload), response: raw.slice(0, 700) });
    throw Object.assign(new Error(`Vibe encoding failed: HTTP ${response.status}: ${raw.slice(0, 500) || response.statusText}`), { status: response.status });
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  let encoded = '';
  let responseDebug = {};
  if (contentType.includes('application/json')) {
    const data = await response.json();
    encoded = data?.encoded_vibe || data?.encoded || data?.vibe || data?.base64 || data?.data?.[0]?.b64_json || data?.data?.[0]?.base64 || '';
    responseDebug = safePayloadForDebug(data);
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    encoded = ngBytesToBase64(bytes);
    responseDebug = { content_type: contentType || 'application/octet-stream', bytes: bytes.length };
  }
  if (!encoded) throw new Error('The vibe encoder returned success but no encoded vibe data was found.');
  ref.encodedVibe = encoded;
  ref.encodedVibeInformation = information;
  debugAttempt({ route: 'native-encode-vibe', schema: 'nai-encode-vibe', status: response.status, ms: Math.round(performance.now() - started), payload: { model: payload.model, information_extracted: information, image: `[${String(payload.image).length} chars]` }, response: responseDebug });
  return encoded;
}

async function ngPrepareVibes(state, signal) {
  if (!state.vibes?.length) return;
  if (ngProviderCaps.encodeVibe !== 'supported' || !ngProviderCaps.encodeVibeUrl) return;
  for (const ref of state.vibes) await ngEncodeVibeReference(ref, signal);
}

async function ngPostNativeGeneration(state, signal) {
  const url = ngProviderCaps.nativeGenerateUrl;
  if (!url) throw new Error('The provider did not expose an /ai/generate-image route.');
  const payload = ngBuildNativeEnvelope(state);
  const started = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const raw = await response.text();
    debugAttempt({ route: 'native', schema: 'nai-native-route', status: response.status, ms: Math.round(performance.now() - started), payload: safePayloadForDebug(payload), response: raw.slice(0, 900) });
    throw Object.assign(new Error(`Native NovelAI route failed: HTTP ${response.status}: ${raw.slice(0, 700) || response.statusText}`), { status: response.status });
  }
  const parsed = await ngNativeResponseImages(response);
  debugAttempt({ route: 'native', schema: 'nai-native-route', status: response.status, ms: Math.round(performance.now() - started), payload: safePayloadForDebug(payload), response: parsed.debug, reference_consumption: hasAdvancedReferences(state) ? 'native-route' : 'not-applicable' });
  if (!parsed.images.length) throw Object.assign(new Error('Native NovelAI route returned success but no image could be decoded.'), { status: 200 });
  return { images: parsed.images, data: parsed.debug, schema: 'nai-native-route', route: 'native', referenceVerified: hasAdvancedReferences(state) };
}

// OpenAI-wrapper success no longer fails because `usage.image_tokens` is zero.
// That usage object belongs to the compatibility wrapper and is not a reliable
// signal that NovelAI consumed or ignored Director/Vibe reference fields.
async function postGeneration(route, candidate, state, signal) {
  const path = route === 'chat' ? '/v1/chat/completions' : '/v1/images/generations';
  const body = route === 'chat' ? chatPayloadFrom(candidate.payload, state) : candidate.payload;
  const url = endpoint(path);
  const started = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal,
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  const elapsed = Math.round(performance.now() - started);
  debugAttempt({
    route,
    schema: candidate.name,
    status: response.status,
    ms: elapsed,
    payload: safePayloadForDebug(body),
    response: safePayloadForDebug(data),
    reference_consumption: hasAdvancedReferences(state) ? 'unverified-wrapper' : 'not-applicable',
  });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}: ${raw.slice(0, 700) || response.statusText}`), { status: response.status });
  const images = extractImages(data);
  if (!images.length) throw Object.assign(new Error('Provider returned success but no image URL/base64 was found in the response.'), { status: 200 });
  return { images, data, schema: candidate.name, route, referenceVerified: false };
}

async function generateState(state, label = 'Generating…') {
  ngRvlRequestSeeds.delete(state);
  const s = settings();
  if (!base()) throw new Error('Set Base URL in the Novel Generation drawer first.');
  if (!apiKey) throw new Error('Enter and test the API key first.');
  if (!s.model) throw new Error('Select a model first.');
  if (!state.prompt?.trim()) throw new Error('Enter a prompt first.');
  if (state.vibes?.length && state.precise?.length) throw new Error('NovelAI V4.5 does not allow Vibe Transfer and Precise Reference at the same time. Remove one reference type.');
  if (state.precise?.length && !/4[-_. ]?5/i.test(String(s.model))) throw new Error('Precise Reference requires a NovelAI V4.5 model.');
  if (state.editMode === 'inpaint' && state.source && !state.mask) updateMaskFromCanvas();
  if (state.editMode === 'inpaint' && state.source && !state.mask) throw new Error('Paint an inpaint mask before generating.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, s.timeoutMs));
  const failures = [];
  try {
    if (!ngProviderCaps.checked) {
      try { await ngProbeAdvancedCapabilities(); } catch (error) { console.debug('[Novel Generation] capability probe before generation failed', error); }
    }

    if (isDirectNovelAI()) {
      if (ngProviderCaps.nativeGenerate !== 'supported' || !ngProviderCaps.nativeGenerateUrl) {
        throw new Error('Direct NovelAI native image generation is not available. Reconnect and verify the official image API URL.');
      }
      if (state.vibes?.length && (ngProviderCaps.encodeVibe !== 'supported' || !ngProviderCaps.encodeVibeUrl)) {
        throw new Error('Direct NovelAI Vibe Transfer requires the /ai/encode-vibe route, but this endpoint did not expose it.');
      }
      if (state.vibes?.length) await ngPrepareVibes(state, controller.signal);
      return await ngPostNativeGeneration(state, controller.signal);
    }

    if (state.vibes?.length && ngProviderCaps.encodeVibe === 'supported') {
      try {
        await ngPrepareVibes(state, controller.signal);
      } catch (error) {
        failures.push(`native/encode-vibe: ${error.message}`);
        // Vibe can still be attempted through the OpenAI wrapper if the proxy
        // has its own internal encoder, so do not stop here unless auth failed.
        if (error.status === 401 || error.status === 403) throw error;
      }
    }

    if ((hasAdvancedReferences(state) || state.source) && ngProviderCaps.nativeGenerate === 'supported' && ngProviderCaps.nativeGenerateUrl) {
      try {
        return await ngPostNativeGeneration(state, controller.signal);
      } catch (error) {
        failures.push(`native/nai-native-route: ${error.message}`);
        if (error.name === 'AbortError') throw error;
        if (error.status === 401 || error.status === 403) throw error;
      }
    }

    const candidates = requestCandidates(state);
    const routes = routeCandidates().filter(route => s.routeMode !== 'auto' || !unavailableAutoRoutes.has(route));
    for (const route of routes) {
      if (route === 'chat' && (hasAdvancedReferences(state) || state.source)) continue;
      for (const candidate of candidates) {
        try {
          return await postGeneration(route, candidate, state, controller.signal);
        } catch (error) {
          failures.push(`${route}/${candidate.name}: ${error.message}`);
          if (error.name === 'AbortError') throw error;
          if (error.status === 401 || error.status === 403) throw error;
          // A missing endpoint is independent of payload schema. In Auto mode,
          // do not submit the same generation two more times to the same 404
          // route; remember it for this page session and proceed to chat.
          if (error.status === 404 && s.routeMode === 'auto') {
            unavailableAutoRoutes.add(route);
            break;
          }
          if (error.status === 200) continue;
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }

  if (hasAdvancedReferences(state)) {
    throw new Error(`Advanced reference generation failed. Open Request Debug and send the newest attempts. Last error: ${failures.at(-1) || 'unknown'}`);
  }
  throw new Error(failures.at(-1) || label);
}


/* ===== Runtime 10: Studio behavior and gallery ===== */
function openStudioSection(focus) {
  const section = document.querySelector(`#ng-studio-overlay [data-focus="${focus}"]`);
  if (section) {
    section.open = true;
    setTimeout(() => section.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 20);
  }
}

function renderGallery() {
  const grid = document.getElementById('ng-gallery-grid');
  if (!grid) return;
  if (!gallery.length) {
    grid.innerHTML = '<div class="ng-preview-empty"><i class="fa-regular fa-images"></i><strong>No images yet</strong><span>Successful generations appear here.</span></div>';
    return;
  }
  const images = gallery.map(item => item.src);
  grid.innerHTML = gallery.map((item, index) => `<article class="ng-gallery-item"><img src="${attr(item.src)}"><div><strong>${esc(item.model)}</strong><small>${item.width} × ${item.height}</small></div>${generatedActions(item.src, index)}</article>`).join('');
  bindGeneratedActions(grid, images);
}

function exportGallery() {
  const metadata = gallery.map(({ src, ...rest }) => rest);
  const blob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `novel-generation-gallery-${Date.now()}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function runUpscale(mode) {
  if (!studio?.source) return toast('warning', 'Choose a source image first. Use “Use as source” on any generated image.');
  const out = document.getElementById('ng-gen-status');
  if (out) out.textContent = mode === '4k' ? 'Enhancing toward 4K…' : 'Upscaling 2×…';
  const source = studio.source;
  const ratio = Math.max(0.01, studio.width / Math.max(1, studio.height));
  let targetWidth;
  let targetHeight;
  if (mode === '4k') {
    if (ratio >= 1) {
      targetWidth = 3840;
      targetHeight = Math.round(3840 / ratio / 64) * 64;
    } else {
      targetHeight = 3840;
      targetWidth = Math.round(3840 * ratio / 64) * 64;
    }
  } else {
    targetWidth = Math.round((studio.width * 2) / 64) * 64;
    targetHeight = Math.round((studio.height * 2) / 64) * 64;
  }

  try {
    const providerResult = await tryDedicatedUpscale(source, mode, targetWidth, targetHeight);
    if (providerResult?.length) {
      showImages(providerResult);
      rememberImages(providerResult, studio, { upscale: mode, route: 'upscale-endpoint' });
      if (out) out.textContent = `Upscale completed using provider upscale route.`;
      return;
    }
  } catch (error) {
    debugAttempt({ route: 'upscale', schema: 'provider-upscale', status: error.status || 0, response: error.message });
  }

  const rerender = clone(studio);
  rerender.source = source;
  rerender.editMode = 'img2img';
  rerender.mask = null;
  rerender.width = targetWidth;
  rerender.height = targetHeight;
  rerender.strength = 0.18;
  rerender.noise = 0.04;
  rerender.n = 1;
  rerender.prompt = studio.prompt?.trim() || 'high quality, detailed, clean linework, refined details';
  try {
    const result = await generateState(rerender, 'Upscale failed.');
    showImages(result.images);
    rememberImages(result.images, rerender, { upscale: mode, schema: result.schema, route: result.route });
    if (out) out.textContent = `Upscale completed with high-resolution img2img fallback.`;
  } catch (error) {
    if (out) out.textContent = `Upscale failed: ${error.message}`;
    toast('error', error.message);
  }
}

async function tryDedicatedUpscale(source, mode, width, height) {
  if (isDirectNovelAI()) return [];
  const s = settings();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, s.timeoutMs));
  const payload = cleanObject({ model: s.model, image: imageValue(source), factor: mode === '4k' ? 4 : 2, scale: mode === '4k' ? 4 : 2, width, height, response_format: s.responseFormat });
  try {
    for (const path of ['/v1/images/upscale', '/v1/images/upscales']) {
      const response = await fetch(endpoint(path), { method: 'POST', headers: headers(), body: JSON.stringify(payload), signal: controller.signal });
      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
      debugAttempt({ route: path, schema: 'provider-upscale', status: response.status, payload: safePayloadForDebug(payload), response: safePayloadForDebug(data) });
      if (!response.ok) continue;
      const images = extractImages(data);
      if (images.length) return images;
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function injectSettings() {
  const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
  if (!host || document.getElementById('ng-settings')) return false;
  const wrap = document.createElement('div');
  wrap.innerHTML = settingsHtml();
  host.appendChild(wrap.firstElementChild);
  bindSettings();
  return true;
}

function attemptMount() {
  mountAttempts += 1;
  const settingsReady = Boolean(document.getElementById('ng-settings')) || injectSettings();
  const wandReady = Boolean(document.getElementById('ng-wand-image')) || initWand();
  if ((settingsReady && wandReady) || mountAttempts >= 40) {
    if (mountTimer) clearInterval(mountTimer);
    mountTimer = null;
  }
}

function init() {
  settings();
  attemptMount();
  if (!mountTimer) mountTimer = setInterval(attemptMount, 500);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();


/* ===== Runtime 11: Prompt Assistant and artist browser ===== */
// Novel Generation v0.4.0: Prompt Assistant, chat-context generation, Danbooru artist browser.
const NG_V040_RELEASE = VERSION;
const NG_V040_DANBOORU = 'https://danbooru.donmai.us';
const ngV040ArtistCache = new Map();
let ngV040ArtistDebounce = null;

const NG_V040_TAGS = {
  quality: [
    'masterpiece', 'very aesthetic', 'best quality', 'amazing quality',
    'great quality', 'location', 'no text', 'absurdres',
  ],
  actions: [
    'source#hug', 'target#hug', 'mutual#hug',
    'source#kiss', 'target#kiss', 'mutual#kiss',
    'source#holding hands', 'target#holding hands', 'mutual#holding hands',
    'source#pointing at another', 'target#pointing at another',
  ],
  weighting: [
    '{tag}', '[tag]', '1.2::tag ::', '1.5::tag ::',
    '0.8::tag ::', '0.5::tag ::', '-1::tag ::',
  ],
  negative: [
    'lowres', 'artistic error', 'bad anatomy', 'bad hands', 'extra digits',
    'missing fingers', 'jpeg artifacts', 'watermark', 'logo', 'text',
    'multiple views', 'very displeasing', 'worst quality', 'bad quality',
  ],
  medium: [
    'traditional media', 'faux traditional media', 'mixed media',
    'watercolor (medium)', 'oil painting (medium)', 'ink (medium)',
    'colored pencil (medium)', 'anime screencap', 'pixel art',
    'painterly', 'sketch', 'lineart', 'no lineart',
    'anime coloring', 'pastel colors', 'muted color', 'monochrome',
    'greyscale', 'high contrast', 'backlighting', 'bloom', 'bokeh',
    'depth of field', 'lens flare', 'motion blur', 'soft focus',
  ],
  camera: [
    'portrait', 'close-up', 'upper body', 'cowboy shot', 'full body',
    'wide shot', 'pov', 'perspective', 'dutch angle', 'fisheye',
    'from above', 'from below', 'from behind', 'dynamic angle',
    'rim lighting', 'dramatic lighting', 'golden hour', 'volumetric lighting',
  ],
  character: [
    'solo', 'looking at viewer', 'looking away', 'smile', 'blush',
    'open mouth', 'windblown hair', 'school uniform', 'casual clothes',
    'dress', 'armor', 'swimsuit', 'alternate costume', 'official alternate costume',
  ],
  rating: [
    'rating:general', 'rating:sensitive', 'rating:questionable', 'rating:explicit',
  ],
};

const NG_V040_PRESETS = {
  portrait: ['portrait', 'solo', 'upper body', 'looking at viewer', 'detailed face', 'depth of field'],
  selfie: ['selfie', 'looking at viewer', 'close-up', 'arm extended', 'candid', 'natural lighting'],
  manga: ['manga', 'monochrome', 'screentone', 'dramatic composition', 'dynamic angle'],
  scenery: ['background dataset', 'scenery', 'wide shot', 'atmospheric perspective', 'detailed background'],
  romantic: ['romantic atmosphere', 'soft lighting', 'blush', 'warm colors', 'depth of field'],
  action: ['dynamic pose', 'action scene', 'motion blur', 'dramatic lighting', 'dynamic angle'],
};

function ngV040Prefs() {
  const s = settings();
  s.promptAssistant ??= {};
  const p = s.promptAssistant;
  if (!('quickPreview' in p)) p.quickPreview = true;
  if (!('contextMessages' in p)) p.contextMessages = 4;
  if (!('autoQuality' in p)) p.autoQuality = true;
  if (!('useArtistsQuick' in p)) p.useArtistsQuick = true;
  if (!Array.isArray(p.selectedArtists)) p.selectedArtists = [];
  if (!Array.isArray(p.presets)) p.presets = [];
  return p;
}

function ngV040NormalizeTag(tag) {
  return String(tag || '').trim().replace(/\s+/g, ' ');
}

function ngV040PromptParts(text) {
  return String(text || '')
    .split(',')
    .map(ngV040NormalizeTag)
    .filter(Boolean);
}

function ngV040AppendTags(text, tags) {
  const existing = ngV040PromptParts(text);
  const seen = new Set(existing.map(item => item.toLowerCase()));
  for (const raw of tags || []) {
    const tag = ngV040NormalizeTag(raw);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    existing.push(tag);
    seen.add(tag.toLowerCase());
  }
  return existing.join(', ');
}

function ngV040ModelQualityTags() {
  const model = String(settings().model || '').toLowerCase();
  if (/4[-_. ]?5/.test(model) && /curated/.test(model)) {
    return ['location', 'masterpiece', 'no text', '-0.8::feet ::', 'rating:general'];
  }
  if (/4[-_. ]?5/.test(model)) return ['location', 'very aesthetic', 'masterpiece', 'no text'];
  if (/4/.test(model) && /curated/.test(model)) return ['rating:general', 'amazing quality', 'very aesthetic', 'absurdres'];
  if (/4/.test(model)) return ['no text', 'best quality', 'very aesthetic', 'absurdres'];
  return ['best quality', 'amazing quality', 'very aesthetic'];
}

function ngV040RecentContext(limit = ngV040Prefs().contextMessages) {
  let chat = [];
  try { chat = Array.isArray(ctx().chat) ? ctx().chat : []; } catch { return ''; }
  const character = characterData();
  const user = personaName();
  return chat
    .filter(message => message && !message.is_system && message.mes)
    .slice(-Math.max(1, Math.min(10, Number(limit) || 4)))
    .map(message => {
      const speaker = message.is_user ? user : (character.name || 'Character');
      return `${speaker}: ${stripMarkup(message.mes).slice(0, 900)}`;
    })
    .filter(line => line.length > 2)
    .join('\n')
    .slice(0, 4200);
}

function ngV040ContextPrompt(mode) {
  const s = settings();
  const char = characterData();
  const scene = ngV040RecentContext();
  const appearance = s.roleplay.character && char.description
    ? `Character appearance: ${char.description.slice(0, 1600)}.`
    : '';
  const user = s.roleplay.persona ? personaName() : 'the user';

  if (mode === 'portrait') {
    return `portrait of ${char.name || 'the active character'}, solo, detailed character illustration. ${appearance} Current roleplay context: ${scene}`.trim();
  }
  if (mode === 'selfie') {
    return `${char.name || 'the active character'} taking a selfie, candid close framing, natural pose. ${appearance} Current roleplay scene: ${scene}`.trim();
  }
  if (mode === 'user') {
    return `portrait of ${user}, detailed character illustration. Current roleplay context: ${scene}`.trim();
  }
  if (mode === 'last') {
    return `Illustrate the current roleplay scene faithfully. Preserve the visible actions, expressions, clothing, environment, time of day, camera-relevant details, and character relationships described in the chat. ${appearance} Scene context:\n${scene}`.trim();
  }
  if (mode === 'manga') {
    return `manga panel, cinematic storytelling, dynamic composition. Preserve the current roleplay action and character details. ${appearance} Scene context:\n${scene}`.trim();
  }
  return scene ? `Scene context:\n${scene}` : '';
}

function ngV040ArtistPromptTags() {
  return ngV040Prefs().selectedArtists.map(item => {
    const name = String(item?.name || '').replace(/_/g, ' ').trim();
    if (!name) return '';
    const weight = Math.max(-3, Math.min(3, Number(item.weight ?? 1)));
    return Math.abs(weight - 1) < 0.001 ? name : `${weight}::${name} ::`;
  }).filter(Boolean);
}

function ngV040BuildQuickPrompt(mode, manualPrompt = '') {
  let prompt = manualPrompt?.trim() || ngV040ContextPrompt(mode);
  const prefs = ngV040Prefs();
  if (prefs.useArtistsQuick) prompt = ngV040AppendTags(prompt, ngV040ArtistPromptTags());
  if (prefs.autoQuality) prompt = ngV040AppendTags(prompt, ngV040ModelQualityTags());
  return prompt;
}

function ngV040SuggestTags(promptText) {
  const text = String(promptText || '').toLowerCase();
  const suggestions = new Set();
  const add = (...tags) => tags.forEach(tag => suggestions.add(tag));

  if (/(portrait|face|headshot|close[- ]?up)/.test(text)) add('upper body', 'looking at viewer', 'detailed face', 'depth of field');
  if (/(selfie)/.test(text)) add('selfie', 'looking at viewer', 'arm extended', 'candid');
  if (/(manga|comic|panel)/.test(text)) add('monochrome', 'screentone', 'dramatic composition', 'dynamic angle');
  if (/(fight|battle|combat|attack|sword|running|chase|action)/.test(text)) add('dynamic pose', 'motion blur', 'dramatic lighting', 'dynamic angle');
  if (/(night|midnight|dark street)/.test(text)) add('night', 'moonlight', 'rim lighting');
  if (/(rain|storm)/.test(text)) add('rain', 'wet', 'reflections', 'dramatic lighting');
  if (/(sunset|dusk)/.test(text)) add('sunset', 'golden hour', 'warm lighting');
  if (/(forest|woods)/.test(text)) add('forest', 'dappled sunlight', 'atmospheric perspective');
  if (/(beach|ocean|sea)/.test(text)) add('beach', 'ocean', 'sunlight', 'windblown hair');
  if (/(school|classroom)/.test(text)) add('school uniform', 'classroom', 'daylight');
  if (/(romance|romantic|kiss|date|love)/.test(text)) add('romantic atmosphere', 'soft lighting', 'blush', 'depth of field');
  if (/(city|street|urban)/.test(text)) add('cityscape', 'street', 'detailed background');
  if (/(indoors|room|bedroom|kitchen|office)/.test(text)) add('indoors', 'ambient lighting');
  if (/(outdoors|field|mountain|park)/.test(text)) add('outdoors', 'atmospheric perspective');
  if (/(wind|blowing)/.test(text)) add('wind', 'windblown hair', 'dynamic clothes');

  for (const tag of ngV040ModelQualityTags()) suggestions.add(tag);
  return [...suggestions].slice(0, 24);
}

function ngV040InsertText(target, value) {
  if (!studio) return;
  const key = target === 'negative' ? 'negative' : 'prompt';
  studio[key] = ngV040AppendTags(studio[key], [value]);
  const textarea = document.getElementById(key === 'negative' ? 'ng-negative' : 'ng-prompt');
  if (textarea) {
    textarea.value = studio[key];
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function ngV040ApplyPreset(name) {
  const tags = NG_V040_PRESETS[name];
  if (!tags) return;
  if (!studio) return;
  studio.prompt = ngV040AppendTags(studio.prompt, tags);
  const textarea = document.getElementById('ng-prompt');
  if (textarea) {
    textarea.value = studio.prompt;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function ngV040SavePreset() {
  if (!studio?.prompt?.trim()) return toast('warning', 'Write a prompt before saving a preset.');
  const name = window.prompt('Preset name:');
  if (!name?.trim()) return;
  const prefs = ngV040Prefs();
  const existing = prefs.presets.find(item => item.name.toLowerCase() === name.trim().toLowerCase());
  const snapshot = { name: name.trim(), prompt: studio.prompt, negative: studio.negative || '' };
  if (existing) Object.assign(existing, snapshot);
  else prefs.presets.push(snapshot);
  prefs.presets.splice(20);
  save();
  ngV040RenderCustomPresets();
}

function ngV040RenderCustomPresets() {
  const root = document.getElementById('ng-v040-custom-presets');
  if (!root) return;
  const presets = ngV040Prefs().presets;
  root.innerHTML = presets.length
    ? presets.map((item, index) => `<div class="ng-v040-preset-row"><button class="menu_button ng-v040-load-preset" data-index="${index}" type="button">${esc(item.name)}</button><button class="menu_button ng-v040-delete-preset" data-index="${index}" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button></div>`).join('')
    : '<small class="ng-help">No custom presets saved yet.</small>';
  root.querySelectorAll('.ng-v040-load-preset').forEach(button => button.addEventListener('click', () => {
    const item = ngV040Prefs().presets[+button.dataset.index];
    if (!item || !studio) return;
    studio.prompt = item.prompt || '';
    studio.negative = item.negative || '';
    const prompt = document.getElementById('ng-prompt');
    const negative = document.getElementById('ng-negative');
    if (prompt) prompt.value = studio.prompt;
    if (negative) negative.value = studio.negative;
  }));
  root.querySelectorAll('.ng-v040-delete-preset').forEach(button => button.addEventListener('click', () => {
    ngV040Prefs().presets.splice(+button.dataset.index, 1);
    save();
    ngV040RenderCustomPresets();
  }));
}

function ngV040TagButtons(tags, target = 'prompt') {
  return `<div class="ng-v040-tag-grid">${tags.map(tag => `<button class="menu_button ng-v040-tag" type="button" data-target="${target}" data-tag="${attr(tag)}">${esc(tag)}</button>`).join('')}</div>`;
}

function ngV040AssistantHtml() {
  const prefs = ngV040Prefs();
  return `<details id="ng-v040-assistant" class="ng-studio-section ng-v040-assistant" data-focus="assistant">
    <summary><i class="fa-solid fa-book-open"></i><span>NovelAI Cheatsheet & Prompt Assistant</span><i class="fa-solid fa-chevron-down"></i></summary>
    <div class="ng-studio-section-body">
      <div class="ng-v040-toolbar">
        <select id="ng-v040-insert-target" class="text_pole"><option value="prompt">Insert into Prompt</option><option value="negative">Insert into Undesired Content</option></select>
        <button id="ng-v040-suggest" class="menu_button" type="button"><i class="fa-solid fa-lightbulb"></i> Suggest Tags</button>
        <button id="ng-v040-context" class="menu_button" type="button"><i class="fa-solid fa-comments"></i> Add Chat Context</button>
        <button id="ng-v040-export-md" class="menu_button" type="button"><i class="fa-solid fa-file-arrow-down"></i> Save all as .md</button>
      </div>

      <details class="ng-v040-cheat" open><summary><i class="fa-solid fa-palette"></i> Artist / Style tags</summary>
        <p class="ng-muted">Search the Danbooru artist tag catalog. Results are loaded lazily; the full catalog is not downloaded at startup.</p>
        <div class="ng-v040-search-row"><input id="ng-v040-artist-search" class="text_pole" type="search" placeholder="Search Danbooru artist tags…"><button id="ng-v040-artist-clear" class="menu_button" type="button">Clear</button></div>
        <div id="ng-v040-artist-results" class="ng-v040-search-results"></div>
        <div class="ng-v040-subhead">Selected artists / style mix</div>
        <div id="ng-v040-selected-artists" class="ng-v040-selected-artists"></div>
        <button id="ng-v040-apply-artists" class="menu_button" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Apply style mix to prompt</button>
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-people-arrows"></i> source# / target# / mutual#</summary>
        <p class="ng-muted">Use action-role prefixes in multi-character prompts to indicate who performs, receives, or mutually performs an action.</p>${ngV040TagButtons(NG_V040_TAGS.actions)}
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-scale-balanced"></i> Density / tag weighting</summary>
        <p class="ng-muted">V4+ supports numerical emphasis. Curly braces strengthen; square brackets weaken. Edit the placeholder “tag” after insertion.</p>${ngV040TagButtons(NG_V040_TAGS.weighting)}
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-star"></i> Quality / Aesthetic / Special tags</summary>
        ${ngV040TagButtons(NG_V040_TAGS.quality)}
        <div class="ng-v040-subhead">Model-aware quality set</div>
        <button id="ng-v040-quality-model" class="menu_button" type="button">Apply recommended quality tags for selected model</button>
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-ban"></i> Undesired Content (negative)</summary>
        ${ngV040TagButtons(NG_V040_TAGS.negative, 'negative')}
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-brush"></i> Medium / Art style / Coloring / FX</summary>
        ${ngV040TagButtons(NG_V040_TAGS.medium)}
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-camera"></i> Camera / Frame / Lighting</summary>
        ${ngV040TagButtons(NG_V040_TAGS.camera)}
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-shirt"></i> Character / Costume variant tags</summary>
        ${ngV040TagButtons(NG_V040_TAGS.character)}
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-triangle-exclamation"></i> NSFW / rating tags (18+)</summary>
        <p class="ng-muted">Rating tags are provided as prompt controls. Use only where appropriate for your own generation workflow.</p>${ngV040TagButtons(NG_V040_TAGS.rating)}
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-sliders"></i> Recommended values + Anlas notes</summary>
        <div class="ng-v040-info-grid">
          <div><strong>Steps</strong><span>Start around 28 for normal V4/V4.5 work; more is not automatically better.</span></div>
          <div><strong>Guidance</strong><span>5–6 is a practical starting range for V3+; adjust by scene/style.</span></div>
          <div><strong>Seed</strong><span>Reuse a fixed seed when comparing prompt/tag changes.</span></div>
          <div><strong>Anlas</strong><span>Batching and larger generations can cost more. Provider/proxy billing may differ from NovelAI's own service.</span></div>
        </div>
      </details>

      <details class="ng-v040-cheat" open><summary><i class="fa-solid fa-lightbulb"></i> Suggestion Tags</summary>
        <div id="ng-v040-suggestions" class="ng-v040-tag-grid"><small class="ng-help">Press “Suggest Tags” to analyze the current prompt locally. No LLM/API quota is used.</small></div>
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-bookmark"></i> Prompt presets</summary>
        <div class="ng-v040-tag-grid">${Object.keys(NG_V040_PRESETS).map(name => `<button class="menu_button ng-v040-builtin-preset" data-preset="${name}" type="button">${esc(name)}</button>`).join('')}</div>
        <div class="ng-actions"><button id="ng-v040-save-preset" class="menu_button" type="button"><i class="fa-solid fa-floppy-disk"></i> Save current preset</button></div>
        <div id="ng-v040-custom-presets"></div>
      </details>

      <label class="checkbox_label"><input id="ng-v040-auto-quality-studio" type="checkbox" ${prefs.autoQuality ? 'checked' : ''}><span>Use model-aware Quality Tags for Quick Generation</span></label>
    </div>
  </details>`;
}

async function ngV040SearchArtists(query) {
  const normalized = String(query || '').trim().replace(/\s+/g, '_').toLowerCase();
  if (normalized.length < 2) return [];
  if (ngV040ArtistCache.has(normalized)) return ngV040ArtistCache.get(normalized);
  const params = new URLSearchParams();
  params.set('search[name_or_alias_matches]', `${normalized}*`);
  params.set('search[category]', '1');
  params.set('search[order]', 'count');
  params.set('search[is_deprecated]', 'false');
  params.set('limit', '30');
  const response = await fetch(`${NG_V040_DANBOORU}/tags.json?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Danbooru HTTP ${response.status}`);
  const data = await response.json();
  const artists = (Array.isArray(data) ? data : [])
    .filter(item => Number(item.category) === 1 && !item.is_deprecated && item.name)
    .map(item => ({ name: item.name, postCount: Number(item.post_count) || 0 }))
    .slice(0, 30);
  ngV040ArtistCache.set(normalized, artists);
  return artists;
}

function ngV040RenderArtistResults(items, error = '') {
  const root = document.getElementById('ng-v040-artist-results');
  if (!root) return;
  if (error) {
    root.innerHTML = `<div class="ng-status is-error">${esc(error)}</div>`;
    return;
  }
  if (!items?.length) {
    root.innerHTML = '<small class="ng-help">No artist tags found.</small>';
    return;
  }
  root.innerHTML = items.map(item => `<button class="menu_button ng-v040-artist-result" type="button" data-name="${attr(item.name)}"><span>${esc(item.name.replace(/_/g, ' '))}</span><small>${item.postCount.toLocaleString()} posts</small></button>`).join('');
  root.querySelectorAll('.ng-v040-artist-result').forEach(button => button.addEventListener('click', () => {
    const prefs = ngV040Prefs();
    const name = button.dataset.name;
    if (!prefs.selectedArtists.some(item => item.name === name)) prefs.selectedArtists.push({ name, weight: 1 });
    save();
    ngV040RenderSelectedArtists();
  }));
}

function ngV040RenderSelectedArtists() {
  const root = document.getElementById('ng-v040-selected-artists');
  if (!root) return;
  const items = ngV040Prefs().selectedArtists;
  root.innerHTML = items.length ? items.map((item, index) => `<div class="ng-v040-artist-chip">
      <span>${esc(String(item.name).replace(/_/g, ' '))}</span>
      <label>Weight <input class="text_pole ng-v040-artist-weight" data-index="${index}" type="number" min="-3" max="3" step="0.1" value="${Number(item.weight ?? 1)}"></label>
      <button class="menu_button ng-v040-artist-remove" data-index="${index}" type="button" title="Remove"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('') : '<small class="ng-help">No artists selected. Select multiple artists to build a style mix.</small>';
  root.querySelectorAll('.ng-v040-artist-weight').forEach(input => input.addEventListener('change', () => {
    const item = ngV040Prefs().selectedArtists[+input.dataset.index];
    if (item) item.weight = Math.max(-3, Math.min(3, Number(input.value) || 1));
    save();
  }));
  root.querySelectorAll('.ng-v040-artist-remove').forEach(button => button.addEventListener('click', () => {
    ngV040Prefs().selectedArtists.splice(+button.dataset.index, 1);
    save();
    ngV040RenderSelectedArtists();
  }));
}

function ngV040RenderSuggestions() {
  const root = document.getElementById('ng-v040-suggestions');
  if (!root) return;
  const suggestions = ngV040SuggestTags(studio?.prompt || '');
  root.innerHTML = suggestions.length
    ? suggestions.map(tag => `<button class="menu_button ng-v040-suggestion" type="button" data-tag="${attr(tag)}">${esc(tag)}</button>`).join('')
    : '<small class="ng-help">No suggestions for the current prompt.</small>';
  root.querySelectorAll('.ng-v040-suggestion').forEach(button => button.addEventListener('click', () => {
    const target = document.getElementById('ng-v040-insert-target')?.value || 'prompt';
    ngV040InsertText(target, button.dataset.tag);
  }));
}

function ngV040CheatsheetMarkdown() {
  const artists = ngV040Prefs().selectedArtists.map(item => `- ${item.name.replace(/_/g, ' ')} (weight ${item.weight ?? 1})`).join('\n') || '- None selected';
  return `# NovelAI Cheatsheet — Novel Generation ${NG_V040_RELEASE}

## Artist / Style tags
Search Danbooru artist tags from the Prompt Assistant. Artist searches are lazy-loaded and can be mixed with individual weights.

Selected artists:
${artists}

## Multi-character action roles
- \`source#action\`: character performs the action.
- \`target#action\`: character receives the action.
- \`mutual#action\`: both characters mutually perform the action.

## Density / weighting
- \`{tag}\` strengthens and \`[tag]\` weakens.
- V4+ supports numerical emphasis such as \`1.5::tag ::\` and \`0.5::tag ::\`.
- V4.5 supports negative numerical emphasis for targeted removal/inversion.

## Quality / Aesthetic / Special
${NG_V040_TAGS.quality.map(tag => `- \`${tag}\``).join('\n')}

## Undesired Content
${NG_V040_TAGS.negative.map(tag => `- \`${tag}\``).join('\n')}

## Medium / Art style / Coloring / FX
${NG_V040_TAGS.medium.map(tag => `- \`${tag}\``).join('\n')}

## Camera / Frame / Lighting
${NG_V040_TAGS.camera.map(tag => `- \`${tag}\``).join('\n')}

## Character / Costume
${NG_V040_TAGS.character.map(tag => `- \`${tag}\``).join('\n')}

## Rating tags
${NG_V040_TAGS.rating.map(tag => `- \`${tag}\``).join('\n')}

## Recommended starting values
- Steps: around 28 for normal V4/V4.5 work.
- Guidance: around 5–6 is a practical V3+ starting point.
- Seed: reuse a fixed seed for A/B comparisons.
- Billing: proxy/provider billing can differ from NovelAI's own Anlas rules.

Generated from the built-in Prompt Assistant.
`;
}

function ngV040ExportMarkdown() {
  const blob = new Blob([ngV040CheatsheetMarkdown()], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `novelai-cheatsheet-${Date.now()}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ngV040BindAssistant() {
  const root = document.getElementById('ng-v040-assistant');
  if (!root || root.dataset.bound === '1') return;
  root.dataset.bound = '1';

  root.querySelectorAll('.ng-v040-tag').forEach(button => button.addEventListener('click', () => {
    const override = button.dataset.target;
    const target = override === 'negative' ? 'negative' : (document.getElementById('ng-v040-insert-target')?.value || 'prompt');
    ngV040InsertText(target, button.dataset.tag);
  }));
  root.querySelectorAll('.ng-v040-builtin-preset').forEach(button => button.addEventListener('click', () => ngV040ApplyPreset(button.dataset.preset)));

  document.getElementById('ng-v040-suggest')?.addEventListener('click', ngV040RenderSuggestions);
  document.getElementById('ng-v040-context')?.addEventListener('click', () => {
    if (!studio) return;
    const context = ngV040RecentContext();
    if (!context) return toast('warning', 'No recent roleplay context was found.');
    studio.prompt = `${studio.prompt.trim()}\n\nScene context:\n${context}`.trim();
    const prompt = document.getElementById('ng-prompt');
    if (prompt) {
      prompt.value = studio.prompt;
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  document.getElementById('ng-v040-export-md')?.addEventListener('click', ngV040ExportMarkdown);
  document.getElementById('ng-v040-quality-model')?.addEventListener('click', () => {
    if (!studio) return;
    studio.prompt = ngV040AppendTags(studio.prompt, ngV040ModelQualityTags());
    const prompt = document.getElementById('ng-prompt');
    if (prompt) {
      prompt.value = studio.prompt;
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  document.getElementById('ng-v040-apply-artists')?.addEventListener('click', () => {
    if (!studio) return;
    studio.prompt = ngV040AppendTags(studio.prompt, ngV040ArtistPromptTags());
    const prompt = document.getElementById('ng-prompt');
    if (prompt) {
      prompt.value = studio.prompt;
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  document.getElementById('ng-v040-save-preset')?.addEventListener('click', ngV040SavePreset);
  document.getElementById('ng-v040-auto-quality-studio')?.addEventListener('change', event => {
    ngV040Prefs().autoQuality = event.currentTarget.checked;
    save();
  });

  const artistSearch = document.getElementById('ng-v040-artist-search');
  artistSearch?.addEventListener('input', () => {
    clearTimeout(ngV040ArtistDebounce);
    const query = artistSearch.value;
    if (query.trim().length < 2) {
      ngV040RenderArtistResults([]);
      return;
    }
    const resultRoot = document.getElementById('ng-v040-artist-results');
    if (resultRoot) resultRoot.innerHTML = '<small class="ng-help">Searching Danbooru…</small>';
    ngV040ArtistDebounce = setTimeout(async () => {
      try { ngV040RenderArtistResults(await ngV040SearchArtists(query)); }
      catch (error) { ngV040RenderArtistResults([], `Artist search failed: ${error.message}`); }
    }, 350);
  });
  document.getElementById('ng-v040-artist-clear')?.addEventListener('click', () => {
    if (artistSearch) artistSearch.value = '';
    ngV040RenderArtistResults([]);
  });

  ngV040RenderSelectedArtists();
  ngV040RenderCustomPresets();
}

function ngV040EnhanceStudioUi() {
  const panel = document.getElementById('ng-generate-panel');
  if (!panel) return false;
  document.querySelectorAll('#ng-studio-overlay .ng-studio-title small').forEach(node => {
    if (!String(node.textContent).includes(`v${NG_V040_RELEASE}`)) node.title = `Novel Generation v${NG_V040_RELEASE}`;
  });
  if (!document.getElementById('ng-v040-assistant')) {
    const parameters = panel.querySelector('[data-focus="parameters"]');
    if (parameters) parameters.insertAdjacentHTML('beforebegin', ngV040AssistantHtml());
    else panel.insertAdjacentHTML('beforeend', ngV040AssistantHtml());
  }
  ngV040BindAssistant();
  return true;
}

function ngV040InstallDrawer() {
  const root = document.getElementById('ng-settings');
  if (!root) return false;
  root.querySelectorAll('.ng-version').forEach(node => { node.textContent = `v${NG_V040_RELEASE}`; });
  if (document.getElementById('ng-v040-drawer')) return true;
  const advanced = document.getElementById('ng-advanced');
  if (!advanced) return false;
  const prefs = ngV040Prefs();
  advanced.insertAdjacentHTML('beforebegin', `<details class="ng-section" id="ng-v040-drawer">
    <summary><span class="ng-section-icon"><i class="fa-solid fa-book-open"></i></span><span class="ng-section-copy"><strong>NovelAI Cheatsheet & Prompt Assistant</strong><small>Chat context, Quality Tags, suggestions and Danbooru artist styles</small></span><i class="fa-solid fa-chevron-down ng-section-chevron"></i></summary>
    <div class="ng-section-body">
      <label class="checkbox_label"><input id="ng-v040-quick-preview" type="checkbox" ${prefs.quickPreview ? 'checked' : ''}><span>Preview/edit Quick Generation prompt before sending</span></label>
      <label class="checkbox_label"><input id="ng-v040-auto-quality" type="checkbox" ${prefs.autoQuality ? 'checked' : ''}><span>Automatically add model-aware Quality Tags to Quick Generation</span></label>
      <label class="checkbox_label"><input id="ng-v040-quick-artists" type="checkbox" ${prefs.useArtistsQuick ? 'checked' : ''}><span>Use selected Danbooru artist style mix in Quick Generation</span></label>
      <label class="ng-field"><span class="ng-label">Recent chat messages to read</span><input id="ng-v040-context-count" class="text_pole" type="number" min="1" max="10" value="${Number(prefs.contextMessages) || 4}"><small class="ng-help">Quick Portrait/Selfie/User/Last Message/Manga modes can read this many recent roleplay messages.</small></label>
      <div class="ng-actions"><button id="ng-v040-open-assistant" class="menu_button" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Open Prompt Assistant</button><button id="ng-v040-drawer-export" class="menu_button" type="button"><i class="fa-solid fa-file-arrow-down"></i> Save cheatsheet .md</button></div>
    </div>
  </details>`);
  document.getElementById('ng-v040-quick-preview')?.addEventListener('change', event => { prefs.quickPreview = event.currentTarget.checked; save(); });
  document.getElementById('ng-v040-auto-quality')?.addEventListener('change', event => { prefs.autoQuality = event.currentTarget.checked; save(); });
  document.getElementById('ng-v040-quick-artists')?.addEventListener('change', event => { prefs.useArtistsQuick = event.currentTarget.checked; save(); });
  document.getElementById('ng-v040-context-count')?.addEventListener('change', event => {
    prefs.contextMessages = Math.max(1, Math.min(10, Number(event.currentTarget.value) || 4));
    event.currentTarget.value = prefs.contextMessages;
    save();
  });
  document.getElementById('ng-v040-open-assistant')?.addEventListener('click', () => {
    openStudio('last', 'prompt');
    setTimeout(() => {
      ngV040EnhanceStudioUi();
      openStudioSection('assistant');
    }, 20);
  });
  document.getElementById('ng-v040-drawer-export')?.addEventListener('click', ngV040ExportMarkdown);
  return true;
}

function ngV040QuickPreview(state, mode) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'ng-v040-preview-overlay';
    overlay.innerHTML = `<div class="ng-v040-preview-dialog" role="dialog" aria-modal="true">
      <header><div><strong>Quick Generation Preview</strong><small>${esc(mode)}</small></div><button class="menu_button ng-v040-preview-cancel" type="button"><i class="fa-solid fa-xmark"></i></button></header>
      <label class="ng-field"><span class="ng-label">Prompt</span><textarea class="text_pole ng-v040-preview-prompt" rows="10">${esc(state.prompt)}</textarea></label>
      <label class="ng-field"><span class="ng-label">Undesired Content</span><textarea class="text_pole ng-v040-preview-negative" rows="4">${esc(state.negative || '')}</textarea></label>
      <div class="ng-v040-preview-suggestions">${ngV040TagButtons(ngV040SuggestTags(state.prompt))}</div>
      <footer><button class="menu_button ng-v040-preview-cancel" type="button">Cancel</button><button class="menu_button ng-v040-preview-generate" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate & insert</button></footer>
    </div>`;
    document.documentElement.appendChild(overlay);
    const prompt = overlay.querySelector('.ng-v040-preview-prompt');
    const negative = overlay.querySelector('.ng-v040-preview-negative');
    overlay.querySelectorAll('.ng-v040-tag').forEach(button => button.addEventListener('click', () => {
      prompt.value = ngV040AppendTags(prompt.value, [button.dataset.tag]);
    }));
    const finish = value => { overlay.remove(); resolve(value); };
    overlay.querySelectorAll('.ng-v040-preview-cancel').forEach(button => button.addEventListener('click', () => finish(null)));
    overlay.querySelector('.ng-v040-preview-generate')?.addEventListener('click', () => {
      state.prompt = prompt.value.trim();
      state.negative = negative.value.trim();
      finish(state);
    });
  });
}

// Upgrade chat-driven quick prompts without adding another LLM/API call.
const ngV040BaseQuickGenerate = quickGenerate;
quickGenerate = async function(mode, manualPrompt = '') {
  const state = newStudio(mode, 'prompt');
  state.prompt = ngV040BuildQuickPrompt(mode, manualPrompt);
  state.n = settings().image.n;
  if (!state.prompt?.trim()) state.prompt = manualPrompt?.trim() || modePrompt(mode);
  if (ngV040Prefs().quickPreview) {
    const approved = await ngV040QuickPreview(state, mode);
    if (!approved) return;
  }
  toast('info', `Generating ${mode === 'last' ? 'the current roleplay scene' : mode}…`);
  try {
    const result = await generateState(state);
    rememberImages(result.images, state, { schema: result.schema, route: result.route, quick: true, chatContext: true });
    if (settings().roleplay.autoInsert) await insertImagesIntoChat(result.images, state.prompt);
    toast('success', settings().roleplay.autoInsert
      ? `Generated ${result.images.length} image${result.images.length === 1 ? '' : 's'} from chat context and inserted into chat.`
      : `Generated ${result.images.length} image${result.images.length === 1 ? '' : 's'} from chat context.`);
  } catch (error) {
    toast('error', error.message);
  }
};

// Future Studio opens receive the Prompt Assistant immediately.
const ngV040BaseOpenStudio = openStudio;
openStudio = function(mode = 'free', focus = 'prompt') {
  ngV040BaseOpenStudio(mode, focus);
  setTimeout(ngV040EnhanceStudioUi, 0);
};

// Add a direct Send-to-chat action to generated images and gallery entries.
const ngV040BaseGeneratedActions = generatedActions;
generatedActions = function(src, index) {
  const html = ngV040BaseGeneratedActions(src, index);
  return html.replace('</div>', `<button class="menu_button ng-v040-send-chat" data-src-index="${index}" type="button"><i class="fa-solid fa-comment"></i> Send to chat</button></div>`);
};

const ngV040BaseBindGeneratedActions = bindGeneratedActions;
bindGeneratedActions = function(root, images) {
  ngV040BaseBindGeneratedActions(root, images);
  root.querySelectorAll('.ng-v040-send-chat').forEach(button => button.addEventListener('click', async () => {
    try {
      const src = images[+button.dataset.srcIndex];
      if (!src) return;
      await insertImagesIntoChat([src], studio?.prompt || '');
      toast('success', 'Image inserted into the selected chat message.');
    } catch (error) {
      toast('error', error.message);
    }
  }));
};

ngV040Prefs();
let ngV040InstallAttempts = 0;
const ngV040InstallTimer = setInterval(() => {
  ngV040InstallAttempts += 1;
  const drawerReady = ngV040InstallDrawer();
  if (document.getElementById('ng-studio-overlay')) ngV040EnhanceStudioUi();
  if (drawerReady || ngV040InstallAttempts >= 40) clearInterval(ngV040InstallTimer);
}, 300);


/* ===== Runtime 12: extended image parameters and editing ===== */
// Novel Generation v0.5.1 — additive feature layer on top of the restored v0.4 UI/runtime.
// This layer intentionally keeps the v0.4 drawer, wand menu, Studio, Vibe/Precise,
// touch mask painter, gallery/export, and Prompt Assistant designs intact.

var NG_V051_RELEASE = VERSION;
var NG_V051_SIZE_PRESETS = [
  ['portrait-small', 'Small Portrait · 512 × 768', 512, 768],
  ['portrait-3x4', 'Portrait 3:4 · 768 × 1024', 768, 1024],
  ['portrait-normal', 'Portrait · 832 × 1216', 832, 1216],
  ['portrait-tall', 'Tall Portrait · 768 × 1344', 768, 1344],
  ['portrait-large', 'Large Portrait · 1024 × 1536', 1024, 1536],
  ['square-small', 'Small Square · 512 × 512', 512, 512],
  ['square-medium', 'Medium Square · 768 × 768', 768, 768],
  ['square-normal', 'Square · 1024 × 1024', 1024, 1024],
  ['square-large', 'Large Square · 1472 × 1472', 1472, 1472],
  ['landscape-small', 'Small Landscape · 768 × 512', 768, 512],
  ['landscape-4x3', 'Landscape 4:3 · 1024 × 768', 1024, 768],
  ['landscape-normal', 'Landscape · 1216 × 832', 1216, 832],
  ['landscape-wide', 'Wide Landscape · 1344 × 768', 1344, 768],
  ['landscape-large', 'Large Landscape · 1536 × 1024', 1536, 1024],
];
var NG_V051_PARAM_PRESETS = {
  balanced: ['Balanced V4/V4.5', 28, 5, 'k_euler_ancestral', 'karras'],
  dpm: ['DPM++ 2M', 28, 5, 'k_dpmpp_2m', 'karras'],
  fast: ['Fast Preview', 20, 5, 'k_euler_ancestral', 'karras'],
  detail: ['More Iterations', 32, 5, 'k_dpmpp_2m', 'karras'],
};
var NG_V051_UC = {
  none: '',
  light: 'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
  human: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy',
  heavy: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
};

function ngV051EnsureSettings() {
  var s = settings();
  s.image.smeaMode ??= 'off';
  s.image.decrisper ??= false;
  s.image.prefix ??= '';
  s.image.suffix ??= '';
  s.image.negativePreset ??= 'none';
  s.image.defaultNegative ??= '';
  s.image.extraBody ??= '';
  s.roleplay.personaPresence ??= 'auto';
  s.roleplay.contextMessages ??= 4;
  s.roleplay.perMessageChars ??= 1200;
  s.roleplay.contextChars ??= 7000;
  return s;
}

function ngV051SetVersionLabels() {
  document.querySelectorAll('#ng-settings .ng-version').forEach(function (node) { node.textContent = 'v' + NG_V051_RELEASE; });
  document.querySelectorAll('#ng-studio-overlay .ng-studio-title small').forEach(function (node) { node.textContent = 'v' + NG_V051_RELEASE; });
}

function ngV051SmeaFlags(state) {
  var s = ngV051EnsureSettings();
  var mode = state.smeaMode || s.image.smeaMode || 'off';
  var highRes = Number(state.width || 0) * Number(state.height || 0) > 1048576;
  if (mode === 'auto') mode = highRes ? 'smea_dyn' : 'off';
  return { sm: mode === 'smea' || mode === 'smea_dyn', smDyn: mode === 'smea_dyn', decrisper: Boolean(state.decrisper ?? s.image.decrisper) };
}

var ngV051BaseNewStudio = newStudio;
newStudio = function (mode, focus) {
  var state = ngV051BaseNewStudio(mode, focus);
  var s = ngV051EnsureSettings();
  state.smeaMode = s.image.smeaMode;
  state.decrisper = Boolean(s.image.decrisper);
  return state;
};

var ngV051BaseCoreExtendedFields = coreExtendedFields;
coreExtendedFields = function (state) {
  var fields = ngV051BaseCoreExtendedFields(state);
  var flags = ngV051SmeaFlags(state);
  fields.sm = flags.sm;
  fields.sm_dyn = flags.smDyn;
  fields.dynamic_thresholding = flags.decrisper;
  return cleanObject(fields);
};

var ngV051BaseNaiParameters = naiParameters;
naiParameters = function (state) {
  var parameters = ngV051BaseNaiParameters(state);
  var flags = ngV051SmeaFlags(state);
  parameters.sm = flags.sm;
  parameters.sm_dyn = flags.smDyn;
  parameters.dynamic_thresholding = flags.decrisper;
  return cleanObject(parameters);
};

function ngV051Merge(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return target;
  Object.entries(source).forEach(function (entry) {
    var key = entry[0]; var value = entry[1];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
      ngV051Merge(target[key], value);
    } else target[key] = value;
  });
  return target;
}

var ngV051BaseRequestCandidates = requestCandidates;
requestCandidates = function (state) {
  var candidates = ngV051BaseRequestCandidates(state);
  var raw = String(ngV051EnsureSettings().image.extraBody || '').trim();
  if (!raw) return candidates;
  var extra;
  try { extra = JSON.parse(raw); } catch (error) { throw new Error('Advanced provider body must be valid JSON: ' + error.message); }
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error('Advanced provider body must be a JSON object.');
  return candidates.map(function (candidate) { return { name: candidate.name, payload: cleanObject(ngV051Merge(clone(candidate.payload), extra)) }; });
};

var ngV051BaseGenerateState = generateState;
generateState = async function (state, label) {
  var s = ngV051EnsureSettings();
  var originalPrompt = state.prompt; var originalNegative = state.negative;
  var promptParts = [s.image.prefix, originalPrompt, s.image.suffix].map(function (item) { return String(item || '').trim(); }).filter(Boolean);
  var negativeParts = [NG_V051_UC[s.image.negativePreset] || '', s.image.defaultNegative, originalNegative].map(function (item) { return String(item || '').trim(); }).filter(Boolean);
  state.prompt = promptParts.join(', '); state.negative = negativeParts.join(', ');
  state.smeaMode ??= s.image.smeaMode; state.decrisper ??= Boolean(s.image.decrisper);
  try { return await ngV051BaseGenerateState(state, label); }
  finally { state.prompt = originalPrompt; state.negative = originalNegative; }
};

if (typeof ngV040RecentContext === 'function') {
  ngV040RecentContext = function (limit) {
    var s = ngV051EnsureSettings();
    var maxMessages = Math.max(1, Math.min(10, Number(limit || s.roleplay.contextMessages) || 4));
    var perMessage = Math.max(200, Math.min(5000, Number(s.roleplay.perMessageChars) || 1200));
    var total = Math.max(1000, Math.min(30000, Number(s.roleplay.contextChars) || 7000));
    var chat = []; try { chat = Array.isArray(ctx().chat) ? ctx().chat : []; } catch (error) { return ''; }
    var character = characterData(); var user = personaName();
    return chat.filter(function (message) { return message && !message.is_system && message.mes; }).slice(-maxMessages).map(function (message) {
      var speaker = message.is_user ? user : (character.name || 'Character');
      return speaker + ': ' + stripMarkup(message.mes).slice(0, perMessage);
    }).filter(Boolean).join('\n').slice(0, total);
  };
}

if (typeof ngV040ContextPrompt === 'function') {
  var ngV051BaseContextPrompt = ngV040ContextPrompt;
  ngV040ContextPrompt = function (mode) {
    var text = ngV051BaseContextPrompt(mode); var s = ngV051EnsureSettings();
    if (s.roleplay.personaPresence === 'always' && mode !== 'user') text += '\nUser/persona present in scene: ' + personaName() + '.';
    return text.trim();
  };
}

function ngV051SizeOptions() {
  return '<option value="">Additional size preset…</option>' + NG_V051_SIZE_PRESETS.map(function (item) { return '<option value="' + item[0] + '">' + esc(item[1]) + '</option>'; }).join('');
}
function ngV051ParamOptions() {
  return '<option value="">Parameter preset…</option>' + Object.keys(NG_V051_PARAM_PRESETS).map(function (key) { return '<option value="' + key + '">' + esc(NG_V051_PARAM_PRESETS[key][0]) + '</option>'; }).join('');
}
function ngV051ApplySize(target, id) { var item = NG_V051_SIZE_PRESETS.find(function (entry) { return entry[0] === id; }); if (!item) return; target.preset = 'custom'; target.width = item[2]; target.height = item[3]; }
function ngV051ApplyParam(target, id) { var item = NG_V051_PARAM_PRESETS[id]; if (!item) return; target.steps = item[1]; target.guidance = item[2]; target.sampler = item[3]; target.scheduler = item[4]; }

function ngV051DrawerHtml() {
  var s = ngV051EnsureSettings();
  return '<div id="ng-v051-image-tools"><div class="ng-grid ng-grid-2">'
    + field('Additional size preset', '<select id="ng-v051-size" class="text_pole">' + ngV051SizeOptions() + '</select>', 'Keeps the original v0.4 size buttons; these add the larger v0.5 choices.')
    + field('Parameter preset', '<select id="ng-v051-param" class="text_pole">' + ngV051ParamOptions() + '</select>')
    + field('SMEA', '<select id="ng-v051-smea" class="text_pole"><option value="off" ' + (s.image.smeaMode === 'off' ? 'selected' : '') + '>Off</option><option value="auto" ' + (s.image.smeaMode === 'auto' ? 'selected' : '') + '>Auto for high resolution</option><option value="smea" ' + (s.image.smeaMode === 'smea' ? 'selected' : '') + '>SMEA</option><option value="smea_dyn" ' + (s.image.smeaMode === 'smea_dyn' ? 'selected' : '') + '>SMEA DYN</option></select>')
    + '</div><label class="checkbox_label"><input id="ng-v051-decrisper" type="checkbox" ' + (s.image.decrisper ? 'checked' : '') + '><span>Decrisper / dynamic thresholding</span></label>'
    + field('Prompt prefix', '<input id="ng-v051-prefix" class="text_pole" value="' + attr(s.image.prefix) + '" placeholder="Optional global prefix">')
    + field('Prompt suffix', '<input id="ng-v051-suffix" class="text_pole" value="' + attr(s.image.suffix) + '" placeholder="Optional global suffix">')
    + field('Undesired Content preset', '<select id="ng-v051-uc" class="text_pole"><option value="none">None</option><option value="light">Light</option><option value="human">Human Focus</option><option value="heavy">Heavy</option></select>')
    + field('Additional Undesired Content', '<textarea id="ng-v051-negative" class="text_pole" rows="3">' + esc(s.image.defaultNegative) + '</textarea>')
    + field('Advanced provider body', '<textarea id="ng-v051-extra" class="text_pole" rows="4" placeholder="{&quot;some_provider_option&quot;: true}">' + esc(s.image.extraBody) + '</textarea>', 'Optional JSON merged into each provider payload. Leave empty unless your proxy documents an extra field.')
    + '</div>';
}

function ngV051RoleplayHtml() {
  var r = ngV051EnsureSettings().roleplay;
  return '<div id="ng-v051-roleplay-tools"><div class="ng-grid ng-grid-2">'
    + field('Persona presence', '<select id="ng-v051-persona-presence" class="text_pole"><option value="auto" ' + (r.personaPresence === 'auto' ? 'selected' : '') + '>Auto</option><option value="always" ' + (r.personaPresence === 'always' ? 'selected' : '') + '>Always include persona</option><option value="never" ' + (r.personaPresence === 'never' ? 'selected' : '') + '>Never force persona</option></select>')
    + field('Recent messages', '<input id="ng-v051-context-messages" class="text_pole" type="number" min="1" max="10" value="' + Number(r.contextMessages || 4) + '">')
    + field('Characters per message', '<input id="ng-v051-per-message" class="text_pole" type="number" min="200" max="5000" step="100" value="' + Number(r.perMessageChars || 1200) + '">')
    + field('Total context characters', '<input id="ng-v051-total-context" class="text_pole" type="number" min="1000" max="30000" step="500" value="' + Number(r.contextChars || 7000) + '">')
    + '</div></div>';
}

function ngV051SyncOldImageInputs() {
  var s = ngV051EnsureSettings();
  [['ng-width', s.image.width], ['ng-height', s.image.height], ['ng-steps', s.image.steps], ['ng-guidance', s.image.guidance], ['ng-sampler', s.image.sampler], ['ng-scheduler', s.image.scheduler]].forEach(function (pair) {
    var node = document.getElementById(pair[0]); if (node) { node.value = pair[1]; node.dispatchEvent(new Event('change', { bubbles: true })); }
  });
}

function ngV051BindDrawer() {
  var imageRoot = document.querySelector('#ng-image .ng-section-body'); if (imageRoot && !document.getElementById('ng-v051-image-tools')) imageRoot.insertAdjacentHTML('beforeend', ngV051DrawerHtml());
  var roleplayRoot = document.querySelector('#ng-roleplay .ng-section-body'); if (roleplayRoot && !document.getElementById('ng-v051-roleplay-tools')) roleplayRoot.insertAdjacentHTML('beforeend', ngV051RoleplayHtml());
  var featureRoot = document.querySelector('#ng-features .ng-section-body'); if (featureRoot && !document.getElementById('ng-v051-standalone')) featureRoot.insertAdjacentHTML('afterbegin', '<div class="ng-actions" id="ng-v051-standalone"><button class="menu_button" id="ng-v051-open-studio" type="button"><i class="fa-solid fa-image"></i> Open standalone image generator</button></div>');
  var s = ngV051EnsureSettings(); var uc = document.getElementById('ng-v051-uc'); if (uc) uc.value = s.image.negativePreset;
  var bindings = [
    ['ng-v051-size','change',function(e){ngV051ApplySize(s.image,e.currentTarget.value);ngV051SyncOldImageInputs();save();}],
    ['ng-v051-param','change',function(e){ngV051ApplyParam(s.image,e.currentTarget.value);ngV051SyncOldImageInputs();save();}],
    ['ng-v051-smea','change',function(e){s.image.smeaMode=e.currentTarget.value;save();}],
    ['ng-v051-decrisper','change',function(e){s.image.decrisper=e.currentTarget.checked;save();}],
    ['ng-v051-prefix','change',function(e){s.image.prefix=e.currentTarget.value;save();}],
    ['ng-v051-suffix','change',function(e){s.image.suffix=e.currentTarget.value;save();}],
    ['ng-v051-uc','change',function(e){s.image.negativePreset=e.currentTarget.value;save();}],
    ['ng-v051-negative','change',function(e){s.image.defaultNegative=e.currentTarget.value;save();}],
    ['ng-v051-extra','change',function(e){s.image.extraBody=e.currentTarget.value;save();}],
    ['ng-v051-persona-presence','change',function(e){s.roleplay.personaPresence=e.currentTarget.value;save();}],
    ['ng-v051-context-messages','change',function(e){s.roleplay.contextMessages=Math.max(1,Math.min(10,Number(e.currentTarget.value)||4));save();}],
    ['ng-v051-per-message','change',function(e){s.roleplay.perMessageChars=Math.max(200,Math.min(5000,Number(e.currentTarget.value)||1200));save();}],
    ['ng-v051-total-context','change',function(e){s.roleplay.contextChars=Math.max(1000,Math.min(30000,Number(e.currentTarget.value)||7000));save();}],
    ['ng-v051-open-studio','click',function(){openStudio('free','prompt');}],
  ];
  bindings.forEach(function(b){var node=document.getElementById(b[0]);if(node&&node.dataset.ngV051Bound!=='1'){node.dataset.ngV051Bound='1';node.addEventListener(b[1],b[2]);}});
}

function ngV051StudioToolsHtml() {
  return '<div id="ng-v051-studio-tools"><div class="ng-grid ng-grid-2">'
    + field('Additional size preset', '<select id="ng-v051-studio-size" class="text_pole">' + ngV051SizeOptions() + '</select>')
    + field('Parameter preset', '<select id="ng-v051-studio-param" class="text_pole">' + ngV051ParamOptions() + '</select>')
    + field('SMEA', '<select id="ng-v051-studio-smea" class="text_pole"><option value="off">Off</option><option value="auto">Auto for high resolution</option><option value="smea">SMEA</option><option value="smea_dyn">SMEA DYN</option></select>')
    + '</div><label class="checkbox_label"><input id="ng-v051-studio-decrisper" type="checkbox"><span>Decrisper / dynamic thresholding</span></label></div>';
}

function ngV051PatchStudio() {
  if (!studio || !document.getElementById('ng-studio-overlay')) return false;
  ngV051SetVersionLabels();
  var body = document.querySelector('#ng-studio-overlay [data-focus="parameters"] .ng-studio-section-body'); if (!body) return true;
  if (!document.getElementById('ng-v051-studio-tools')) body.insertAdjacentHTML('beforeend', ngV051StudioToolsHtml());
  var size=document.getElementById('ng-v051-studio-size'), param=document.getElementById('ng-v051-studio-param'), smea=document.getElementById('ng-v051-studio-smea'), decrisper=document.getElementById('ng-v051-studio-decrisper');
  if(smea)smea.value=studio.smeaMode||ngV051EnsureSettings().image.smeaMode;if(decrisper)decrisper.checked=Boolean(studio.decrisper??ngV051EnsureSettings().image.decrisper);
  if(size&&size.dataset.bound!=='1'){size.dataset.bound='1';size.addEventListener('change',function(){ngV051ApplySize(studio,size.value);var w=document.getElementById('ng-studio-width'),h=document.getElementById('ng-studio-height');if(w){w.value=studio.width;w.dispatchEvent(new Event('change',{bubbles:true}));}if(h){h.value=studio.height;h.dispatchEvent(new Event('change',{bubbles:true}));}});}
  if(param&&param.dataset.bound!=='1'){param.dataset.bound='1';param.addEventListener('change',function(){ngV051ApplyParam(studio,param.value);[['ng-studio-steps',studio.steps],['ng-studio-guidance',studio.guidance],['ng-studio-sampler',studio.sampler],['ng-studio-scheduler',studio.scheduler]].forEach(function(pair){var node=document.getElementById(pair[0]);if(node){node.value=pair[1];node.dispatchEvent(new Event('change',{bubbles:true}));}});});}
  if(smea&&smea.dataset.bound!=='1'){smea.dataset.bound='1';smea.addEventListener('change',function(){studio.smeaMode=smea.value;});}
  if(decrisper&&decrisper.dataset.bound!=='1'){decrisper.dataset.bound='1';decrisper.addEventListener('change',function(){studio.decrisper=decrisper.checked;});}
  return true;
}

var ngV051BaseOpenStudio = openStudio;
openStudio = function (mode, focus) { ngV051BaseOpenStudio(mode, focus); setTimeout(ngV051PatchStudio, 0); };

ngV051EnsureSettings();
var ngV051Attempts = 0;
var ngV051Timer = setInterval(function () {
  ngV051Attempts += 1; ngV051SetVersionLabels(); ngV051BindDrawer(); ngV051PatchStudio();
  if ((document.getElementById('ng-settings') && document.getElementById('ng-wand-image')) || ngV051Attempts >= 50) clearInterval(ngV051Timer);
}, 250);


/* ===== Runtime 13: mobile viewer, saving, and size tools ===== */
// Novel Generation v0.5.2 — mobile image viewer, reliable save actions,
// custom-size scaler/ratio tools, and responsive Studio refinements.
// Loaded after v0.5.1 so the restored classic UI and all previous features remain intact.

var NG_V052_RELEASE = VERSION;

function ngV052IsIOS() {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent || '')
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function ngV052EnsureSettings() {
  var s = typeof ngV051EnsureSettings === 'function' ? ngV051EnsureSettings() : settings();
  s.image.sizeSnap ??= true;
  s.image.sizeLock ??= true;
  return s;
}

function ngV052SetVersionLabels() {
  document.querySelectorAll('#ng-settings .ng-version').forEach(function (node) {
    node.textContent = 'v' + NG_V052_RELEASE;
  });
  document.querySelectorAll('#ng-studio-overlay .ng-studio-title small').forEach(function (node) {
    var modeText = String(node.textContent || '').replace(/^v\d+(?:\.\d+){1,2}\s*[·-]?\s*/i, '').trim();
    if (!modeText || /^v\d/i.test(modeText)) modeText = studio?.mode ? String(studio.mode) : '';
    node.textContent = 'v' + NG_V052_RELEASE + (modeText ? ' · ' + modeText : '');
  });
}

if (typeof ngV051SetVersionLabels === 'function') {
  ngV051SetVersionLabels = ngV052SetVersionLabels;
}

function ngV052Filename(index) {
  var suffix = Number(index || 0) + 1;
  return 'novel-generation-' + Date.now() + '-' + suffix + '.png';
}

async function ngV052BlobFromImage(src) {
  var normalized = norm(src);
  if (!normalized) throw new Error('Image source is empty.');
  var response = await fetch(normalized, { credentials: normalized.startsWith('/') ? 'same-origin' : 'omit' });
  if (!response.ok) throw new Error('Could not read image: HTTP ' + response.status);
  return await response.blob();
}

function ngV052Extension(type) {
  if (/jpe?g/i.test(type || '')) return 'jpg';
  if (/webp/i.test(type || '')) return 'webp';
  return 'png';
}

async function ngV052SaveImage(src, filename) {
  var blob;
  try {
    blob = await ngV052BlobFromImage(src);
  } catch (error) {
    toast('warning', 'Direct download is unavailable for this image. Open it here and press/hold the image to save it.');
    return false;
  }

  var ext = ngV052Extension(blob.type);
  var safeName = String(filename || ('novel-generation-' + Date.now() + '.' + ext))
    .replace(/\.(png|jpe?g|webp)$/i, '') + '.' + ext;
  var file = new File([blob], safeName, { type: blob.type || 'image/png' });

  // iOS Safari is much more reliable when handing an image file to the
  // native share sheet than when using an <a download> blob URL.
  if (ngV052IsIOS() && navigator.share && navigator.canShare) {
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Novel Generation image' });
        return true;
      }
    } catch (error) {
      if (error?.name === 'AbortError') return false;
      console.debug('[Novel Generation] iOS file share fallback', error);
    }
  }

  try {
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safeName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(function () {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 1500);
    return true;
  } catch (error) {
    toast('warning', 'Your browser blocked the download. Press/hold the image in the full viewer to save it.');
    return false;
  }
}

function ngV052CloseViewer() {
  var viewer = document.getElementById('ng-image-viewer');
  if (!viewer) return;
  var handler = viewer._ngEscapeHandler;
  if (handler) document.removeEventListener('keydown', handler);
  viewer.remove();
  document.body?.classList.remove('ng-image-viewer-open');
}

function ngV052OpenViewer(src, meta) {
  ngV052CloseViewer();
  var info = meta || {};
  var overlay = document.createElement('div');
  overlay.id = 'ng-image-viewer';
  overlay.className = 'ng-image-viewer';
  overlay.innerHTML = '<div class="ng-image-viewer-dialog" role="dialog" aria-modal="true">'
    + '<header><div><strong>Original image</strong><small>'
    + esc([info.model, info.width && info.height ? info.width + ' × ' + info.height : ''].filter(Boolean).join(' · '))
    + '</small></div><button class="menu_button ng-image-viewer-close" type="button" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></header>'
    + '<div class="ng-image-viewer-stage"><img src="' + attr(src) + '" alt="Generated image"></div>'
    + '<footer>'
    + '<button class="menu_button ng-image-viewer-save" type="button"><i class="fa-solid fa-download"></i> Save</button>'
    + (studio ? '<button class="menu_button ng-image-viewer-source" type="button"><i class="fa-solid fa-image"></i> Use as source</button>' : '')
    + '<small>On iPhone/iPad, Save uses the native share sheet when available. You can also press and hold the full image.</small>'
    + '</footer></div>';

  document.documentElement.appendChild(overlay);
  document.body?.classList.add('ng-image-viewer-open');

  overlay.addEventListener('pointerdown', function (event) {
    if (event.target === overlay) ngV052CloseViewer();
  });
  overlay.querySelector('.ng-image-viewer-close')?.addEventListener('click', ngV052CloseViewer);
  overlay.querySelector('.ng-image-viewer-save')?.addEventListener('click', async function () {
    await ngV052SaveImage(src, info.filename || ('novel-generation-' + Date.now() + '.png'));
  });
  overlay.querySelector('.ng-image-viewer-source')?.addEventListener('click', async function () {
    var ref = await refFromSrc(src, 'viewer-source.png');
    if (!ref) return;
    setStudioSource(ref);
    ngV052CloseViewer();
    openStudioSection('edit');
  });

  var escape = function (event) {
    if (event.key === 'Escape') ngV052CloseViewer();
  };
  overlay._ngEscapeHandler = escape;
  document.addEventListener('keydown', escape);
}

function generatedActions(src, index) {
  return '<div class="ng-generated-actions">'
    + '<button class="menu_button ng-view-image" data-src-index="' + index + '" type="button"><i class="fa-solid fa-expand"></i> View</button>'
    + '<button class="menu_button ng-save-image" data-src-index="' + index + '" type="button"><i class="fa-solid fa-download"></i> Save</button>'
    + '<button class="menu_button ng-use-source" data-src-index="' + index + '" type="button"><i class="fa-solid fa-image"></i> Use as source</button>'
    + '<button class="menu_button ng-use-inpaint" data-src-index="' + index + '" type="button"><i class="fa-solid fa-paintbrush"></i> Inpaint</button>'
    + '<button class="menu_button ng-use-vibe" data-src-index="' + index + '" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Vibe</button>'
    + '<button class="menu_button ng-use-precise" data-src-index="' + index + '" type="button"><i class="fa-solid fa-id-card-clip"></i> Precise</button>'
    + '<button class="menu_button ng-send-chat" data-src-index="' + index + '" type="button"><i class="fa-solid fa-comment"></i> Send to chat</button>'
    + '</div>';
}

function showImages(images) {
  var preview = document.getElementById('ng-preview');
  if (!preview) return;
  studio.generated = images;
  preview.innerHTML = '<div class="ng-generated-grid">' + images.map(function (src, index) {
    return '<figure class="ng-generated-card"><button class="ng-image-tap-target" data-src-index="' + index + '" type="button" aria-label="View full image">'
      + '<img class="ng-viewable-image" src="' + attr(src) + '" alt="Generated image"></button><figcaption>'
      + generatedActions(src, index) + '</figcaption></figure>';
  }).join('') + '</div>';
  bindGeneratedActions(preview, images, images.map(function () {
    return { prompt: studio?.prompt || '', model: settings().model, width: studio?.width, height: studio?.height };
  }));
}

function renderGallery() {
  var grid = document.getElementById('ng-gallery-grid');
  if (!grid) return;
  if (!gallery.length) {
    grid.innerHTML = '<div class="ng-preview-empty"><i class="fa-regular fa-images"></i><strong>No images yet</strong><span>Successful generations appear here.</span></div>';
    return;
  }
  var images = gallery.map(function (item) { return item.src; });
  grid.innerHTML = gallery.map(function (item, index) {
    return '<article class="ng-gallery-item">'
      + '<button class="ng-image-tap-target ng-gallery-image-button" data-src-index="' + index + '" type="button" aria-label="View full image">'
      + '<img class="ng-viewable-image" src="' + attr(item.src) + '" alt="Gallery image"></button>'
      + '<div><strong>' + esc(item.model) + '</strong><small>' + item.width + ' × ' + item.height + '</small></div>'
      + generatedActions(item.src, index) + '</article>';
  }).join('');
  bindGeneratedActions(grid, images, gallery);
}

function bindGeneratedActions(root, images, metadata) {
  var data = Array.isArray(metadata) ? metadata : [];

  function getIndex(node) {
    return Math.max(0, Number(node.dataset.srcIndex) || 0);
  }
  function metaFor(index) {
    return data[index] || {};
  }

  root.querySelectorAll('.ng-view-image, .ng-image-tap-target').forEach(function (button) {
    button.addEventListener('click', function () {
      var index = getIndex(button);
      ngV052OpenViewer(images[index], { ...metaFor(index), filename: ngV052Filename(index) });
    });
  });

  root.querySelectorAll('.ng-save-image').forEach(function (button) {
    button.addEventListener('click', async function () {
      var index = getIndex(button);
      await ngV052SaveImage(images[index], ngV052Filename(index));
    });
  });

  root.querySelectorAll('.ng-use-source').forEach(function (button) {
    button.addEventListener('click', async function () {
      var index = getIndex(button);
      var ref = await refFromSrc(images[index], 'generated-source.png');
      if (ref) setStudioSource(ref);
      openStudioSection('edit');
    });
  });

  root.querySelectorAll('.ng-use-inpaint').forEach(function (button) {
    button.addEventListener('click', async function () {
      var index = getIndex(button);
      var ref = await refFromSrc(images[index], 'generated-inpaint.png');
      if (!ref) return;
      setStudioSource(ref);
      studio.editMode = 'inpaint';
      var select = document.getElementById('ng-edit-mode');
      if (select) select.value = 'inpaint';
      openStudioSection('edit');
      refreshMaskEditor();
    });
  });

  root.querySelectorAll('.ng-use-vibe').forEach(function (button) {
    button.addEventListener('click', async function () {
      if (studio.precise.length) return toast('warning', 'Remove Precise Reference before using Vibe Transfer.');
      var index = getIndex(button);
      var ref = await refFromSrc(images[index], 'generated-vibe.png');
      if (!ref) return;
      studio.vibes.push({ ...ref, strength: 0.6, information: 1 });
      normalizeVibes(false);
      renderRefs('vibe');
      openStudioSection('vibe');
    });
  });

  root.querySelectorAll('.ng-use-precise').forEach(function (button) {
    button.addEventListener('click', async function () {
      if (studio.vibes.length) return toast('warning', 'Remove Vibe Transfer before using Precise Reference.');
      var index = getIndex(button);
      var ref = await refFromSrc(images[index], 'generated-precise.png');
      if (!ref) return;
      studio.precise.push({ ...ref, type: 'character', strength: 1, fidelity: 1 });
      renderRefs('precise');
      openStudioSection('precise');
    });
  });

  root.querySelectorAll('.ng-send-chat').forEach(function (button) {
    button.addEventListener('click', async function () {
      var index = getIndex(button);
      try {
        await insertImagesIntoChat([images[index]], metaFor(index).prompt || studio?.prompt || '');
        toast('success', 'Image inserted into chat.');
      } catch (error) {
        toast('error', error.message);
      }
    });
  });
}

function ngV052Snap(value) {
  var number = Math.max(64, Number(value) || 64);
  return Math.max(64, Math.round(number / 64) * 64);
}

function ngV052Gcd(a, b) {
  a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));
  while (b) { var temp = b; b = a % b; a = temp; }
  return a || 1;
}

function ngV052SizeText(width, height) {
  var w = Math.max(1, Math.round(width || 1));
  var h = Math.max(1, Math.round(height || 1));
  var gcd = ngV052Gcd(w, h);
  var mp = (w * h / 1000000).toFixed(2);
  return w + ' × ' + h + ' · ' + (w / gcd) + ':' + (h / gcd) + ' · ' + mp + ' MP';
}

function ngV052SyncSizeInputs(prefix, target, width, height) {
  var w = document.getElementById(prefix + '-width');
  var h = document.getElementById(prefix + '-height');
  target.preset = 'custom';
  target.width = width;
  target.height = height;
  if (w) { w.value = width; w.dispatchEvent(new Event('input', { bubbles: true })); }
  if (h) { h.value = height; h.dispatchEvent(new Event('input', { bubbles: true })); }
  if (prefix === 'ng') save();
}

function ngV052AttachSizeTools(prefix, targetGetter) {
  var custom = document.querySelector('[data-ng-custom="' + prefix + '"]');
  if (!custom || custom.querySelector('.ng-v052-size-tools')) return;
  var target = targetGetter();
  if (!target) return;

  var s = ngV052EnsureSettings();
  var ratio = Math.max(0.01, Number(target.width || 832) / Math.max(1, Number(target.height || 1216)));

  var tools = document.createElement('div');
  tools.className = 'ng-v052-size-tools';
  tools.dataset.ngRatio = String(ratio);
  tools.innerHTML = '<div class="ng-v052-size-toolbar">'
    + '<label class="checkbox_label"><input class="ng-v052-lock" type="checkbox" ' + (s.image.sizeLock ? 'checked' : '') + '><span>Keep ratio</span></label>'
    + '<label class="checkbox_label"><input class="ng-v052-snap" type="checkbox" ' + (s.image.sizeSnap ? 'checked' : '') + '><span>Snap to 64</span></label>'
    + '<button class="menu_button ng-v052-swap" type="button"><i class="fa-solid fa-repeat"></i> Swap</button>'
    + '</div>'
    + '<label class="ng-v052-scale-row"><span>Size scaler <output>100%</output></span><input class="ng-v052-scale" type="range" min="50" max="200" step="5" value="100"></label>'
    + '<div class="ng-v052-size-info"></div>';
  custom.appendChild(tools);

  var widthInput = document.getElementById(prefix + '-width');
  var heightInput = document.getElementById(prefix + '-height');
  var lock = tools.querySelector('.ng-v052-lock');
  var snap = tools.querySelector('.ng-v052-snap');
  var swap = tools.querySelector('.ng-v052-swap');
  var scale = tools.querySelector('.ng-v052-scale');
  var output = tools.querySelector('.ng-v052-scale-row output');
  var info = tools.querySelector('.ng-v052-size-info');

  function currentTarget() { return targetGetter(); }
  function currentRatio() { return Math.max(0.01, Number(tools.dataset.ngRatio) || ratio); }
  function shouldSnap() { return Boolean(snap?.checked); }
  function updateInfo() {
    var live = currentTarget();
    if (info && live) info.textContent = ngV052SizeText(live.width, live.height);
  }
  function finalize(changed) {
    var live = currentTarget();
    if (!live || !widthInput || !heightInput) return;
    var w = Number(widthInput.value) || Number(live.width) || 832;
    var h = Number(heightInput.value) || Number(live.height) || 1216;
    var r = currentRatio();

    if (changed === 'width') {
      if (shouldSnap()) w = ngV052Snap(w);
      if (lock?.checked) h = shouldSnap() ? ngV052Snap(w / r) : Math.max(64, Math.round(w / r));
      else if (shouldSnap()) h = ngV052Snap(h);
    } else {
      if (shouldSnap()) h = ngV052Snap(h);
      if (lock?.checked) w = shouldSnap() ? ngV052Snap(h * r) : Math.max(64, Math.round(h * r));
      else if (shouldSnap()) w = ngV052Snap(w);
    }

    ngV052SyncSizeInputs(prefix, live, w, h);
    if (!lock?.checked) tools.dataset.ngRatio = String(Math.max(0.01, w / Math.max(1, h)));
    tools.dataset.baseWidth = String(w);
    tools.dataset.baseHeight = String(h);
    updateInfo();
  }

  widthInput?.addEventListener('change', function () { finalize('width'); });
  heightInput?.addEventListener('change', function () { finalize('height'); });

  lock?.addEventListener('change', function () {
    s.image.sizeLock = lock.checked;
    var live = currentTarget();
    if (live) tools.dataset.ngRatio = String(Math.max(0.01, live.width / Math.max(1, live.height)));
    save();
  });
  snap?.addEventListener('change', function () {
    s.image.sizeSnap = snap.checked;
    save();
    finalize('width');
  });

  swap?.addEventListener('click', function () {
    var live = currentTarget();
    if (!live) return;
    var w = Number(live.height) || 1216;
    var h = Number(live.width) || 832;
    if (shouldSnap()) { w = ngV052Snap(w); h = ngV052Snap(h); }
    tools.dataset.ngRatio = String(Math.max(0.01, w / Math.max(1, h)));
    ngV052SyncSizeInputs(prefix, live, w, h);
    tools.dataset.baseWidth = String(w);
    tools.dataset.baseHeight = String(h);
    updateInfo();
  });

  function captureBase() {
    var live = currentTarget();
    if (!live) return;
    tools.dataset.baseWidth = String(Number(live.width) || 832);
    tools.dataset.baseHeight = String(Number(live.height) || 1216);
  }
  scale?.addEventListener('pointerdown', captureBase);
  scale?.addEventListener('touchstart', captureBase, { passive: true });
  scale?.addEventListener('focus', function () {
    if (!tools.dataset.baseWidth) captureBase();
  });
  scale?.addEventListener('input', function () {
    var live = currentTarget();
    if (!live) return;
    var factor = Math.max(0.5, Math.min(2, Number(scale.value || 100) / 100));
    var baseW = Number(tools.dataset.baseWidth) || Number(live.width) || 832;
    var baseH = Number(tools.dataset.baseHeight) || Number(live.height) || 1216;
    var w = baseW * factor;
    var h = baseH * factor;
    if (shouldSnap()) { w = ngV052Snap(w); h = ngV052Snap(h); }
    else { w = Math.max(64, Math.round(w)); h = Math.max(64, Math.round(h)); }
    if (output) output.textContent = Math.round(factor * 100) + '%';
    ngV052SyncSizeInputs(prefix, live, w, h);
    updateInfo();
  });
  scale?.addEventListener('change', function () {
    var live = currentTarget();
    if (live) {
      tools.dataset.baseWidth = String(live.width);
      tools.dataset.baseHeight = String(live.height);
      tools.dataset.ngRatio = String(Math.max(0.01, live.width / Math.max(1, live.height)));
    }
    if (scale) scale.value = '100';
    if (output) output.textContent = '100%';
  });

  tools.dataset.baseWidth = String(Number(target.width) || 832);
  tools.dataset.baseHeight = String(Number(target.height) || 1216);
  updateInfo();
}

function ngV052PatchSizes() {
  ngV052AttachSizeTools('ng', function () { return ngV052EnsureSettings().image; });
  ngV052AttachSizeTools('ng-studio', function () { return studio; });
}

var ngV052BaseOpenStudio = openStudio;
openStudio = function (mode, focus) {
  ngV052BaseOpenStudio(mode, focus);
  setTimeout(function () {
    ngV052SetVersionLabels();
    ngV052PatchSizes();
  }, 0);
};

ngV052EnsureSettings();
ngV052SetVersionLabels();
ngV052PatchSizes();

var ngV052Attempts = 0;
var ngV052Timer = setInterval(function () {
  ngV052Attempts += 1;
  ngV052SetVersionLabels();
  ngV052PatchSizes();
  if ((document.getElementById('ng-settings') && document.getElementById('ng-wand-image')) || ngV052Attempts >= 50) {
    clearInterval(ngV052Timer);
  }
}, 250);


/* ===== Runtime 14: weighted prompt visualization ===== */
// Novel Generation v0.5.4 — weighted NovelAI prompt visualization.
// Loaded after v0.5.2 so all previous generation, gallery, size and mobile features remain intact.

var NG_V053_RELEASE = VERSION;

function ngV053EscapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ngV053WeightStyle(weight) {
  var amount = Math.min(6, Math.abs(Number(weight) || 0));
  var power = amount <= 0 ? 0 : Math.min(1, Math.log2(1 + amount) / Math.log2(7));
  var blur = (3 + power * 9).toFixed(1) + 'px';
  var glowAlpha = (0.16 + power * 0.28).toFixed(3);
  var backgroundAlpha = (0.02 + power * 0.08).toFixed(3);
  var edgeAlpha = (0.08 + power * 0.16).toFixed(3);
  var positive = Number(weight) >= 0;
  return {
    cls: positive ? 'is-positive' : 'is-negative',
    style: positive
      ? '--ng-weight-blur:' + blur + ';--ng-weight-glow:rgba(255,187,84,' + glowAlpha + ');--ng-weight-bg:rgba(255,166,61,' + backgroundAlpha + ');--ng-weight-edge:rgba(255,198,112,' + edgeAlpha + ');'
      : '--ng-weight-blur:' + blur + ';--ng-weight-glow:rgba(93,185,255,' + glowAlpha + ');--ng-weight-bg:rgba(67,149,255,' + backgroundAlpha + ');--ng-weight-edge:rgba(123,205,255,' + edgeAlpha + ');'
  };
}

function ngV053HighlightWeightedPrompt(value) {
  var text = String(value ?? '');
  var pattern = /(-?(?:\d+(?:\.\d+)?|\.\d+))::([^\n]*?)::/g;
  var html = '';
  var cursor = 0;
  var match;

  while ((match = pattern.exec(text))) {
    html += ngV053EscapeHtml(text.slice(cursor, match.index));
    var weight = Number(match[1]);
    var visual = ngV053WeightStyle(weight);
    html += '<span class="ng-weight-token ' + visual.cls + '" style="' + visual.style + '">'
      + '<span class="ng-weight-number">' + ngV053EscapeHtml(match[1]) + '</span>'
      + '<span class="ng-weight-delimiter">::</span>'
      + '<span class="ng-weight-tag">' + ngV053EscapeHtml(match[2]) + '</span>'
      + '<span class="ng-weight-delimiter">::</span>'
      + '</span>';
    cursor = pattern.lastIndex;
  }

  html += ngV053EscapeHtml(text.slice(cursor));
  return html + '\n';
}

function ngV053CopyEditorMetrics(textarea, mirror) {
  if (!textarea || !mirror) return;
  var computed = getComputedStyle(textarea);
  mirror.style.fontFamily = computed.fontFamily;
  mirror.style.fontSize = computed.fontSize;
  mirror.style.fontWeight = computed.fontWeight;
  mirror.style.fontStyle = computed.fontStyle;
  mirror.style.letterSpacing = computed.letterSpacing;
  mirror.style.lineHeight = computed.lineHeight;
  mirror.style.textAlign = computed.textAlign;
  mirror.style.textIndent = computed.textIndent;
  mirror.style.textTransform = computed.textTransform;
  mirror.style.tabSize = computed.tabSize || '8';
  mirror.style.paddingTop = computed.paddingTop;
  mirror.style.paddingRight = computed.paddingRight;
  mirror.style.paddingBottom = computed.paddingBottom;
  mirror.style.paddingLeft = computed.paddingLeft;
  mirror.style.borderTopWidth = computed.borderTopWidth;
  mirror.style.borderRightWidth = computed.borderRightWidth;
  mirror.style.borderBottomWidth = computed.borderBottomWidth;
  mirror.style.borderLeftWidth = computed.borderLeftWidth;
  mirror.style.borderStyle = 'solid';
  mirror.style.borderColor = 'transparent';
  mirror.style.borderRadius = computed.borderRadius;
  mirror.style.backgroundColor = computed.backgroundColor;
  mirror.style.backgroundImage = computed.backgroundImage;
  mirror.style.backgroundPosition = computed.backgroundPosition;
  mirror.style.backgroundSize = computed.backgroundSize;
}

function ngV053SyncEditor(textarea) {
  var state = textarea?._ngV053WeightEditor;
  if (!state) return;
  state.text.innerHTML = ngV053HighlightWeightedPrompt(textarea.value);
  state.text.style.transform = 'translate(' + (-textarea.scrollLeft) + 'px,' + (-textarea.scrollTop) + 'px)';
}

function ngV053AttachWeightedEditor(textarea) {
  if (!textarea || textarea._ngV053WeightEditor || !textarea.parentNode) return;

  var wrapper = document.createElement('div');
  wrapper.className = 'ng-weight-editor';
  var mirror = document.createElement('div');
  mirror.className = 'ng-weight-mirror';
  mirror.setAttribute('aria-hidden', 'true');
  var text = document.createElement('div');
  text.className = 'ng-weight-mirror-text';
  mirror.appendChild(text);

  textarea.parentNode.insertBefore(wrapper, textarea);
  wrapper.appendChild(mirror);
  wrapper.appendChild(textarea);
  textarea.classList.add('ng-weight-textarea');

  textarea._ngV053WeightEditor = { wrapper: wrapper, mirror: mirror, text: text };
  ngV053CopyEditorMetrics(textarea, mirror);
  ngV053SyncEditor(textarea);

  textarea.addEventListener('input', function () { ngV053SyncEditor(textarea); });
  textarea.addEventListener('scroll', function () { ngV053SyncEditor(textarea); }, { passive: true });
  textarea.addEventListener('focus', function () {
    ngV053CopyEditorMetrics(textarea, mirror);
    ngV053SyncEditor(textarea);
  });
  textarea.addEventListener('blur', function () {
    ngV053CopyEditorMetrics(textarea, mirror);
    ngV053SyncEditor(textarea);
  });

  if (textarea.id === 'ng-prompt') {
    var hint = document.createElement('small');
    hint.className = 'ng-weight-hint';
    hint.innerHTML = '<span class="ng-weight-hint-positive">1.5::tag:: stronger</span><span>1.0 is neutral · 0.5 weakens</span><span class="ng-weight-hint-negative">-1::tag:: targeted removal / inversion</span><span>Glow increases with magnitude and is capped for readability.</span><span class="ng-weight-edit-note">While typing, the glow pauses so mobile cursor and text selection stay precise.</span>';
    wrapper.insertAdjacentElement('afterend', hint);
  }
}

function ngV053RefreshWeightedEditors() {
  document.querySelectorAll('#ng-studio-overlay textarea.text_pole').forEach(ngV053AttachWeightedEditor);
  document.querySelectorAll('#ng-studio-overlay textarea.ng-weight-textarea').forEach(ngV053SyncEditor);
}

function ngV053SetVersionLabels() {
  document.querySelectorAll('#ng-settings .ng-version').forEach(function (node) {
    node.textContent = 'v' + NG_V053_RELEASE;
  });
  document.querySelectorAll('#ng-studio-overlay .ng-studio-title small').forEach(function (node) {
    var current = String(node.textContent || '').replace(/^v\d+(?:\.\d+){1,2}\s*[·-]?\s*/i, '').trim();
    if (!current || /^v\d/i.test(current)) current = studio?.mode ? String(studio.mode) : '';
    node.textContent = 'v' + NG_V053_RELEASE + (current ? ' · ' + current : '');
  });
}

var ngV053BaseOpenStudio = openStudio;
openStudio = function (mode, focus) {
  ngV053BaseOpenStudio(mode, focus);
  setTimeout(function () {
    ngV053SetVersionLabels();
    ngV053RefreshWeightedEditors();
    var overlay = document.getElementById('ng-studio-overlay');
    if (overlay && !overlay.dataset.ngWeightRefreshBound) {
      overlay.dataset.ngWeightRefreshBound = '1';
      overlay.addEventListener('click', function () {
        setTimeout(ngV053RefreshWeightedEditors, 0);
      });
    }
  }, 0);
};

if (typeof renderCharacters === 'function') {
  var ngV053BaseRenderCharacters = renderCharacters;
  renderCharacters = function () {
    var result = ngV053BaseRenderCharacters.apply(this, arguments);
    setTimeout(ngV053RefreshWeightedEditors, 0);
    return result;
  };
}

ngV053SetVersionLabels();
ngV053RefreshWeightedEditors();


/* ===== Runtime 15: mobile workspace and AI Prompt Helper ===== */
// Novel Generation v0.5.5 — mobile workspace + AI Prompt Helper.
var NG_V055_RELEASE = VERSION;

function ngV055IsMobile() {
  return isMobileStudioEnvironment();
}

function ngV055Prefs() {
  var prefs = typeof ngV040Prefs === 'function' ? ngV040Prefs() : (settings().promptAssistant ??= {});
  if (!('aiHelperQuality' in prefs)) prefs.aiHelperQuality = true;
  if (!('aiHelperArtists' in prefs)) prefs.aiHelperArtists = true;
  if (!('aiHelperSuggestions' in prefs)) prefs.aiHelperSuggestions = false;
  return prefs;
}

function ngV055SetVersionLabels() {
  document.querySelectorAll('#ng-settings .ng-version').forEach(function (node) { node.textContent = 'v' + NG_V055_RELEASE; });
  document.querySelectorAll('#ng-studio-overlay .ng-studio-title small').forEach(function (node) {
    var current = String(node.textContent || '').replace(/^v\d+(?:\.\d+){1,2}\s*[·-]?\s*/i, '').trim();
    if (!current || /^v\d/i.test(current)) current = studio?.mode ? String(studio.mode) : '';
    node.textContent = 'v' + NG_V055_RELEASE + (current ? ' · ' + current : '');
  });
}

function ngV055ActiveTab() {
  return document.querySelector('#ng-studio-overlay [data-tab].is-active')?.dataset?.tab || 'generate';
}

function ngV055SyncMobileNav() {
  var overlay = document.getElementById('ng-studio-overlay');
  if (!overlay) return;
  var pane = overlay.dataset.ngMobilePane || 'controls';
  var tab = ngV055ActiveTab();
  overlay.querySelectorAll('.ng-v055-mobile-nav button').forEach(function (button) {
    var active = button.dataset.mobilePane === 'preview'
      ? pane === 'preview'
      : pane === 'controls' && button.dataset.tab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function ngV055SetMobilePane(mode) {
  var overlay = document.getElementById('ng-studio-overlay');
  if (!overlay || !ngV055IsMobile()) return;
  var next = mode === 'preview' ? 'preview' : 'controls';
  overlay.dataset.ngMobilePane = next;
  if (next === 'preview') {
    overlay.querySelectorAll('.ng-studio-controls details.ng-studio-section[open]').forEach(function (details) { details.open = false; });
    try { document.activeElement?.blur?.(); } catch {}
  }
  ngV055SyncMobileNav();
  var scroller = next === 'preview' ? document.getElementById('ng-preview') : overlay.querySelector('.ng-studio-controls');
  if (scroller) scroller.scrollTop = 0;
}

function ngV055InjectMobileNav() {
  var overlay = document.getElementById('ng-studio-overlay');
  var header = overlay?.querySelector('.ng-studio-header');
  if (!overlay || !header || overlay.querySelector('.ng-v055-mobile-nav')) return;
  var nav = document.createElement('nav');
  nav.className = 'ng-v055-mobile-nav';
  nav.setAttribute('aria-label', 'Novel Gen mobile workspace');
  nav.innerHTML = '<button class="menu_button" type="button" data-mobile-pane="preview"><i class="fa-regular fa-image"></i><span>Image</span></button>'
    + '<button class="menu_button" type="button" data-mobile-pane="controls" data-tab="generate"><i class="fa-solid fa-wand-magic-sparkles"></i><span>Generate</span></button>'
    + '<button class="menu_button" type="button" data-mobile-pane="controls" data-tab="gallery"><i class="fa-solid fa-images"></i><span>Gallery</span></button>';
  header.insertAdjacentElement('afterend', nav);
  nav.querySelector('[data-mobile-pane="preview"]')?.addEventListener('click', function () { ngV055SetMobilePane('preview'); });
  nav.querySelector('[data-tab="generate"]')?.addEventListener('click', function () { switchTab('generate'); ngV055SetMobilePane('controls'); });
  nav.querySelector('[data-tab="gallery"]')?.addEventListener('click', function () { switchTab('gallery'); ngV055SetMobilePane('controls'); });
}

function ngV055BindMobileAccordions() {
  var controls = document.querySelector('#ng-studio-overlay .ng-studio-controls');
  if (!controls || controls.dataset.ngV055AccordionBound) return;
  controls.dataset.ngV055AccordionBound = '1';
  controls.querySelectorAll('details.ng-studio-section').forEach(function (details) {
    details.addEventListener('toggle', function () {
      if (!ngV055IsMobile() || !details.open) return;
      ngV055SetMobilePane('controls');
      controls.querySelectorAll('details.ng-studio-section[open]').forEach(function (other) { if (other !== details) other.open = false; });
    });
  });
}

function ngV055ExtractAiFinal(raw, preferTags) {
  function readValue(value, allowReasoning, depth, seen) {
    if (value == null || depth > 7) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
      return value.map(function (item) { return readValue(item, allowReasoning, depth + 1, seen); }).filter(Boolean).join('\n').trim();
    }
    if (typeof value !== 'object' || seen.has(value)) return '';
    seen.add(value);

    var preferred = ['final_answer', 'final', 'output_text', 'content', 'text', 'response', 'result', 'answer', 'message', 'output', 'choices'];
    for (var i = 0; i < preferred.length; i += 1) {
      if (!(preferred[i] in value)) continue;
      var visible = readValue(value[preferred[i]], allowReasoning, depth + 1, seen);
      if (visible) return visible;
    }
    if (allowReasoning) {
      var reasoning = ['reasoning_content', 'thoughts', 'thinking', 'reasoning', 'analysis', 'planning'];
      for (var j = 0; j < reasoning.length; j += 1) {
        if (!(reasoning[j] in value)) continue;
        var hidden = readValue(value[reasoning[j]], true, depth + 1, seen);
        if (hidden) return hidden;
      }
    }
    return '';
  }

  function tidy(value) {
    return String(value || '')
      .replace(/^\s*\x60\x60\x60(?:\w+)?\s*/i, '')
      .replace(/\s*\x60\x60\x60\s*$/i, '')
      .replace(/<\/?(?:think|thinking|thoughts|planning|analysis|reasoning)\b[^>]*>/gi, '')
      .replace(/<\/?(?:final|answer|output)\b[^>]*>/gi, '')
      .replace(/<\|(?:final|assistant|output)\|>/gi, '')
      .trim();
  }

  function explicitFinal(value) {
    var text = String(value || '');
    var blocks = Array.from(text.matchAll(/<(?:final|answer|output)\b[^>]*>([\s\S]*?)<\/(?:final|answer|output)>/gi));
    if (blocks.length) return tidy(blocks[blocks.length - 1][1]);
    var markers = Array.from(text.matchAll(/(?:^|\n)\s*(?:final(?:\s+(?:answer|output|prompt|tags?))?|answer|output|prompt|tags?)\s*:\s*/gim));
    if (markers.length) {
      var marker = markers[markers.length - 1];
      return tidy(text.slice((marker.index || 0) + marker[0].length));
    }
    return '';
  }

  function salvage(value) {
    var text = tidy(value);
    if (!text) return '';
    var marked = explicitFinal(text);
    if (marked) return marked;

    var lines = text.split(/\n+/).map(function (line) {
      return line.trim().replace(/^[•*-]\s*/, '');
    }).filter(Boolean);
    var useful = lines.filter(function (line) {
      return !/^(?:we need|i need|i should|let(?:'s| us)|first(?:ly)?|next|then|the user|analysis|reasoning|plan(?:ning)?|thoughts?|thinking|consider|need to|task:)/i.test(line);
    });
    if (!useful.length) useful = lines;
    if (!useful.length) return '';

    if (preferTags) {
      for (var i = useful.length - 1; i >= 0; i -= 1) {
        if ((useful[i].match(/,/g) || []).length >= 2) return tidy(useful[i]);
      }
    }
    return tidy(useful[useful.length - 1]);
  }

  var source = readValue(raw, false, 0, new Set()) || readValue(raw, true, 0, new Set());
  if (!source) return '';

  var directFinal = explicitFinal(source);
  if (directFinal) return directFinal;

  var hidden = [];
  var visible = String(source);
  visible = visible.replace(/<\|(?:analysis|reasoning|thinking|thoughts|planning)\|>([\s\S]*?)(?=<\|(?:final|assistant|output)\|>|$)/gi, function (_match, body) {
    hidden.push(body);
    return '\n';
  });
  visible = visible.replace(/<(think|thinking|thoughts|planning|analysis|reasoning)\b[^>]*>([\s\S]*?)<\/\1>/gi, function (_match, _name, body) {
    hidden.push(body);
    return '\n';
  });

  var dangling = /<(think|thinking|thoughts|planning|analysis|reasoning)\b[^>]*>/i.exec(visible);
  if (dangling) {
    hidden.push(visible.slice(dangling.index + dangling[0].length));
    visible = visible.slice(0, dangling.index);
  }

  visible = tidy(visible
    .replace(/<\/(?:think|thinking|thoughts|planning|analysis|reasoning)>/gi, '')
    .replace(/<\|(?:analysis|reasoning|thinking|thoughts|planning)\|>/gi, ''));

  var markedVisible = explicitFinal(visible);
  if (markedVisible) return markedVisible;
  if (visible) return visible;

  for (var index = hidden.length - 1; index >= 0; index -= 1) {
    var recovered = salvage(hidden[index]);
    if (recovered) return recovered;
  }
  return '';
}

function ngV055NormalizeAiTags(raw) {
  var text = ngV055ExtractAiFinal(raw, true).replace(/\x60\x60\x60(?:\w+)?/gi, '').replace(/\x60\x60\x60/g, '')
    .replace(/^\s*(?:tags?|prompt)\s*:\s*/i, '').replace(/\r/g, '\n').replace(/[;\n]+/g, ',');
  var seen = new Set();
  return text.split(',').map(function (tag) { return tag.trim().replace(/^["'\x60]+|["'\x60]+$/g, '').replace(/\s+/g, ' '); })
    .filter(Boolean)
    .filter(function (tag) { return !/^<\/?(?:think|thinking|thoughts|planning|analysis|reasoning|final|answer|output)\b/i.test(tag); })
    .filter(function (tag) { var key = tag.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

function ngV055AiInstruction(userText) {
  return [
    'Convert the user image idea into a NovelAI V4.5 / Danbooru-style image prompt.',
    'Return ONLY one comma-separated list of concise English visual tags. No markdown, no explanation, no full sentences.',
    'The user may write in Thai or another language; translate the visual meaning into English tags.',
    'Prefer common Danbooru-style concepts and spellings when you know them, but do not invent artist names.',
    'Preserve known character names, franchise names, landmark/place names, clothing, actions, expressions, weather, lighting and camera framing.',
    'Order tags roughly as: subject/count, character identity, appearance/clothes, action/pose/expression, location/background, time/weather/lighting, camera/composition, style/details.',
    'Do not add weighted syntax unless the user explicitly supplied a weight. Do not add commentary.',
    'Never emit <think>, <thinking>, <thoughts>, <planning>, <analysis>, or <reasoning> markup. Put the comma-separated prompt in the final answer, never in a reasoning channel.',
    '', 'USER IMAGE IDEA:', String(userText || '').trim(),
  ].join('\n');
}

function ngV055BuildAiPrompt(raw) {
  var prefs = ngV055Prefs();
  var prompt = ngV055NormalizeAiTags(raw).join(', ');
  if (prefs.aiHelperSuggestions && typeof ngV040SuggestTags === 'function' && typeof ngV040AppendTags === 'function') prompt = ngV040AppendTags(prompt, ngV040SuggestTags(prompt));
  if (prefs.aiHelperArtists && typeof ngV040ArtistPromptTags === 'function' && typeof ngV040AppendTags === 'function') prompt = ngV040AppendTags(prompt, ngV040ArtistPromptTags());
  if (prefs.aiHelperQuality && typeof ngV040ModelQualityTags === 'function' && typeof ngV040AppendTags === 'function') prompt = ngV040AppendTags(prompt, ngV040ModelQualityTags());
  return prompt.trim();
}

function ngV055ApplyPrompt(text, append) {
  if (!studio) return;
  var next = String(text || '').trim();
  if (!next) return;
  var output = document.getElementById('ng-v055-ai-output');
  var nativePrompt = output?.dataset?.ngPromptFormat === 'native';
  studio.prompt = append && studio.prompt
    ? (nativePrompt
      ? studio.prompt.trimEnd() + '\n' + next
      : (typeof ngV040AppendTags === 'function' ? ngV040AppendTags(studio.prompt, ngV055NormalizeAiTags(next)) : studio.prompt.replace(/\s*,?\s*$/, '') + ', ' + next))
    : next;
  var textarea = document.getElementById('ng-prompt');
  if (textarea) {
    textarea.value = studio.prompt;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  }
}

async function ngV055RunAiHelper() {
  var input = document.getElementById('ng-v055-ai-input');
  var output = document.getElementById('ng-v055-ai-output');
  var status = document.getElementById('ng-v055-ai-status');
  var button = document.getElementById('ng-v055-ai-run');
  var idea = String(input?.value || '').trim();
  if (!idea) return toast('warning', 'Describe the image you want first.');
  var context;
  try { context = ctx(); } catch {}
  if (!context || typeof context.generateQuietPrompt !== 'function') return toast('error', 'This SillyTavern build does not expose the current AI connection to extensions.');
  if (button) button.disabled = true;
  if (status) status.textContent = 'Using your current SillyTavern AI connection…';
  try {
    var reply = await context.generateQuietPrompt({ quietPrompt: ngV055AiInstruction(idea) });
    var finalPrompt = ngV055BuildAiPrompt(reply);
    if (!finalPrompt) throw new Error('The AI returned no usable tags.');
    if (output) {
      output.value = finalPrompt;
      output.dataset.ngPromptFormat = 'tags';
    }
    if (status) status.textContent = 'Tags ready. Review them, then replace or append to Prompt.';
  } catch (error) {
    console.error('[Novel Generation] AI Prompt Helper failed:', error);
    if (status) status.textContent = 'AI helper failed: ' + (error?.message || error);
    toast('error', 'AI Prompt Helper failed. Check your current SillyTavern AI connection.');
  } finally { if (button) button.disabled = false; }
}

function ngV055AiHelperHtml() {
  var prefs = ngV055Prefs();
  return '<details id="ng-v055-ai-helper" class="ng-studio-section ng-v055-ai-helper" data-focus="ai-helper">'
    + '<summary><i class="fa-solid fa-wand-magic-sparkles"></i><span>AI Prompt Helper</span><i class="fa-solid fa-chevron-down"></i></summary>'
    + '<div class="ng-studio-section-body">'
    + '<p class="ng-muted">Describe the image naturally in Thai, English, or another language, or attach a reference image below. Both tools write into the same editable prompt result.</p>'
    + '<label class="ng-field"><span class="ng-label">Image idea / requested changes</span><textarea id="ng-v055-ai-input" class="text_pole" rows="4" placeholder="ผู้หญิงใส่เสื้อแจ็คเก็ตยืนตากแดดที่สี่แยกเมืองชินจูกุ"></textarea></label>'
    + '<div class="ng-v055-ai-options">'
    + '<label class="checkbox_label"><input id="ng-v055-ai-quality" type="checkbox" ' + (prefs.aiHelperQuality ? 'checked' : '') + '><span>Add model-aware Quality Tags</span></label>'
    + '<label class="checkbox_label"><input id="ng-v055-ai-artists" type="checkbox" ' + (prefs.aiHelperArtists ? 'checked' : '') + '><span>Add selected Danbooru artist mix</span></label>'
    + '<label class="checkbox_label"><input id="ng-v055-ai-suggest" type="checkbox" ' + (prefs.aiHelperSuggestions ? 'checked' : '') + '><span>Add local Suggest Tags</span></label>'
    + '</div><div class="ng-actions"><button id="ng-v055-ai-run" class="menu_button" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Convert to Tags</button></div>'
    + '<small id="ng-v055-ai-status" class="ng-help">Uses the same AI/model currently selected in SillyTavern and consumes one text-generation call.</small>'
    + '<label class="ng-field"><span class="ng-label">Generated prompt</span><textarea id="ng-v055-ai-output" class="text_pole" rows="6" placeholder="AI-generated tags appear here…"></textarea></label>'
    + '<div class="ng-actions ng-v055-ai-apply"><button id="ng-v055-ai-replace" class="menu_button" type="button">Replace Prompt</button><button id="ng-v055-ai-append" class="menu_button" type="button">Append to Prompt</button></div>'
    + '</div></details>';
}

function ngV055InjectAiHelper() {
  var panel = document.getElementById('ng-generate-panel');
  if (!panel || document.getElementById('ng-v055-ai-helper')) return;
  var promptSection = panel.querySelector('details[data-focus="prompt"]');
  if (!promptSection) return;
  promptSection.insertAdjacentHTML('afterend', ngV055AiHelperHtml());
  var prefs = ngV055Prefs();
  document.getElementById('ng-v055-ai-quality')?.addEventListener('change', function (event) { prefs.aiHelperQuality = event.currentTarget.checked; save(); });
  document.getElementById('ng-v055-ai-artists')?.addEventListener('change', function (event) { prefs.aiHelperArtists = event.currentTarget.checked; save(); });
  document.getElementById('ng-v055-ai-suggest')?.addEventListener('change', function (event) { prefs.aiHelperSuggestions = event.currentTarget.checked; save(); });
  document.getElementById('ng-v055-ai-run')?.addEventListener('click', ngV055RunAiHelper);
  document.getElementById('ng-v055-ai-replace')?.addEventListener('click', function () { ngV055ApplyPrompt(document.getElementById('ng-v055-ai-output')?.value, false); });
  document.getElementById('ng-v055-ai-append')?.addEventListener('click', function () { ngV055ApplyPrompt(document.getElementById('ng-v055-ai-output')?.value, true); });
}

function ngV055InitStudio() {
  var overlay = document.getElementById('ng-studio-overlay');
  if (!overlay) return;
  ngV055SetVersionLabels();
  ngV055InjectMobileNav();
  ngV055InjectAiHelper();
  ngV055BindMobileAccordions();
  document.dispatchEvent(new CustomEvent('novel-generation:studio-ready'));
  if (ngV055IsMobile()) {
    var hasImage = Boolean(document.querySelector('#ng-preview img'));
    ngV055SetMobilePane(hasImage && ngV055ActiveTab() === 'generate' ? 'preview' : 'controls');
  }
  ngV055SyncMobileNav();
}

var ngV055BaseSwitchTab = switchTab;
switchTab = function (tab) {
  var result = ngV055BaseSwitchTab.apply(this, arguments);
  if (ngV055IsMobile()) ngV055SetMobilePane('controls');
  ngV055SyncMobileNav();
  return result;
};

var ngV055BaseGenerateStudio = generateStudio;
generateStudio = async function () {
  var result = await ngV055BaseGenerateStudio.apply(this, arguments);
  if (ngV055IsMobile() && document.querySelector('#ng-preview img')) ngV055SetMobilePane('preview');
  return result;
};

var ngV055BaseOpenStudio = openStudio;
openStudio = function (mode, focus) {
  var result = ngV055BaseOpenStudio.apply(this, arguments);
  setTimeout(ngV055InitStudio, 0);
  return result;
};

ngV055SetVersionLabels();
recoverStaleStudioState();
setTimeout(recoverStaleStudioState, 0);


/* ===== Runtime 16: character prompt routing ===== */
// Novel Generation v0.5.6 — Character Prompt routing fix.
var NG_V056_RELEASE = VERSION;

function ngV056HasCharacterPrompts(state) {
  return Boolean((state?.characters || []).some(function (item) { return String(item?.prompt || '').trim(); }));
}

// V4/V4.5 character captions use coordinates. The previous Auto mode placed every
// character at the same center point, which caused prompt bleed for multi-character
// scenes. Auto now spreads active characters across the canvas while keeping explicit
// Left / Center / Right choices authoritative.
naiCharacterCaptions = function (state) {
  var items = (state?.characters || []).filter(function (item) { return String(item?.prompt || '').trim(); });
  var total = items.length;
  return items.map(function (item, index) {
    var position = String(item.position || 'auto');
    var center;
    if (position === 'left') center = { x: 0.2, y: 0.5 };
    else if (position === 'center') center = { x: 0.5, y: 0.5 };
    else if (position === 'right') center = { x: 0.8, y: 0.5 };
    else center = { x: total <= 1 ? 0.5 : (index + 1) / (total + 1), y: 0.5 };
    return { char_caption: String(item.prompt || '').trim(), centers: [center] };
  });
};

// Character Prompts are native NovelAI V4/V4.5 structured prompt data. The old
// candidate order sent openai-extended-flat first; because many OpenAI-compatible
// proxies return HTTP 200 while silently ignoring unknown `character_prompts`, the
// extension stopped there and the separate character prompts never reached
// parameters.v4_prompt.caption.char_captions.
var ngV056BaseRequestCandidates = requestCandidates;
requestCandidates = function (state) {
  if (!ngV056HasCharacterPrompts(state)) return ngV056BaseRequestCandidates(state);

  if (settings().compatibility === 'strict') {
    throw new Error('Character Prompts require Payload mode Auto / NovelAI-aware. Strict OpenAI mode cannot carry NovelAI V4/V4.5 character captions.');
  }

  var candidates = ngV056BaseRequestCandidates(state);
  var nested = candidates.find(function (candidate) { return candidate.name === 'openai-with-nai-parameters'; });
  if (!nested?.payload?.parameters?.v4_prompt?.caption?.char_captions?.length) {
    throw new Error('Character Prompts could not be encoded into the NovelAI V4/V4.5 structured prompt payload.');
  }

  // Build a second native envelope from the already-processed nested candidate so
  // v0.5.1 Advanced provider body merges and current parameter wrappers stay intact.
  var nativePayload = cleanObject({
    model: nested.payload.model || settings().model,
    input: nested.payload.input || state.prompt.trim(),
    action: nested.payload.action || naiAction(state),
    parameters: clone(nested.payload.parameters),
  });

  // Do not fall back to the old flat/strict schemas here: a successful image from
  // those schemas can silently ignore Character Prompts, which is worse than an
  // explicit provider error and makes the feature appear broken.
  return [
    { name: 'openai-with-nai-parameters-character-prompts', payload: nested.payload },
    { name: 'nai-native-envelope-character-prompts', payload: nativePayload },
  ];
};

function ngV056SetVersionLabels() {
  document.querySelectorAll('#ng-settings .ng-version').forEach(function (node) { node.textContent = 'v' + NG_V056_RELEASE; });
  document.querySelectorAll('#ng-studio-overlay .ng-studio-title small').forEach(function (node) {
    var current = String(node.textContent || '').replace(/^v\d+(?:\.\d+){1,2}\s*[·-]?\s*/i, '').trim();
    if (!current || /^v\d/i.test(current)) current = studio?.mode ? String(studio.mode) : '';
    node.textContent = 'v' + NG_V056_RELEASE + (current ? ' · ' + current : '');
  });
}

if (typeof ngV055SetVersionLabels === 'function') ngV055SetVersionLabels = ngV056SetVersionLabels;
ngV056SetVersionLabels();


/* ===== Consolidated compatibility layer: provider adapters ===== */
const NG_CONSOLIDATED_VIBE_PATHS = [
  '/ai/encode-vibe',
  '/v1/ai/encode-vibe',
  '/ai/vibe-encode',
  '/v1/ai/vibe-encode',
  '/v1/images/encode-vibe',
];
const NG_CONSOLIDATED_NATIVE_PATHS = [
  '/ai/generate-image',
  '/v1/ai/generate-image',
  '/generate-image',
  '/v1/generate-image',
];

function ngConsolidatedCandidates(paths) {
  const current = base();
  if (!current) return [];
  const trimmed = current.replace(/\/+$/, '');
  const root = trimmed.replace(/\/v1$/i, '');
  const urls = [];
  for (const path of paths) {
    urls.push(root + path, trimmed + path);
    if (!/\/v1$/i.test(trimmed)) urls.push(trimmed + '/v1' + path);
  }
  return [...new Set(urls)];
}

var ngConsolidatedBaseProviderPathCandidates = ngProviderPathCandidates;
ngProviderPathCandidates = function (path) {
  if (path === '/ai/encode-vibe') return ngConsolidatedCandidates(NG_CONSOLIDATED_VIBE_PATHS);
  if (path === '/ai/generate-image') return ngConsolidatedCandidates(NG_CONSOLIDATED_NATIVE_PATHS);
  return ngConsolidatedBaseProviderPathCandidates(path);
};

function ngConsolidatedReadVibeResponse(response, contentType) {
  if (contentType.includes('application/json') || contentType.includes('text/json')) {
    return response.json().then(function (data) {
      return {
        encoded: data?.encoded_vibe || data?.encoded || data?.vibe || data?.base64
          || data?.data?.[0]?.b64_json || data?.data?.[0]?.base64 || '',
        debug: safePayloadForDebug(data),
      };
    });
  }
  return response.arrayBuffer().then(function (buffer) {
    return {
      encoded: ngBytesToBase64(new Uint8Array(buffer)),
      debug: { content_type: contentType || 'application/octet-stream', bytes: buffer.byteLength },
    };
  });
}

async function ngConsolidatedEncodeVibeReference(ref, signal) {
  if (!ref?.base64 && !ref?.url) throw new Error('Vibe reference image data is missing.');
  const information = Number(ref.information ?? 1);
  if (ref.encodedVibe && ref.encodedVibeInformation === information) return ref.encodedVibe;

  const urls = [...new Set([
    ngProviderCaps?.encodeVibeUrl,
    ...ngConsolidatedCandidates(NG_CONSOLIDATED_VIBE_PATHS),
  ].filter(Boolean))];
  if (!urls.length) throw new Error('The proxy does not expose a Vibe Transfer encoder route.');

  const image = imageValue(ref);
  const rawBase64 = image.startsWith('data:') ? image.split(',').slice(1).join(',') : image;
  const model = ngCanonicalNativeModel(settings().model, 'generate').replace(/-inpainting$/i, '');
  const payloads = [
    { image: image, model: model, information_extracted: information },
    { image_base64: rawBase64, model: model, information_extracted: information },
    { input_image: image, model: model, information_extracted: information },
  ];
  const failures = [];

  for (const url of urls) {
    for (const payload of payloads) {
      const started = performance.now();
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(payload),
          signal,
        });
        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (!response.ok) {
          const raw = await response.text();
          failures.push(url + ': HTTP ' + response.status);
          debugAttempt({
            route: 'native-encode-vibe',
            schema: 'nai-encode-vibe',
            status: response.status,
            ms: Math.round(performance.now() - started),
            payload: safePayloadForDebug({ ...payload, image: '[image data]' }),
            response: raw.slice(0, 700),
          });
          continue;
        }
        const parsed = await ngConsolidatedReadVibeResponse(response, contentType);
        if (!parsed.encoded) {
          failures.push(url + ': encoder returned no vector');
          continue;
        }
        ref.encodedVibe = parsed.encoded;
        ref.encodedVibeInformation = information;
        debugAttempt({
          route: 'native-encode-vibe',
          schema: 'nai-encode-vibe',
          status: response.status,
          ms: Math.round(performance.now() - started),
          payload: { model: model, information_extracted: information, image: '[image data]' },
          response: parsed.debug,
        });
        return ref.encodedVibe;
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        failures.push(url + ': ' + (error?.message || error));
      }
    }
  }
  throw new Error('Vibe Transfer encoding failed. Tried the proxy encoder routes and payload formats. ' + failures.slice(-3).join('; '));
}

ngEncodeVibeReference = ngConsolidatedEncodeVibeReference;
ngPrepareVibes = async function (state, signal) {
  if (!state?.vibes?.length) return;
  for (const ref of state.vibes) await ngEncodeVibeReference(ref, signal);
};

var ngConsolidatedBaseRequestCandidates = requestCandidates;
requestCandidates = function (state) {
  if (!ngV056HasCharacterPrompts(state)) return ngConsolidatedBaseRequestCandidates(state);
  const candidates = ngConsolidatedBaseRequestCandidates(state);
  const nested = candidates.find(function (candidate) {
    return candidate.name === 'openai-with-nai-parameters-character-prompts'
      || candidate.name === 'openai-with-nai-parameters';
  });
  if (!nested?.payload?.parameters?.v4_prompt?.caption?.char_captions?.length) {
    throw new Error('Character Prompts could not be encoded into the NovelAI V4/V4.5 structured prompt payload.');
  }
  const params = nested.payload.parameters;
  const captions = params.v4_prompt.caption.char_captions;
  const characterPrompts = (state.characters || [])
    .filter(function (item) { return String(item?.prompt || '').trim(); })
    .map(function (item) {
      return { prompt: String(item.prompt).trim(), position: item.position || 'auto' };
    });
  const openAiTopLevel = cleanObject({
    ...nested.payload,
    parameters: undefined,
    v4_prompt: params.v4_prompt,
    v4_negative_prompt: params.v4_negative_prompt,
    character_prompts: characterPrompts,
    character_captions: captions,
  });
  const nativeTopLevel = cleanObject({
    model: nested.payload.model || settings().model,
    prompt: nested.payload.prompt || state.prompt.trim(),
    input: nested.payload.input || state.prompt.trim(),
    action: nested.payload.action || naiAction(state),
    parameters: undefined,
    v4_prompt: params.v4_prompt,
    v4_negative_prompt: params.v4_negative_prompt,
    character_prompts: characterPrompts,
    character_captions: captions,
    ...params,
  });
  return [
    { name: nested.name, payload: nested.payload },
    { name: 'openai-character-prompts-top-level', payload: openAiTopLevel },
    { name: 'nai-character-prompts-top-level', payload: nativeTopLevel },
  ];
};

/*
 * RVL Connect exposes the OpenAI-compatible image wrapper but did not expose
 * a Vibe encoder in capability probing. Sending a raw PNG in
 * reference_image_multiple is not a valid NovelAI Vibe vector and can make
 * the upstream image service fail with a 503. Stop before sending that
 * misleading request; a proxy must provide an encoder route for Vibe
 * Transfer to be valid.
 */
var ngConsolidatedBaseGenerateState = generateState;
generateState = async function (state, label) {
  if (state?.vibes?.length) {
    if (!ngProviderCaps.checked) {
      try { await ngProbeAdvancedCapabilities(); } catch (error) {
        throw new Error('Vibe Transfer capability check failed: ' + (error?.message || error));
      }
    }
    if (ngProviderCaps.encodeVibe !== 'supported' || !ngProviderCaps.encodeVibeUrl) {
      throw new Error('This proxy does not expose a Vibe Transfer encoder route. RVL Connect must add Vibe/encode-vibe support before Vibe Transfer can work.');
    }
  }
  return ngConsolidatedBaseGenerateState(state, label);
};



/*
 * Keep the Studio's text draft in SillyTavern extension settings. Closing the
 * overlay should only close the UI; it must not erase the prompt work the user
 * has entered. Reference image data is intentionally not persisted because it
 * can be very large; prompt text and separate character prompts are safe to
 * restore across closing and reopening the Studio.
 */
function ngStudioDraftStore() {
  const image = settings().image;
  if (!image.studioDrafts || typeof image.studioDrafts !== 'object' || Array.isArray(image.studioDrafts)) image.studioDrafts = {};
  return image.studioDrafts;
}

function ngStudioDraftSnapshot(state) {
  return {
    prompt: String(state?.prompt || ''),
    negative: String(state?.negative || ''),
    characters: Array.isArray(state?.characters) ? state.characters.slice(0, 12).map(function (character) {
      return {
        prompt: String(character?.prompt || ''),
        position: ['auto', 'left', 'center', 'right'].includes(character?.position) ? character.position : 'auto',
      };
    }) : [],
  };
}

function ngSaveStudioDraft() {
  if (!studio) return;
  ngStudioDraftStore()[String(studio.mode || 'free')] = ngStudioDraftSnapshot(studio);
  save();
}

function ngRestoreStudioDraft(state) {
  const draft = ngStudioDraftStore()[String(state.mode || 'free')];
  if (!draft || typeof draft !== 'object') return state;
  if (typeof draft.prompt === 'string') state.prompt = draft.prompt;
  if (typeof draft.negative === 'string') state.negative = draft.negative;
  if (Array.isArray(draft.characters)) {
    state.characters = draft.characters.slice(0, 12).map(function (character) {
      return {
        prompt: String(character?.prompt || ''),
        position: ['auto', 'left', 'center', 'right'].includes(character?.position) ? character.position : 'auto',
      };
    });
  }
  return state;
}

var ngDraftBaseNewStudio = newStudio;
newStudio = function (mode, focus) {
  return ngRestoreStudioDraft(ngDraftBaseNewStudio(mode, focus));
};

var ngDraftBaseBindStudio = bindStudio;
bindStudio = function () {
  ngDraftBaseBindStudio();
  document.getElementById('ng-prompt')?.addEventListener('input', ngSaveStudioDraft);
  document.getElementById('ng-negative')?.addEventListener('input', ngSaveStudioDraft);
  document.getElementById('ng-character-list')?.addEventListener('input', ngSaveStudioDraft);
  document.getElementById('ng-character-list')?.addEventListener('change', ngSaveStudioDraft);
  document.getElementById('ng-character-list')?.addEventListener('click', ngSaveStudioDraft);
};

var ngDraftBaseCloseStudio = closeStudio;
closeStudio = function () {
  ngSaveStudioDraft();
  return ngDraftBaseCloseStudio();
};


/* ===== Runtime 17: Artist Mix reliability ===== */
// Novel Generation v0.6.7 — structured, idempotent artist emphasis.
//
// Older releases wrote the selected artists directly into the editable prompt.
// Changing a weight and pressing Apply again produced a second weighted tag,
// because deduplication compared the entire string instead of the artist name.
// Keep the mix in extension settings now and compose it exactly once for the
// request. This also gives iOS a live input path instead of waiting for blur.
var NG_V067_RELEASE = VERSION;

function ngV067ArtistPrefs() {
  var prefs = ngV040Prefs();
  if (!('artistMixEnabled' in prefs)) prefs.artistMixEnabled = prefs.useArtistsQuick !== false;
  if (!Array.isArray(prefs.artistMixManagedNames)) prefs.artistMixManagedNames = [];
  for (var item of prefs.selectedArtists) {
    var name = String(item?.name || '').trim();
    if (name && !prefs.artistMixManagedNames.includes(name)) prefs.artistMixManagedNames.push(name);
  }
  prefs.artistMixManagedNames = prefs.artistMixManagedNames.slice(-100);
  return prefs;
}

function ngV067ClampArtistWeight(value, fallback) {
  var number = Number(value);
  if (!Number.isFinite(number)) number = Number.isFinite(Number(fallback)) ? Number(fallback) : 1;
  return Math.max(-3, Math.min(3, Math.round(number * 100) / 100));
}

function ngV067ArtistDisplayName(value) {
  return String(value || '').replace(/_/g, ' ').trim().replace(/\s+/g, ' ');
}

function ngV067EscapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ngV067RemoveManagedArtistTags(prompt) {
  var text = String(prompt || '');
  var prefs = ngV067ArtistPrefs();
  var names = [...new Set([
    ...prefs.artistMixManagedNames,
    ...prefs.selectedArtists.map(function (item) { return item?.name; }),
  ].map(ngV067ArtistDisplayName).filter(Boolean))];

  for (var name of names) {
    var variants = [...new Set([name, name.replace(/\s+/g, '_')])];
    for (var variant of variants) {
      var escaped = ngV067EscapeRegExp(variant);
      var pattern = new RegExp(
        '(^|,\\s*)(?:-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)::\\s*)?' + escaped + '(?:\\s*::)?(?=\\s*,|\\s*$)',
        'gi',
      );
      text = text.replace(pattern, function (_match, prefix) { return prefix && prefix.includes(',') ? ',' : ''; });
    }
  }

  return text
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/^\s*,\s*|\s*,\s*$/g, '')
    .replace(/,\s+/g, ', ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

ngV040ArtistPromptTags = function () {
  return ngV067ArtistPrefs().selectedArtists.map(function (item) {
    var name = ngV067ArtistDisplayName(item?.name);
    if (!name) return '';
    var weight = ngV067ClampArtistWeight(item?.weight, 1);
    return Math.abs(weight - 1) < 0.001 ? name : weight + '::' + name + ' ::';
  }).filter(Boolean);
};

function ngV067SplitDatasetPrefix(prompt) {
  var parts = ngV040PromptParts(prompt);
  var dataset = [];
  while (parts.length && /^(?:fur|background) dataset$/i.test(parts[0])) dataset.push(parts.shift());
  return { dataset: dataset, rest: parts.join(', ') };
}

function ngV067ComposeArtistPrompt(prompt, enabled) {
  var cleaned = ngV067RemoveManagedArtistTags(prompt);
  if (!enabled) return cleaned;
  var artists = ngV040ArtistPromptTags();
  if (!artists.length) return cleaned;
  var split = ngV067SplitDatasetPrefix(cleaned);
  return [...split.dataset, ...artists, split.rest].filter(Boolean).join(', ');
}

function ngV067EffectivePrompt(prompt) {
  var prefs = ngV067ArtistPrefs();
  var effective = ngV067ComposeArtistPrompt(prompt, prefs.artistMixEnabled !== false);
  var image = settings().image || {};
  return [image.prefix, effective, image.suffix]
    .map(function (part) { return String(part || '').trim(); })
    .filter(Boolean)
    .join(', ');
}

function ngV067SyncArtistInput(input) {
  var item = ngV067ArtistPrefs().selectedArtists[Number(input?.dataset?.index)];
  if (!item || !input) return;
  item.weight = ngV067ClampArtistWeight(input.value, item.weight);
  input.value = item.weight;
  save();
  ngV067RefreshArtistMixUi();
}

ngV040RenderSelectedArtists = function () {
  var root = document.getElementById('ng-v040-selected-artists');
  if (!root) return;
  var prefs = ngV067ArtistPrefs();
  var items = prefs.selectedArtists;
  root.innerHTML = items.length ? items.map(function (item, index) {
    return '<div class="ng-v040-artist-chip">'
      + '<span>' + esc(ngV067ArtistDisplayName(item.name)) + '</span>'
      + '<label>Emphasis <input class="text_pole ng-v040-artist-weight" data-index="' + index + '" type="number" inputmode="decimal" min="-3" max="3" step="0.1" value="' + ngV067ClampArtistWeight(item.weight, 1) + '"></label>'
      + '<button class="menu_button ng-v040-artist-remove" data-index="' + index + '" type="button" title="Remove"><i class="fa-solid fa-xmark"></i></button>'
      + '</div>';
  }).join('') : '<small class="ng-help">No artists selected. Select multiple artists to build a style mix.</small>';

  root.querySelectorAll('.ng-v040-artist-weight').forEach(function (input) {
    input.addEventListener('input', function () { ngV067SyncArtistInput(input); });
    input.addEventListener('change', function () { ngV067SyncArtistInput(input); });
  });
  root.querySelectorAll('.ng-v040-artist-remove').forEach(function (button) {
    button.addEventListener('click', function () {
      var removed = prefs.selectedArtists.splice(Number(button.dataset.index), 1)[0];
      var name = String(removed?.name || '').trim();
      if (name && !prefs.artistMixManagedNames.includes(name)) prefs.artistMixManagedNames.push(name);
      save();
      ngV040RenderSelectedArtists();
      ngV067RefreshArtistMixUi();
    });
  });
  ngV067RefreshArtistMixUi();
};

function ngV067CleanPromptEditor() {
  if (!studio) return;
  studio.prompt = ngV067RemoveManagedArtistTags(studio.prompt);
  var textarea = document.getElementById('ng-prompt');
  if (textarea) {
    textarea.value = studio.prompt;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  ngV067RefreshArtistMixUi();
  toast('success', 'Old managed artist tags were removed. The selected mix will be added once when you generate.');
}

function ngV067LockComparisonSeed() {
  if (!studio) return;
  if (!Number.isFinite(Number(studio.seed)) || Number(studio.seed) < 0) {
    studio.seed = Math.floor(Math.random() * 4294967295);
  }
  var input = document.getElementById('ng-studio-seed');
  if (input) {
    input.value = studio.seed;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  toast('success', 'Comparison seed locked to ' + studio.seed + '. Keep it unchanged while balancing styles.');
}

function ngV067RefreshArtistMixUi() {
  var prefs = ngV067ArtistPrefs();
  var toggle = document.getElementById('ng-v067-artist-enabled');
  if (toggle) toggle.checked = prefs.artistMixEnabled !== false;
  var drawerToggle = document.getElementById('ng-v040-quick-artists');
  if (drawerToggle) drawerToggle.checked = prefs.artistMixEnabled !== false;
  var preview = document.getElementById('ng-v067-effective-prompt');
  if (preview) preview.value = ngV067EffectivePrompt(studio?.prompt || '');
  var state = document.getElementById('ng-v067-artist-state');
  if (state) {
    var count = prefs.selectedArtists.length;
    state.textContent = prefs.artistMixEnabled !== false && count
      ? count + ' artist' + (count === 1 ? '' : 's') + ' will be inserted once when Generate is pressed.'
      : 'Artist Mix is currently disabled for generation.';
  }
}

function ngV067ArtistMixControlsHtml() {
  var prefs = ngV067ArtistPrefs();
  return '<div id="ng-v067-artist-controls" class="ng-v067-artist-controls">'
    + '<label class="checkbox_label"><input id="ng-v067-artist-enabled" type="checkbox" ' + (prefs.artistMixEnabled !== false ? 'checked' : '') + '><span>Use this Artist Mix when generating</span></label>'
    + '<small class="ng-help">Emphasis is not a percentage: 1.0 is neutral, below 1.0 weakens, and above 1.0 strengthens. Equal numbers cannot guarantee an equal-looking blend.</small>'
    + '<div class="ng-actions"><button id="ng-v067-update-mix" class="menu_button" type="button"><i class="fa-solid fa-arrows-rotate"></i> Update mix</button>'
    + '<button id="ng-v067-clean-prompt" class="menu_button" type="button"><i class="fa-solid fa-broom"></i> Clean old artist tags</button>'
    + '<button id="ng-v067-lock-seed" class="menu_button" type="button"><i class="fa-solid fa-lock"></i> Lock comparison seed</button></div>'
    + '<small id="ng-v067-artist-state" class="ng-help"></small>'
    + '<label class="ng-field"><span class="ng-label">Effective Prompt Preview</span><textarea id="ng-v067-effective-prompt" class="text_pole" rows="5" readonly></textarea><small class="ng-help">This is the composed prompt sent to Direct NovelAI and compatible proxy payloads. Artist tags are inserted after dataset tags and before the main prompt.</small></label>'
    + '</div>';
}

function ngV067EnhanceArtistMixUi() {
  var assistant = document.getElementById('ng-v040-assistant');
  var selected = document.getElementById('ng-v040-selected-artists');
  if (!assistant || !selected) return;

  if (!document.getElementById('ng-v067-artist-controls')) {
    selected.insertAdjacentHTML('afterend', ngV067ArtistMixControlsHtml());
  }

  // Replace the old button node to discard its append-to-prompt listener.
  var oldApply = document.getElementById('ng-v040-apply-artists');
  if (oldApply && !oldApply.dataset.ngV067Replaced) {
    var replacement = oldApply.cloneNode(true);
    replacement.dataset.ngV067Replaced = '1';
    replacement.hidden = true;
    replacement.setAttribute('aria-hidden', 'true');
    oldApply.replaceWith(replacement);
  }

  var aiArtistOption = document.getElementById('ng-v055-ai-artists')?.closest('label');
  if (aiArtistOption) aiArtistOption.hidden = true;

  var controls = document.getElementById('ng-v067-artist-controls');
  if (controls && !controls.dataset.bound) {
    controls.dataset.bound = '1';
    document.getElementById('ng-v067-artist-enabled')?.addEventListener('change', function (event) {
      var prefs = ngV067ArtistPrefs();
      prefs.artistMixEnabled = event.currentTarget.checked;
      prefs.useArtistsQuick = event.currentTarget.checked;
      save();
      ngV067RefreshArtistMixUi();
    });
    document.getElementById('ng-v067-update-mix')?.addEventListener('click', function () {
      document.querySelectorAll('.ng-v040-artist-weight').forEach(ngV067SyncArtistInput);
      ngV067ArtistPrefs().artistMixEnabled = true;
      save();
      ngV067RefreshArtistMixUi();
      toast('success', 'Artist Mix updated. It will be inserted once when you generate.');
    });
    document.getElementById('ng-v067-clean-prompt')?.addEventListener('click', ngV067CleanPromptEditor);
    document.getElementById('ng-v067-lock-seed')?.addEventListener('click', ngV067LockComparisonSeed);
  }

  var prompt = document.getElementById('ng-prompt');
  if (prompt && !prompt.dataset.ngV067PreviewBound) {
    prompt.dataset.ngV067PreviewBound = '1';
    prompt.addEventListener('input', ngV067RefreshArtistMixUi);
  }
  ngV067RefreshArtistMixUi();
}

function ngV067EnhanceDrawer() {
  var toggle = document.getElementById('ng-v040-quick-artists');
  if (!toggle) return;
  var copy = toggle.closest('label')?.querySelector('span');
  if (copy) copy.textContent = 'Use selected Danbooru Artist Mix for generation';
  toggle.checked = ngV067ArtistPrefs().artistMixEnabled !== false;
  if (!toggle.dataset.ngV067Bound) {
    toggle.dataset.ngV067Bound = '1';
    toggle.addEventListener('change', function (event) {
      var prefs = ngV067ArtistPrefs();
      prefs.artistMixEnabled = event.currentTarget.checked;
      prefs.useArtistsQuick = event.currentTarget.checked;
      save();
      ngV067RefreshArtistMixUi();
    });
  }
}

// Artist mix is structured separately, so AI Prompt Helper should not bake a
// second copy into its editable result. Suggestions and quality tags remain.
ngV055BuildAiPrompt = function (raw) {
  var prefs = ngV055Prefs();
  var prompt = ngV055NormalizeAiTags(raw).join(', ');
  if (prefs.aiHelperSuggestions) prompt = ngV040AppendTags(prompt, ngV040SuggestTags(prompt));
  if (prefs.aiHelperQuality) prompt = ngV040AppendTags(prompt, ngV040ModelQualityTags());
  return prompt.trim();
};

var ngV067BaseNewStudio = newStudio;
newStudio = function (mode, focus) {
  var state = ngV067BaseNewStudio(mode, focus);
  state.artistMixEnabled = ngV067ArtistPrefs().artistMixEnabled !== false;
  return state;
};

var ngV067BaseGenerateState = generateState;
generateState = async function (state, label) {
  const canvas = ngApplyCanvasSize(state);
  if (canvas) {
    debugAttempt({
      route: 'preflight',
      schema: 'resolved-canvas-size',
      status: 0,
      payload: {
        preset: canvas.preset,
        width: canvas.width,
        height: canvas.height,
        orientation: canvas.orientation,
      },
      response: canvas.corrected
        ? { corrected_stale_values: canvas.original }
        : { corrected_stale_values: false },
    });
  }
  var originalPrompt = state?.prompt;
  if (state && typeof originalPrompt === 'string') {
    var enabled = state.artistMixEnabled !== false && ngV067ArtistPrefs().artistMixEnabled !== false;
    state.prompt = ngV067ComposeArtistPrompt(originalPrompt, enabled);
  }
  try {
    return await ngV067BaseGenerateState(state, label);
  } finally {
    if (state && typeof originalPrompt === 'string') state.prompt = originalPrompt;
  }
};

var ngV067BaseOpenStudio = openStudio;
openStudio = function (mode, focus) {
  var result = ngV067BaseOpenStudio.apply(this, arguments);
  setTimeout(ngV067EnhanceArtistMixUi, 0);
  return result;
};

var ngV067BaseInstallDrawer = ngV040InstallDrawer;
ngV040InstallDrawer = function () {
  var result = ngV067BaseInstallDrawer.apply(this, arguments);
  setTimeout(ngV067EnhanceDrawer, 0);
  return result;
};

document.addEventListener('novel-generation:studio-ready', function () {
  setTimeout(ngV067EnhanceArtistMixUi, 0);
});

ngV067ArtistPrefs();
ngV067EnhanceDrawer();


/* ===== Runtime 18: original saves and gallery cleanup ===== */
// Novel Generation v0.6.8 — preserve provider bytes on save and let users
// release full-resolution session images without restarting SillyTavern.
var NG_V068_RELEASE = VERSION;

function ngV068UpdateGalleryCount() {
  document.querySelectorAll('#ng-gallery-count').forEach(function (count) {
    count.textContent = gallery.length;
  });
  var stats = document.getElementById('ng-v068-gallery-stats');
  if (stats) {
    var dataBytes = gallery.reduce(function (total, item) {
      var source = String(item?.src || '');
      if (!source.startsWith('data:')) return total;
      var comma = source.indexOf(',');
      if (comma < 0) return total;
      var body = source.slice(comma + 1);
      return total + (source.slice(0, comma).includes(';base64') ? Math.floor(body.length * 0.75) : body.length);
    }, 0);
    var memory = dataBytes ? ' · approximately ' + ngV068FormatBytes(dataBytes) + ' encoded image data' : '';
    stats.textContent = gallery.length + ' / ' + ngV068GalleryLimit() + ' images' + memory;
  }
}

function ngV068FormatBytes(bytes) {
  var value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
  return (value / (1024 * 1024)).toFixed(1) + ' MB';
}

function ngV068GalleryLimit(value) {
  var raw = value ?? settings().roleplay.galleryLimit;
  return Math.max(1, Math.min(40, Math.round(Number(raw) || 16)));
}

function ngV068ReleaseGalleryItems(items) {
  for (var item of items || []) {
    // Gallery records are the only owners of these large data strings. Clear
    // every reference so the browser can reclaim them after the DOM rerenders.
    if (!item || typeof item !== 'object') continue;
    item.src = '';
    item.prompt = '';
    item.negative = '';
  }
}

function ngV068TrimGallery(limit) {
  var maximum = ngV068GalleryLimit(limit);
  settings().roleplay.galleryLimit = maximum;
  if (gallery.length > maximum) {
    ngV068ReleaseGalleryItems(gallery.splice(maximum));
    if (document.getElementById('ng-gallery-grid')) renderGallery();
  }
  ngV068UpdateGalleryCount();
}

function ngV068DeleteGalleryItem(index) {
  var position = Number(index);
  if (!Number.isInteger(position) || position < 0 || position >= gallery.length) return;
  ngV068ReleaseGalleryItems(gallery.splice(position, 1));
  renderGallery();
  ngV068UpdateGalleryCount();
  toast('success', 'Image removed from the session gallery and its memory reference was released.');
}

function ngV068ClearGallery(ask) {
  if (!gallery.length) {
    renderGallery();
    ngV068UpdateGalleryCount();
    return false;
  }
  if (ask && !window.confirm('Clear all full-resolution images from the Novel Generation session gallery? Saved files and chat images will not be deleted.')) return false;
  ngV068ReleaseGalleryItems(gallery.splice(0));
  renderGallery();
  ngV068UpdateGalleryCount();
  toast('success', 'Session gallery cleared. Saved files and images already inserted into chat were kept.');
  return true;
}

function ngV068SniffImageType(bytes, fallback) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return /^image\//i.test(String(fallback || '')) ? fallback : 'image/png';
}

async function ngV068OriginalBlob(src) {
  var blob = await ngV052BlobFromImage(src);
  var header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  var type = ngV068SniffImageType(header, blob.type);
  // Wrapping only corrects MIME metadata. It does not decode, resize, compress,
  // or re-encode the provider's original bytes.
  return blob.type === type ? blob : new Blob([blob], { type: type });
}

function ngV068ImageDimensions(blob) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob).then(function (bitmap) {
      var dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return dimensions;
    }).catch(function () { return ngV068ImageDimensionsFallback(blob); });
  }
  return ngV068ImageDimensionsFallback(blob);
}

function ngV068ImageDimensionsFallback(blob) {
  return new Promise(function (resolve) {
    var url = URL.createObjectURL(blob);
    var image = new Image();
    image.onload = function () {
      var dimensions = { width: image.naturalWidth || 0, height: image.naturalHeight || 0 };
      URL.revokeObjectURL(url);
      resolve(dimensions);
    };
    image.onerror = function () {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    image.src = url;
  });
}

function ngV068OriginalSaveMessage(blob, dimensions) {
  var size = dimensions?.width && dimensions?.height ? dimensions.width + ' × ' + dimensions.height + ' · ' : '';
  var format = ngV052Extension(blob.type).toUpperCase();
  return 'Original ' + size + format + ' saved without resizing or re-encoding (' + ngV068FormatBytes(blob.size) + ').';
}

ngV052SaveImage = async function (src, filename) {
  var blob;
  try {
    blob = await ngV068OriginalBlob(src);
  } catch (error) {
    toast('warning', 'The browser could not read the original file directly. Open the full image and press/hold it to save the provider image.');
    return false;
  }

  var dimensions = await ngV068ImageDimensions(blob);
  var ext = ngV052Extension(blob.type);
  var safeName = String(filename || ('novel-generation-' + Date.now() + '.' + ext))
    .replace(/\.(png|jpe?g|webp)$/i, '') + '.' + ext;
  var file = new File([blob], safeName, { type: blob.type || 'image/png' });

  if (ngV052IsIOS() && navigator.share && navigator.canShare) {
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Original Novel Generation image' });
        toast('success', ngV068OriginalSaveMessage(blob, dimensions));
        return true;
      }
    } catch (error) {
      if (error?.name === 'AbortError') return false;
      console.debug('[Novel Generation] iOS original-file share fallback', error);
    }
  }

  try {
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safeName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(function () {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 1500);
    toast('success', ngV068OriginalSaveMessage(blob, dimensions));
    return true;
  } catch (error) {
    toast('warning', 'The browser blocked the original-file download. Press/hold the full image to save it.');
    return false;
  }
};

var ngV068BaseGeneratedActions = generatedActions;
generatedActions = function () {
  return ngV068BaseGeneratedActions.apply(this, arguments)
    .replace(/(<i class="fa-solid fa-download"><\/i>) Save(?=<\/button>)/, '$1 Save Original');
};

var ngV068BaseOpenViewer = ngV052OpenViewer;
ngV052OpenViewer = function (src, meta) {
  var result = ngV068BaseOpenViewer.apply(this, arguments);
  var note = document.querySelector('#ng-image-viewer footer small');
  if (note) note.textContent = 'Save Original keeps the provider file at its real pixel size without canvas resizing or recompression. On iPhone/iPad it uses the native share sheet when available.';
  var button = document.querySelector('#ng-image-viewer .ng-image-viewer-save');
  if (button) button.innerHTML = '<i class="fa-solid fa-download"></i> Save Original';
  return result;
};

function ngV068EnsureGalleryToolbar(grid) {
  var panel = grid?.parentElement;
  if (!panel) return;
  var toolbar = document.getElementById('ng-v068-gallery-toolbar');
  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.id = 'ng-v068-gallery-toolbar';
    toolbar.className = 'ng-v068-gallery-toolbar';
    toolbar.innerHTML = '<div><strong>Session Gallery</strong><small id="ng-v068-gallery-stats"></small></div>'
      + '<button id="ng-v068-gallery-clear" class="menu_button" type="button"><i class="fa-solid fa-trash"></i> Clear All</button>';
    panel.insertBefore(toolbar, grid);
    document.getElementById('ng-v068-gallery-clear')?.addEventListener('click', function () { ngV068ClearGallery(true); });
  }
  ngV068UpdateGalleryCount();
}

renderGallery = function () {
  var grid = document.getElementById('ng-gallery-grid');
  if (!grid) return;
  ngV068EnsureGalleryToolbar(grid);
  if (!gallery.length) {
    grid.innerHTML = '<div class="ng-preview-empty"><i class="fa-regular fa-images"></i><strong>No images yet</strong><span>Successful generations appear here. Clearing the gallery does not delete saved files or chat images.</span></div>';
    ngV068UpdateGalleryCount();
    return;
  }
  var images = gallery.map(function (item) { return item.src; });
  grid.innerHTML = gallery.map(function (item, index) {
    return '<article class="ng-gallery-item">'
      + '<button class="ng-image-tap-target ng-gallery-image-button" data-src-index="' + index + '" type="button" aria-label="View full image">'
      + '<img class="ng-viewable-image" src="' + attr(item.src) + '" alt="Gallery image"></button>'
      + '<div class="ng-v068-gallery-meta"><span><strong>' + esc(item.model) + '</strong><small>' + item.width + ' × ' + item.height + '</small></span>'
      + '<button class="menu_button ng-v068-gallery-delete" data-gallery-index="' + index + '" type="button" aria-label="Remove image from gallery"><i class="fa-solid fa-trash"></i></button></div>'
      + generatedActions(item.src, index) + '</article>';
  }).join('');
  bindGeneratedActions(grid, images, gallery);
  grid.querySelectorAll('.ng-v068-gallery-delete').forEach(function (button) {
    button.addEventListener('click', function () { ngV068DeleteGalleryItem(button.dataset.galleryIndex); });
  });
  ngV068UpdateGalleryCount();
};

ngV068TrimGallery();


/* ===== Runtime 19: AI Prompt Helper output modes ===== */
// Novel Generation v0.7.10 — text ideas can become pure tags, a natural-language
// prompt, or a V5-friendly hybrid while image analysis keeps its own preset.
var NG_V070_RELEASE = VERSION;

function ngV070AiPrefs() {
  var prefs = ngV055Prefs();
  if (!['tags', 'native', 'hybrid'].includes(prefs.aiHelperMode)) prefs.aiHelperMode = 'tags';
  if (!prefs.aiHelperLanguage) prefs.aiHelperLanguage = 'auto';
  return prefs;
}

function ngV070LanguageLabel(value) {
  return ({
    auto: 'the same language as the user request; use English when uncertain',
    English: 'English', Thai: 'Thai', Japanese: 'Japanese', Chinese: 'Simplified Chinese',
    Korean: 'Korean', Spanish: 'Spanish', French: 'French', German: 'German',
    Portuguese: 'Portuguese', Vietnamese: 'Vietnamese',
  })[value] || 'English';
}

function ngV070TargetModel() {
  var model = String(settings().model || 'NovelAI').trim();
  return { name: model, v5: /(?:diffusion|nai)[-_. ]?5|\bv5\b/i.test(model) };
}

function ngV070AiInstruction(userText, mode, languageValue) {
  var target = ngV070TargetModel();
  var language = ngV070LanguageLabel(languageValue);
  var common = [
    'Create an image-generation prompt for ' + target.name + '.',
    'Preserve the requested subjects, identities, franchise names, appearance, clothing, actions, expressions, objects, environment, lighting, camera framing, composition, visual style, and any explicit numerical weights.',
    'Resolve contradictions into one coherent composition instead of repeating incompatible framing or poses.',
    'Do not invent artist names. Do not add commentary, markdown, code fences, or safety notes.',
    'Never emit <think>, <thinking>, <thoughts>, <planning>, <analysis>, or <reasoning> markup. Return only the requested final prompt.',
  ];
  if (target.v5) common.push('Use NovelAI Diffusion V5 strengths: precise spatial relationships, character interaction, detailed environments, materials, effects, and text placement when the request needs them.');

  if (mode === 'native') {
    return [
      ...common,
      'Write one polished natural-language prompt in ' + language + '.',
      'Use one coherent paragraph with complete descriptive sentences. Do not return a comma-separated Danbooru tag list and do not add a heading.',
      '', 'USER IMAGE IDEA:', String(userText || '').trim(),
    ].join('\n');
  }
  if (mode === 'hybrid') {
    return [
      ...common,
      'Return exactly two parts and use these literal headings:',
      'TAGS: one comma-separated line of concise English NovelAI/Danbooru-style tags',
      'DESCRIPTION: one polished natural-language paragraph in ' + language,
      'The tag line should lock identity and visible attributes; the paragraph should explain spatial relationships, interaction, atmosphere, materials, effects, and composition without needlessly repeating every tag.',
      '', 'USER IMAGE IDEA:', String(userText || '').trim(),
    ].join('\n');
  }
  return [
    ...common,
    'Return only one comma-separated line of concise English NovelAI/Danbooru-style visual tags. No sentences or heading.',
    'Order tags roughly as subject/count, identity and appearance, clothing, action/pose/expression, objects, location, lighting, camera/composition, and style/details.',
    '', 'USER IMAGE IDEA:', String(userText || '').trim(),
  ].join('\n');
}

function ngV070CleanVisible(raw, preferTags) {
  return ngV055ExtractAiFinal(raw, Boolean(preferTags))
    .replace(/^\s*```(?:\w+)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function ngV070BuildTagLine(raw) {
  var prefs = ngV070AiPrefs();
  var prompt = ngV055NormalizeAiTags(raw).join(', ');
  if (prefs.aiHelperSuggestions) prompt = ngV040AppendTags(prompt, ngV040SuggestTags(prompt));
  if (prefs.aiHelperQuality) prompt = ngV040AppendTags(prompt, ngV040ModelQualityTags());
  return prompt.trim();
}

function ngV070BuildAiPrompt(raw, mode) {
  var visible = ngV070CleanVisible(raw, mode === 'tags');
  if (!visible) return '';
  if (mode === 'tags') return ngV070BuildTagLine(visible);
  if (mode === 'native') {
    return visible.replace(/^\s*(?:description|prompt|natural(?:-language)? prompt)\s*:\s*/i, '').trim();
  }

  var tags = '';
  var description = '';
  var marked = visible.match(/(?:^|\n)\s*TAGS?\s*:\s*([\s\S]*?)(?:\n\s*(?:DESCRIPTION|NATURAL(?:-LANGUAGE)? PROMPT)\s*:\s*)([\s\S]*)$/i);
  if (!marked) {
    // ngV055ExtractAiFinal intentionally strips a leading "TAGS:" final marker,
    // so also recognize the remaining tag line followed by DESCRIPTION.
    marked = visible.match(/^([\s\S]*?)(?:\n\s*(?:DESCRIPTION|NATURAL(?:-LANGUAGE)? PROMPT)\s*:\s*)([\s\S]*)$/i);
  }
  if (marked) {
    tags = marked[1].trim();
    description = marked[2].trim();
  } else {
    var blocks = visible.split(/\n\s*\n+/).map(function (part) { return part.trim(); }).filter(Boolean);
    var tagIndex = blocks.findIndex(function (part) { return (part.match(/,/g) || []).length >= 2; });
    if (tagIndex >= 0) {
      tags = blocks.splice(tagIndex, 1)[0];
      description = blocks.join(' ');
    } else {
      var lines = visible.split(/\n+/).map(function (part) { return part.trim(); }).filter(Boolean);
      tags = lines.shift() || '';
      description = lines.join(' ');
    }
  }
  tags = tags.replace(/^\s*TAGS?\s*:\s*/i, '');
  description = description.replace(/^\s*(?:DESCRIPTION|NATURAL(?:-LANGUAGE)? PROMPT)\s*:\s*/i, '').trim();
  var tagLine = ngV070BuildTagLine(tags);
  return [tagLine, description].filter(Boolean).join('\n\n');
}

function ngV070ModeCopy(mode) {
  if (mode === 'native') return { button: 'Create Natural Prompt', ready: 'Natural-language prompt ready.', placeholder: 'A detailed natural-language prompt appears here…' };
  if (mode === 'hybrid') return { button: 'Create Hybrid Prompt', ready: 'Hybrid tags + description prompt ready.', placeholder: 'English tags and a natural-language description appear here…' };
  return { button: 'Convert to Tags', ready: 'Tags ready.', placeholder: 'AI-generated tags appear here…' };
}

function ngV070RefreshAiHelperMode() {
  var mode = document.getElementById('ng-v070-ai-mode')?.value || ngV070AiPrefs().aiHelperMode;
  var copy = ngV070ModeCopy(mode);
  var button = document.getElementById('ng-v055-ai-run');
  var output = document.getElementById('ng-v055-ai-output');
  var language = document.getElementById('ng-v070-ai-language');
  if (button && !button.disabled) button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> ' + copy.button;
  if (output) output.placeholder = copy.placeholder;
  if (language) language.disabled = mode === 'tags';
}

ngV055RunAiHelper = async function () {
  var input = document.getElementById('ng-v055-ai-input');
  var output = document.getElementById('ng-v055-ai-output');
  var status = document.getElementById('ng-v055-ai-status');
  var button = document.getElementById('ng-v055-ai-run');
  var idea = String(input?.value || '').trim();
  if (!idea) return toast('warning', 'Describe the image you want first.');
  var prefs = ngV070AiPrefs();
  var mode = document.getElementById('ng-v070-ai-mode')?.value || prefs.aiHelperMode;
  var language = document.getElementById('ng-v070-ai-language')?.value || prefs.aiHelperLanguage;
  var context;
  try { context = ctx(); } catch {}
  if (!context || typeof context.generateQuietPrompt !== 'function') return toast('error', 'This SillyTavern build does not expose the current AI connection to extensions.');
  if (button) button.disabled = true;
  if (status) status.textContent = 'Using your current SillyTavern AI connection…';
  try {
    var reply = await context.generateQuietPrompt({ quietPrompt: ngV070AiInstruction(idea, mode, language) });
    var finalPrompt = ngV070BuildAiPrompt(reply, mode);
    if (!finalPrompt) throw new Error('The AI returned no usable prompt.');
    if (output) {
      output.value = finalPrompt;
      output.dataset.ngPromptFormat = mode;
      output.dispatchEvent(new Event('input', { bubbles: true }));
      output.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (status) status.textContent = ngV070ModeCopy(mode).ready + ' Review it, then replace or append to Prompt.';
  } catch (error) {
    console.error('[Novel Generation] AI Prompt Helper failed:', error);
    if (status) status.textContent = 'AI helper failed: ' + (error?.message || error);
    toast('error', 'AI Prompt Helper failed. Check your current SillyTavern AI connection.');
  } finally {
    if (button) button.disabled = false;
    ngV070RefreshAiHelperMode();
  }
};

ngV055ApplyPrompt = function (text, append) {
  if (!studio) return;
  var next = String(text || '').trim();
  if (!next) return;
  var format = document.getElementById('ng-v055-ai-output')?.dataset?.ngPromptFormat || 'tags';
  if (append && studio.prompt) {
    studio.prompt = format === 'tags'
      ? ngV040AppendTags(studio.prompt, ngV055NormalizeAiTags(next))
      : studio.prompt.trimEnd() + '\n\n' + next;
  } else {
    studio.prompt = next;
  }
  var textarea = document.getElementById('ng-prompt');
  if (textarea) {
    textarea.value = studio.prompt;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  }
};

ngV055AiHelperHtml = function () {
  var prefs = ngV070AiPrefs();
  var selected = function (value) { return prefs.aiHelperMode === value ? ' selected' : ''; };
  var languageSelected = function (value) { return prefs.aiHelperLanguage === value ? ' selected' : ''; };
  return '<details id="ng-v055-ai-helper" class="ng-studio-section ng-v055-ai-helper" data-focus="ai-helper">'
    + '<summary><i class="fa-solid fa-wand-magic-sparkles"></i><span>AI Prompt Helper</span><i class="fa-solid fa-chevron-down"></i></summary>'
    + '<div class="ng-studio-section-body">'
    + '<p class="ng-muted">Describe the image naturally in Thai, English, or another language, or attach a reference image below. Text ideas can become tags, natural language, or a V5-friendly hybrid.</p>'
    + '<label class="ng-field"><span class="ng-label">Image idea / requested changes</span><textarea id="ng-v055-ai-input" class="text_pole" rows="4" placeholder="ผู้หญิงใส่เสื้อแจ็คเก็ตยืนตากแดดที่สี่แยกเมืองชินจูกุ"></textarea></label>'
    + '<div class="ng-v070-ai-format">'
    + '<label class="ng-field"><span class="ng-label">Text result format</span><select id="ng-v070-ai-mode" class="text_pole"><option value="tags"' + selected('tags') + '>Pure Tags</option><option value="native"' + selected('native') + '>Natural Language</option><option value="hybrid"' + selected('hybrid') + '>Hybrid — Tags + Description</option></select><small class="ng-help">Hybrid uses English tags for attributes and a paragraph for composition and interaction.</small></label>'
    + '<label class="ng-field"><span class="ng-label">Description language</span><select id="ng-v070-ai-language" class="text_pole"><option value="auto"' + languageSelected('auto') + '>Auto / request language</option><option value="English"' + languageSelected('English') + '>English</option><option value="Thai"' + languageSelected('Thai') + '>ไทย (Thai)</option><option value="Japanese"' + languageSelected('Japanese') + '>日本語 (Japanese)</option><option value="Chinese"' + languageSelected('Chinese') + '>简体中文 (Chinese)</option><option value="Korean"' + languageSelected('Korean') + '>한국어 (Korean)</option><option value="Spanish"' + languageSelected('Spanish') + '>Español</option><option value="French"' + languageSelected('French') + '>Français</option><option value="German"' + languageSelected('German') + '>Deutsch</option><option value="Portuguese"' + languageSelected('Portuguese') + '>Português</option><option value="Vietnamese"' + languageSelected('Vietnamese') + '>Tiếng Việt</option></select><small class="ng-help">Pure Tags always outputs English Danbooru-style tags.</small></label>'
    + '</div><div class="ng-v055-ai-options">'
    + '<label class="checkbox_label"><input id="ng-v055-ai-quality" type="checkbox" ' + (prefs.aiHelperQuality ? 'checked' : '') + '><span>Add model-aware Quality Tags to Tags/Hybrid</span></label>'
    + '<label class="checkbox_label"><input id="ng-v055-ai-artists" type="checkbox" ' + (prefs.aiHelperArtists ? 'checked' : '') + '><span>Add selected Danbooru artist mix</span></label>'
    + '<label class="checkbox_label"><input id="ng-v055-ai-suggest" type="checkbox" ' + (prefs.aiHelperSuggestions ? 'checked' : '') + '><span>Add local Suggest Tags to Tags/Hybrid</span></label>'
    + '</div><div class="ng-actions"><button id="ng-v055-ai-run" class="menu_button" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> ' + ngV070ModeCopy(prefs.aiHelperMode).button + '</button></div>'
    + '<small id="ng-v055-ai-status" class="ng-help">Uses the same AI/model currently selected in SillyTavern and consumes one text-generation call.</small>'
    + '<label class="ng-field"><span class="ng-label">Generated prompt</span><textarea id="ng-v055-ai-output" class="text_pole" rows="7" placeholder="' + ngV070ModeCopy(prefs.aiHelperMode).placeholder + '"></textarea></label>'
    + '<div class="ng-actions ng-v055-ai-apply"><button id="ng-v055-ai-replace" class="menu_button" type="button">Replace Prompt</button><button id="ng-v055-ai-append" class="menu_button" type="button">Append to Prompt</button></div>'
    + '</div></details>';
};

function ngV070BindAiHelperControls() {
  var root = document.getElementById('ng-v055-ai-helper');
  if (!root || root.dataset.ngV070Bound) return;
  root.dataset.ngV070Bound = '1';
  var prefs = ngV070AiPrefs();
  document.getElementById('ng-v070-ai-mode')?.addEventListener('change', function (event) {
    prefs.aiHelperMode = ['tags', 'native', 'hybrid'].includes(event.currentTarget.value) ? event.currentTarget.value : 'tags';
    save();
    ngV070RefreshAiHelperMode();
  });
  document.getElementById('ng-v070-ai-language')?.addEventListener('change', function (event) {
    prefs.aiHelperLanguage = event.currentTarget.value || 'auto';
    save();
  });
  ngV070RefreshAiHelperMode();
}

var ngV070BaseInjectAiHelper = ngV055InjectAiHelper;
ngV055InjectAiHelper = function () {
  var result = ngV070BaseInjectAiHelper.apply(this, arguments);
  ngV070BindAiHelperControls();
  return result;
};

// Reference Image Analysis is bundled into the main extension module so the
// manifest loads one JavaScript file and one stylesheet.
/*
 * Novel Generation — inline reference-image analysis for AI Prompt Helper.
 * Uses SillyTavern's configured multimodal Image Captioning model, matching
 * Character Life's in-editor analysis flow. No separate overlay or Wand entry.
 */
(() => {
  'use strict';

  const EXT = 'novelGeneration';
  const ROOT_ID = 'ng-inline-image-helper';
  const DEFAULTS = Object.freeze({ preset: 'tags', language: 'auto' });
  const state = { image: null, result: '', busy: false };
  let fallbackSettings = { imageAnalysis: { ...DEFAULTS } };

  const byId = id => document.getElementById(id);
  const context = () => globalThis.SillyTavern?.getContext?.() || null;

  function extensionSettings() {
    try {
      const ctx = context();
      ctx.extensionSettings ??= {};
      ctx.extensionSettings[EXT] ??= {};
      const settings = ctx.extensionSettings[EXT];
      settings.imageAnalysis ??= {};
      for (const [key, value] of Object.entries(DEFAULTS)) {
        if (!(key in settings.imageAnalysis)) settings.imageAnalysis[key] = value;
      }
      return settings;
    } catch {
      return fallbackSettings;
    }
  }

  function saveSettings() {
    try { context()?.saveSettingsDebounced?.(); } catch { /* SillyTavern may still be mounting. */ }
  }

  function escapeHtml(value = '') {
    const node = document.createElement('div');
    node.textContent = String(value);
    return node.innerHTML;
  }

  function selected(actual, expected) {
    return actual === expected ? ' selected' : '';
  }

  function toast(kind, message) {
    const api = globalThis.toastr;
    if (api?.[kind]) api[kind](message, 'Novel Generation');
    else console[kind === 'error' ? 'error' : 'log']('[Novel Generation] ' + message);
  }

  function formatBytes(bytes) {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function languageLabel(value) {
    return ({
      auto: 'the same language as the user instruction; use English when it cannot be inferred',
      English: 'English',
      Thai: 'Thai',
      Japanese: 'Japanese',
      Chinese: 'Simplified Chinese',
      Korean: 'Korean',
      Spanish: 'Spanish',
      French: 'French',
      German: 'German',
      Portuguese: 'Portuguese',
      Vietnamese: 'Vietnamese',
    })[value] || value || 'English';
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('The image could not be read.'));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('The selected image is not readable.'));
      image.src = dataUrl;
    });
  }

  async function optimizeForAnalysis(dataUrl) {
    if (dataUrl.length < 6000000) return dataUrl;
    const image = await loadImage(dataUrl);
    const maxSide = 1800;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const paint = canvas.getContext('2d');
    if (!paint) throw new Error('This browser could not prepare the image for analysis.');
    paint.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.86);
  }

  async function setImageFile(file) {
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      toast('warning', 'Please choose an image file.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast('warning', 'Please choose an image smaller than 20 MB.');
      return;
    }
    try {
      setStatus('Preparing reference image…', 'working');
      const preview = await readFile(file);
      state.image = {
        name: file.name || 'selected-image',
        size: file.size,
        preview,
        analysis: await optimizeForAnalysis(preview),
      };
      state.result = '';
      render();
      setStatus('Image ready. Add optional instructions below, then analyze it.', 'ok');
    } catch (error) {
      setStatus(error?.message || 'The image could not be prepared.', 'error');
      toast('error', error?.message || 'The image could not be prepared.');
    }
  }

  function removeImage() {
    state.image = null;
    state.result = '';
    const input = byId('ng-inline-image-file');
    if (input) input.value = '';
    render();
    setStatus('Choose a reference image to analyze.');
  }

  function cleanResult(value, preset) {
    let text = typeof ngV055ExtractAiFinal === 'function'
      ? ngV055ExtractAiFinal(value, preset === 'tags')
      : String(value || '').trim();
    text = text.replace(/^\x60\x60\x60[a-z0-9_-]*\s*/i, '').replace(/\s*\x60\x60\x60$/i, '').trim();
    if (preset === 'tags') {
      text = text
        .replace(/^(tags?|prompt)\s*:\s*/i, '')
        .replace(/^[•*-]\s*/gm, '')
        .replace(/[\r\n;]+/g, ', ')
        .replace(/\s*,\s*/g, ', ')
        .replace(/\s{2,}/g, ' ')
        .replace(/^["']|["']$/g, '')
        .trim();
    }
    return text;
  }

  function analysisInstruction() {
    const settings = extensionSettings().imageAnalysis;
    const request = String(byId('ng-v055-ai-input')?.value || '').trim()
      || 'Create the most faithful image-generation prompt for this reference image.';
    const language = languageLabel(settings.language);
    const sharedRules = [
      'Inspect the attached image itself and describe only visibly supported details.',
      'Cover subject count, identity-defining appearance, clothing, pose, expression, objects, setting, composition, camera angle, framing, lighting, colors, materials, atmosphere, and visual style when visible.',
      'Do not identify real people. Do not infer hidden or sensitive facts. Preserve important visible details while following the user request.',
      'USER REQUEST OR CHANGES: ' + request,
    ];
    if (settings.preset === 'native') {
      return [
        'NOVEL GENERATION — REFERENCE IMAGE PROMPT',
        ...sharedRules,
        'Write one polished, detailed image-generation prompt in ' + language + '.',
        'Return only the final prompt as one paragraph. No heading, explanation, markdown, or code fence.',
        'Never emit <think>, <thinking>, <thoughts>, <planning>, <analysis>, or <reasoning> markup. Put the prompt in the final answer, never in a reasoning channel.',
      ].join('\n');
    }
    return [
      'NOVEL GENERATION — REFERENCE IMAGE TAG PROMPT',
      ...sharedRules,
      'Convert the image into precise NovelAI/Danbooru-style visual tags.',
      'Return only one comma-separated line of concise English tags. No sentences, heading, explanation, markdown, or code fence.',
      'Never emit <think>, <thinking>, <thoughts>, <planning>, <analysis>, or <reasoning> markup. Put the tags in the final answer, never in a reasoning channel.',
      'Order tags roughly as subject/count, identity and appearance, clothing, action/pose/expression, location, weather/lighting, camera/composition, and style/details.',
      'Never invent artist names.',
    ].join('\n');
  }

  function setStatus(message, kind = '') {
    const status = byId('ng-inline-image-status');
    if (!status) return;
    status.textContent = message;
    status.className = 'ng-inline-image-status' + (kind ? ' is-' + kind : '');
  }

  async function analyzeImage() {
    if (!state.image || state.busy) return;
    state.busy = true;
    render();
    setStatus('Analyzing with SillyTavern’s configured Image Captioning model…', 'working');
    try {
      const shared = await import('/scripts/extensions/shared.js');
      if (typeof shared.getMultimodalCaption !== 'function') {
        throw new Error('SillyTavern multimodal Image Captioning is unavailable.');
      }
      const raw = await shared.getMultimodalCaption(state.image.analysis, analysisInstruction());
      const preset = extensionSettings().imageAnalysis.preset;
      let result = cleanResult(raw, preset);
      if (preset === 'tags' && typeof ngV055BuildAiPrompt === 'function') result = ngV055BuildAiPrompt(result);
      if (!result) throw new Error('The Image Captioning model returned an empty prompt.');

      state.result = result;
      const output = byId('ng-v055-ai-output');
      if (output) {
        output.value = result;
        output.dataset.ngPromptFormat = preset;
        output.dispatchEvent(new Event('input', { bubbles: true }));
        output.dispatchEvent(new Event('change', { bubbles: true }));
      }
      setStatus('Image prompt ready in the shared result box below. Review it, then replace or append to Prompt.', 'ok');
    } catch (error) {
      console.error('[Novel Generation] Inline image analysis failed:', error);
      const message = error?.message || 'Image analysis failed.';
      setStatus('Analysis failed: ' + message + ' Configure SillyTavern Image Captioning, then try again.', 'error');
      toast('error', 'Image analysis failed. Check SillyTavern Image Captioning settings.');
    } finally {
      state.busy = false;
      render();
    }
  }

  function inlineHtml() {
    const analysis = extensionSettings().imageAnalysis;
    return [
      '<section id="' + ROOT_ID + '" class="ng-inline-image-helper">',
      '<header class="ng-inline-image-head"><i class="fa-solid fa-camera-retro"></i><span><strong>Reference Image Analysis</strong><small>Analyze inside AI Prompt Helper — no separate window</small></span></header>',
      '<div id="ng-inline-image-drop" class="ng-inline-image-drop">',
      '<div id="ng-inline-image-empty" class="ng-inline-image-empty"><i class="fa-regular fa-image"></i><strong>No reference image</strong><span>Choose an image below or drop one here</span></div>',
      '<img id="ng-inline-image-preview" hidden alt="Reference image preview">',
      '</div>',
      '<div class="ng-inline-image-actions">',
      '<label class="menu_button ng-inline-image-file-button"><i class="fa-solid fa-arrow-up-from-bracket"></i><span>Choose / replace image</span><input id="ng-inline-image-file" type="file" accept="image/*"></label>',
      '<button id="ng-inline-image-remove" class="menu_button ng-inline-image-remove" type="button" disabled><i class="fa-solid fa-trash"></i><span>Remove</span></button>',
      '</div>',
      '<small id="ng-inline-image-meta" class="ng-help">No image selected</small>',
      '<div class="ng-inline-image-options">',
      '<label class="ng-field"><span class="ng-label">Image result format</span><select id="ng-inline-image-preset" class="text_pole">',
      '<option value="tags"' + selected(analysis.preset, 'tags') + '>Pure tags prompt</option>',
      '<option value="native"' + selected(analysis.preset, 'native') + '>Native-language prompt</option>',
      '</select></label>',
      '<label class="ng-field"><span class="ng-label">Output language</span><select id="ng-inline-image-language" class="text_pole">',
      '<option value="auto"' + selected(analysis.language, 'auto') + '>Auto / instruction language</option>',
      '<option value="English"' + selected(analysis.language, 'English') + '>English</option>',
      '<option value="Thai"' + selected(analysis.language, 'Thai') + '>ไทย (Thai)</option>',
      '<option value="Japanese"' + selected(analysis.language, 'Japanese') + '>日本語 (Japanese)</option>',
      '<option value="Chinese"' + selected(analysis.language, 'Chinese') + '>简体中文 (Chinese)</option>',
      '<option value="Korean"' + selected(analysis.language, 'Korean') + '>한국어 (Korean)</option>',
      '<option value="Spanish"' + selected(analysis.language, 'Spanish') + '>Español</option>',
      '<option value="French"' + selected(analysis.language, 'French') + '>Français</option>',
      '<option value="German"' + selected(analysis.language, 'German') + '>Deutsch</option>',
      '<option value="Portuguese"' + selected(analysis.language, 'Portuguese') + '>Português</option>',
      '<option value="Vietnamese"' + selected(analysis.language, 'Vietnamese') + '>Tiếng Việt</option>',
      '</select></label>',
      '</div>',
      '<p class="ng-inline-image-note"><i class="fa-solid fa-circle-info"></i><span>The “Image idea / requested changes” box below is also used as the instruction for this image. Leave it empty for a faithful prompt.</span></p>',
      '<button id="ng-inline-image-analyze" class="menu_button ng-inline-image-analyze" type="button" disabled><i class="fa-solid fa-wand-magic-sparkles"></i><span>Analyze reference image</span></button>',
      '<small id="ng-inline-image-status" class="ng-inline-image-status">Choose a reference image to analyze. Uses one multimodal Image Captioning call.</small>',
      '</section>',
    ].join('');
  }

  function render() {
    const image = state.image;
    const preview = byId('ng-inline-image-preview');
    const empty = byId('ng-inline-image-empty');
    const drop = byId('ng-inline-image-drop');
    const remove = byId('ng-inline-image-remove');
    const analyze = byId('ng-inline-image-analyze');
    const meta = byId('ng-inline-image-meta');

    if (preview) {
      preview.hidden = !image;
      if (image) {
        preview.src = image.preview;
        preview.alt = image.name;
      } else {
        preview.removeAttribute('src');
      }
    }
    if (empty) empty.hidden = Boolean(image);
    drop?.classList.toggle('has-image', Boolean(image));
    if (remove) remove.disabled = !image || state.busy;
    if (analyze) {
      analyze.disabled = !image || state.busy;
      analyze.innerHTML = state.busy
        ? '<i class="fa-solid fa-spinner fa-spin"></i><span>Analyzing image…</span>'
        : '<i class="fa-solid fa-wand-magic-sparkles"></i><span>Analyze reference image</span>';
    }
    if (meta) meta.textContent = image ? image.name + ' · ' + formatBytes(image.size) : 'No image selected';
  }

  function bindInlineHelper() {
    const root = byId(ROOT_ID);
    if (!root || root.dataset.bound === 'true') return;
    root.dataset.bound = 'true';

    byId('ng-inline-image-file')?.addEventListener('change', async event => {
      await setImageFile(event.currentTarget.files?.[0]);
      event.currentTarget.value = '';
    });
    byId('ng-inline-image-remove')?.addEventListener('click', removeImage);
    byId('ng-inline-image-analyze')?.addEventListener('click', analyzeImage);

    const analysis = extensionSettings().imageAnalysis;
    byId('ng-inline-image-preset')?.addEventListener('change', event => {
      analysis.preset = event.currentTarget.value === 'native' ? 'native' : 'tags';
      saveSettings();
    });
    byId('ng-inline-image-language')?.addEventListener('change', event => {
      analysis.language = event.currentTarget.value || 'auto';
      saveSettings();
    });

    const drop = byId('ng-inline-image-drop');
    drop?.addEventListener('dragover', event => {
      event.preventDefault();
      drop.classList.add('is-dragging');
    });
    drop?.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
    drop?.addEventListener('drop', async event => {
      event.preventDefault();
      drop.classList.remove('is-dragging');
      await setImageFile(event.dataTransfer?.files?.[0]);
    });

    byId('ng-v055-ai-run')?.addEventListener('click', () => {
      const output = byId('ng-v055-ai-output');
      if (output) output.dataset.ngPromptFormat = 'tags';
    }, true);
  }

  function removeLegacyUi() {
    for (const id of ['ng-image-analyzer-overlay', 'ng-image-prompt-tools', 'ng-wand-image-analyzer', 'ng-open-image-analyzer']) {
      byId(id)?.remove();
    }
    byId('ng-image-analyzer-styles')?.remove();
    document.body?.classList.remove('ng-ia-open');
  }

  function mountInlineHelper() {
    removeLegacyUi();
    const helper = byId('ng-v055-ai-helper');
    if (!helper) return false;
    if (!byId(ROOT_ID)) {
      const body = helper.querySelector('.ng-studio-section-body');
      const ideaField = byId('ng-v055-ai-input')?.closest('label');
      if (!body) return false;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = inlineHtml();
      const root = wrapper.firstElementChild;
      if (ideaField) ideaField.insertAdjacentElement('beforebegin', root);
      else body.prepend(root);
    }
    bindInlineHelper();
    render();
    const output = byId('ng-v055-ai-output');
    if (output && state.result && !output.value.trim()) {
      output.value = state.result;
      output.dataset.ngPromptFormat = extensionSettings().imageAnalysis.preset;
    }
    return true;
  }

  function focusInlineHelper() {
    removeLegacyUi();
    try {
      if (!byId('ng-studio-overlay') && typeof openStudio === 'function') {
        openStudio('free', 'ai-helper');
      }
    } catch { /* Compatibility hook only. */ }
    setTimeout(() => {
      mountInlineHelper();
      const helper = byId('ng-v055-ai-helper');
      if (helper) {
        helper.open = true;
        helper.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 30);
  }

  globalThis.__novelGenerationImageAnalyzerReady = true;
  globalThis.__novelGenerationImageAnalyzerOpen = focusInlineHelper;

  removeLegacyUi();
  mountInlineHelper();

  // The previous document-wide MutationObserver called render() in response to
  // render()'s own DOM mutations, creating an endless microtask loop that froze
  // the Studio as soon as the inline helper appeared. Mount only from the
  // explicit Studio-ready lifecycle event instead.
  globalThis.__novelGenerationImageAnalyzerMountObserver?.disconnect?.();
  globalThis.__novelGenerationImageAnalyzerMountObserver = null;
  const previousReadyHandler = globalThis.__novelGenerationImageAnalyzerReadyHandler;
  if (previousReadyHandler) document.removeEventListener('novel-generation:studio-ready', previousReadyHandler);
  const readyHandler = () => mountInlineHelper();
  document.addEventListener('novel-generation:studio-ready', readyHandler);
  globalThis.__novelGenerationImageAnalyzerReadyHandler = readyHandler;
})();
})();
