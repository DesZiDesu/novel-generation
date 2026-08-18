const EXT = 'novelGeneration';
const VERSION = '0.2.0';
const SIZES = {
  portrait: [832, 1216, 'Portrait'],
  square: [1024, 1024, 'Square'],
  landscape: [1216, 832, 'Landscape'],
};
const DEFAULTS = {
  baseUrl: '',
  model: 'nai-diffusion-4-5-full',
  responseFormat: 'b64_json',
  compatibility: 'auto',
  timeoutMs: 120000,
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
  },
};

let apiKey = '';
let models = [];
let studio = null;
const gallery = [];
let escapeHandler = null;

const ctx = () => SillyTavern.getContext();
const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));

function settings() {
  const c = ctx();
  c.extensionSettings[EXT] ??= clone(DEFAULTS);
  const s = c.extensionSettings[EXT];

  s.image ??= clone(DEFAULTS.image);
  s.roleplay ??= clone(DEFAULTS.roleplay);
  for (const [k, v] of Object.entries(DEFAULTS)) if (!(k in s)) s[k] = clone(v);
  for (const [k, v] of Object.entries(DEFAULTS.image)) if (!(k in s.image)) s.image[k] = clone(v);
  for (const [k, v] of Object.entries(DEFAULTS.roleplay)) if (!(k in s.roleplay)) s.roleplay[k] = clone(v);

  if (typeof s.apiKey === 'string' && s.apiKey && !apiKey) apiKey = s.apiKey;
  if ('apiKey' in s) {
    delete s.apiKey;
    c.saveSettingsDebounced?.();
  }
  return s;
}
const save = () => ctx().saveSettingsDebounced?.();

function esc(value = '') {
  const d = document.createElement('div');
  d.textContent = String(value);
  return d.innerHTML;
}
const attr = value => esc(value).replace(/"/g, '&quot;');

function field(label, control, help = '') {
  return `<label class="ng-field"><span class="ng-label">${label}</span>${control}${help ? `<small class="ng-help">${help}</small>` : ''}</label>`;
}
function section(id, icon, title, subtitle, body) {
  return `<details class="ng-section" id="${id}"><summary><span class="ng-section-icon"><i class="fa-solid ${icon}"></i></span><span class="ng-section-copy"><strong>${title}</strong><small>${subtitle}</small></span><i class="fa-solid fa-chevron-down ng-section-chevron"></i></summary><div class="ng-section-body">${body}</div></details>`;
}
function sizePicker(prefix, image) {
  const preset = image.preset || 'portrait';
  const buttons = Object.entries(SIZES).map(([key, [w, h, label]]) =>
    `<button type="button" class="menu_button ng-size-choice ${preset === key ? 'is-active' : ''}" data-ng-prefix="${prefix}" data-ng-size="${key}"><i class="fa-solid ${key === 'portrait' ? 'fa-mobile-screen' : key === 'square' ? 'fa-square' : 'fa-panorama'}"></i><span><strong>${label}</strong><small>${w} × ${h}</small></span></button>`
  ).join('');
  return `<div class="ng-size-chooser">${buttons}<button type="button" class="menu_button ng-size-choice ${preset === 'custom' ? 'is-active' : ''}" data-ng-prefix="${prefix}" data-ng-size="custom"><i class="fa-solid fa-crop-simple"></i><span><strong>Custom</strong><small>Custom size</small></span></button></div>
  <div class="ng-custom-size ${preset === 'custom' ? 'is-visible' : ''}" data-ng-custom="${prefix}">
    ${field('Width', `<input id="${prefix}-width" class="text_pole" type="number" min="64" step="64" value="${image.width}">`)}
    ${field('Height', `<input id="${prefix}-height" class="text_pole" type="number" min="64" step="64" value="${image.height}">`)}
  </div>`;
}

function settingsHtml() {
  const s = settings();
  const connection = `
    ${field('Base URL', `<input id="ng-base-url" class="text_pole" type="url" value="${attr(s.baseUrl)}" placeholder="https://example.com/v1">`)}
    ${field('API Key', `<div class="ng-key-row"><input id="ng-api-key" class="text_pole" type="password" value="${attr(apiKey)}" placeholder="Paste API key"><button id="ng-key-eye" class="menu_button" type="button"><i class="fa-solid fa-eye"></i></button></div>`, 'Kept in memory for this browser session; it is not saved back into extensionSettings.')}
    <button id="ng-connect" class="menu_button" type="button"><i class="fa-solid fa-plug-circle-check"></i> Test connection & load models</button>
    <div id="ng-status" class="ng-status">Not connected yet.</div>
    ${field('Available model', `<select id="ng-model" class="text_pole" disabled><option>${esc(s.model)}</option></select>`, 'A successful connection test loads the real /v1/models list so you can choose the model directly.')}
    <div class="ng-grid ng-grid-2">
      ${field('Response format', `<select id="ng-format" class="text_pole"><option value="b64_json" ${s.responseFormat === 'b64_json' ? 'selected' : ''}>b64_json</option><option value="url" ${s.responseFormat === 'url' ? 'selected' : ''}>url</option></select>`)}
      ${field('Compatibility', `<select id="ng-compat" class="text_pole"><option value="auto" ${s.compatibility === 'auto' ? 'selected' : ''}>Auto / proxy extras</option><option value="strict" ${s.compatibility === 'strict' ? 'selected' : ''}>Strict OpenAI</option></select>`, 'Auto includes NovelAI-oriented parameters. Strict sends only standard OpenAI image fields.')}
    </div>`;
  const image = `
    <p class="ng-muted">Smart choice: pick a normal scene shape first, or switch to Custom for manual dimensions.</p>
    ${sizePicker('ng', s.image)}
    <div class="ng-grid ng-grid-2">
      ${field('Steps', `<input id="ng-steps" class="text_pole" type="number" min="1" max="100" value="${s.image.steps}">`)}
      ${field('Guidance', `<input id="ng-guidance" class="text_pole" type="number" min="0" max="30" step="0.1" value="${s.image.guidance}">`)}
      ${field('Sampler', `<select id="ng-sampler" class="text_pole"><option value="k_euler_ancestral">Euler Ancestral</option><option value="k_dpmpp_2m">DPM++ 2M</option><option value="k_euler">Euler</option><option value="k_dpmpp_sde">DPM++ SDE</option></select>`)}
      ${field('Scheduler', `<select id="ng-scheduler" class="text_pole"><option value="native">Provider default</option><option value="karras">Karras</option><option value="exponential">Exponential</option></select>`)}
      ${field('Seed', `<input id="ng-seed" class="text_pole" type="number" value="${s.image.seed}">`)}
      ${field('Images', `<input id="ng-n" class="text_pole" type="number" min="1" max="4" value="${s.image.n}">`)}
    </div>`;
  const roleplay = `
    <label class="checkbox_label"><input id="ng-rp-character" type="checkbox" ${s.roleplay.character ? 'checked' : ''}><span>Use active character data</span></label>
    <label class="checkbox_label"><input id="ng-rp-persona" type="checkbox" ${s.roleplay.persona ? 'checked' : ''}><span>Use current persona data</span></label>
    <label class="checkbox_label"><input id="ng-rp-last" type="checkbox" ${s.roleplay.lastMessage ? 'checked' : ''}><span>Prefill the latest roleplay message</span></label>
    <label class="checkbox_label"><input id="ng-rp-gallery" type="checkbox" ${s.roleplay.gallery ? 'checked' : ''}><span>Save successful images to session gallery</span></label>`;
  const features = `
    <div class="ng-feature-actions">
      <button class="menu_button ng-feature-open" data-feature="vibe" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i><span><strong>Vibe Transfer</strong><small>Upload references + strength + information extraction</small></span></button>
      <button class="menu_button ng-feature-open" data-feature="precise" type="button"><i class="fa-solid fa-id-card-clip"></i><span><strong>Precise Reference</strong><small>Character/style type + strength + fidelity</small></span></button>
      <button class="menu_button ng-feature-open" data-feature="edit" type="button"><i class="fa-solid fa-mask"></i><span><strong>Image-to-Image / Inpaint</strong><small>Source image, optional mask, strength and noise</small></span></button>
      <button class="menu_button ng-feature-open" data-feature="characters" type="button"><i class="fa-solid fa-people-group"></i><span><strong>Character Prompts</strong><small>Separate prompts for multi-character scenes</small></span></button>
    </div>`;
  const galleryHtml = `<div class="ng-actions"><button id="ng-gallery-open" class="menu_button" type="button"><i class="fa-solid fa-images"></i> Open gallery</button><button id="ng-gallery-export" class="menu_button" type="button"><i class="fa-solid fa-file-export"></i> Export metadata</button></div>`;
  const advanced = `${field('Timeout (ms)', `<input id="ng-timeout" class="text_pole" type="number" min="1000" step="1000" value="${s.timeoutMs}">`)}<p class="ng-muted">Vibe / Precise / Inpaint controls now work as real upload-and-parameter controls. Whether the proxy executes those fields still depends on the provider's advanced schema.</p>`;

  return `<div id="ng-settings" class="ng-settings-root"><div class="inline-drawer">
    <div id="ng-drawer-toggle" class="inline-drawer-toggle inline-drawer-header interactable" tabindex="0" role="button" aria-expanded="false"><b><i class="fa-solid fa-image"></i> Novel Generation <span class="ng-version">v${VERSION}</span></b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
    <div class="inline-drawer-content"><p class="ng-settings-copy">NovelAI-oriented image generation for roleplay and standalone use.</p>
      ${section('ng-connection', 'fa-link', 'Connection & Provider', 'API connection and model selection', connection)}
      ${section('ng-image', 'fa-sliders', 'Image Parameters', 'Smart size and generation defaults', image)}
      ${section('ng-roleplay', 'fa-comments', 'Roleplay Integration', 'Choose what chat context can be used', roleplay)}
      ${section('ng-features', 'fa-layer-group', 'Vibe, Reference & Editing', 'Open the actual advanced controls', features)}
      ${section('ng-gallery', 'fa-photo-film', 'Gallery & Export', 'Current-session images and metadata', galleryHtml)}
      ${section('ng-advanced', 'fa-code', 'Advanced', 'Compatibility and request behavior', advanced)}
    </div>
  </div></div>`;
}

function bindDrawer() {
  const toggle = document.getElementById('ng-drawer-toggle');
  const content = document.querySelector('#ng-settings .inline-drawer-content');
  const icon = toggle?.querySelector('.inline-drawer-icon');
  if (!toggle || !content) return;
  content.style.display = 'none';
  const flip = event => {
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    if (event.type === 'keydown') event.preventDefault();
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    content.style.display = open ? '' : 'none';
    icon?.classList.toggle('down', !open);
    icon?.classList.toggle('up', open);
  };
  toggle.addEventListener('click', flip);
  toggle.addEventListener('keydown', flip);
}

function bindSettings() {
  const s = settings();
  const bind = (id, fn, event = 'input') => document.getElementById(id)?.addEventListener(event, e => { fn(e.currentTarget); save(); });
  bind('ng-base-url', el => s.baseUrl = el.value.trim());
  bind('ng-format', el => s.responseFormat = el.value, 'change');
  bind('ng-compat', el => s.compatibility = el.value, 'change');
  bind('ng-model', el => s.model = el.value, 'change');
  bind('ng-steps', el => s.image.steps = +el.value || 28);
  bind('ng-guidance', el => s.image.guidance = +el.value || 5);
  bind('ng-sampler', el => s.image.sampler = el.value, 'change');
  bind('ng-scheduler', el => s.image.scheduler = el.value, 'change');
  bind('ng-seed', el => s.image.seed = +el.value);
  bind('ng-n', el => s.image.n = Math.max(1, Math.min(4, +el.value || 1)));
  bind('ng-timeout', el => s.timeoutMs = +el.value || 120000);
  bind('ng-rp-character', el => s.roleplay.character = el.checked, 'change');
  bind('ng-rp-persona', el => s.roleplay.persona = el.checked, 'change');
  bind('ng-rp-last', el => s.roleplay.lastMessage = el.checked, 'change');
  bind('ng-rp-gallery', el => s.roleplay.gallery = el.checked, 'change');
  bind('ng-width', el => { s.image.width = +el.value || 832; s.image.preset = 'custom'; });
  bind('ng-height', el => { s.image.height = +el.value || 1216; s.image.preset = 'custom'; });

  document.getElementById('ng-api-key')?.addEventListener('input', e => apiKey = e.currentTarget.value);
  document.getElementById('ng-key-eye')?.addEventListener('click', () => {
    const input = document.getElementById('ng-api-key');
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('ng-connect')?.addEventListener('click', connectAndLoadModels);
  document.querySelectorAll('#ng-settings .ng-size-choice').forEach(btn => btn.addEventListener('click', () => setSize('settings', btn.dataset.ngSize)));
  document.querySelectorAll('.ng-feature-open').forEach(btn => btn.addEventListener('click', () => openStudio('free', btn.dataset.feature)));
  document.getElementById('ng-gallery-open')?.addEventListener('click', () => openStudio('free', 'gallery'));
  document.getElementById('ng-gallery-export')?.addEventListener('click', exportGallery);
  document.getElementById('ng-sampler').value = s.image.sampler;
  document.getElementById('ng-scheduler').value = s.image.scheduler;
  bindDrawer();
}

function setSize(target, preset) {
  const data = target === 'settings' ? settings().image : studio;
  data.preset = preset;
  if (SIZES[preset]) [data.width, data.height] = SIZES[preset];
  if (target === 'settings') save();

  const root = target === 'settings' ? document.getElementById('ng-settings') : document.getElementById('ng-studio-overlay');
  root?.querySelectorAll('.ng-size-choice').forEach(btn => btn.classList.toggle('is-active', btn.dataset.ngSize === preset));
  root?.querySelector(`[data-ng-custom="${target === 'settings' ? 'ng' : 'ng-studio'}"]`)?.classList.toggle('is-visible', preset === 'custom');

  const prefix = target === 'settings' ? 'ng' : 'ng-studio';
  const w = document.getElementById(`${prefix}-width`);
  const h = document.getElementById(`${prefix}-height`);
  if (w) w.value = data.width;
  if (h) h.value = data.height;
}

const base = () => settings().baseUrl.trim().replace(/\/+$/, '');
const endpoint = path => /\/v1$/i.test(base()) ? `${base()}${path.replace('/v1', '')}` : `${base()}${path}`;
const headers = () => ({ 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) });

async function errText(res) {
  try {
    const t = await res.text();
    return t ? t.slice(0, 400) : res.statusText;
  } catch { return res.statusText; }
}
function modelIds(data) {
  const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  return [...new Set(arr.map(x => typeof x === 'string' ? x : x?.id || x?.name).filter(Boolean))];
}
function status(text, state = '') {
  const el = document.getElementById('ng-status');
  if (el) { el.textContent = text; el.className = `ng-status ${state ? `is-${state}` : ''}`; }
}
async function connectAndLoadModels() {
  const s = settings();
  if (!base()) return toastr.warning('Enter a Base URL first.', 'Novel Generation');
  if (!apiKey) return toastr.warning('Enter an API key first.', 'Novel Generation');
  const button = document.getElementById('ng-connect');
  button?.setAttribute('disabled', 'disabled');
  status('Testing connection and loading models…', 'testing');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, s.timeoutMs));
  try {
    const res = await fetch(endpoint('/v1/models'), { headers: headers(), signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await errText(res)}`);
    models = modelIds(await res.json());
    if (!models.length) throw new Error('Connected, but /v1/models returned no selectable model list.');

    const select = document.getElementById('ng-model');
    select.innerHTML = models.map(m => `<option value="${attr(m)}">${esc(m)}</option>`).join('');
    const preferred = models.includes(s.model) ? s.model : models.find(m => /nai.*4.?5.*full/i.test(m)) || models[0];
    s.model = preferred;
    select.value = preferred;
    select.disabled = false;
    save();

    status(`Connected. ${models.length} model${models.length === 1 ? '' : 's'} available.`, 'ok');
    toastr.success('Connected. Choose a model from the list.', 'Novel Generation');
  } catch (e) {
    status(`Connection failed: ${e.message}`, 'error');
    toastr.error(`Connection failed: ${e.message}`, 'Novel Generation');
  } finally {
    clearTimeout(timer);
    button?.removeAttribute('disabled');
  }
}

function wandItem(id, icon, label, onClick) {
  if (document.getElementById(id)) return document.getElementById(id);
  const menu = document.getElementById('extensionsMenu');
  if (!menu) return null;
  const item = document.createElement('div');
  item.id = id;
  item.className = 'list-group-item flex-container flexGap5 interactable';
  item.tabIndex = 0;
  item.setAttribute('role', 'button');
  item.innerHTML = `<i class="fa-solid ${icon}"></i><span>${label}</span>`;
  const run = e => {
    if (e.type === 'keydown' && !['Enter', ' '].includes(e.key)) return;
    if (e.type === 'keydown') e.preventDefault();
    e.stopPropagation();
    onClick(item);
  };
  item.addEventListener('click', run);
  item.addEventListener('keydown', run);
  menu.appendChild(item);
  return item;
}
function initWand() {
  const quick = wandItem('ng-wand-image', 'fa-image', 'Novel Image Gen', item => {
    const sub = document.getElementById('ng-wand-submenu');
    if (sub) sub.hidden = !sub.hidden;
  });
  if (!quick) return;

  if (!document.getElementById('ng-wand-submenu')) {
    const sub = document.createElement('div');
    sub.id = 'ng-wand-submenu';
    sub.className = 'ng-wand-submenu';
    sub.hidden = true;
    const items = [
      ['portrait', 'fa-user', 'Portrait'], ['selfie', 'fa-face-smile', 'Selfie'], ['user', 'fa-user', 'User'],
      ['last', 'fa-message', 'Last Message'], ['manga', 'fa-table-cells-large', 'Manga Panel'], ['free', 'fa-pen-nib', 'Free / Scene'],
    ];
    for (const [mode, icon, label] of items) {
      const row = document.createElement('div');
      row.className = 'list-group-item flex-container flexGap5 interactable ng-wand-subitem';
      row.tabIndex = 0;
      row.innerHTML = `<i class="fa-solid ${icon}"></i><span>${label}</span>`;
      const open = e => {
        if (e.type === 'keydown' && !['Enter', ' '].includes(e.key)) return;
        e.stopPropagation();
        sub.hidden = true;
        setTimeout(() => openStudio(mode, 'prompt'), 0);
      };
      row.addEventListener('click', open);
      row.addEventListener('keydown', open);
      sub.appendChild(row);
    }
    quick.insertAdjacentElement('afterend', sub);
  }

  if (!document.getElementById('ng-wand-studio')) {
    const studioBtn = document.createElement('div');
    studioBtn.id = 'ng-wand-studio';
    studioBtn.className = 'list-group-item flex-container flexGap5 interactable';
    studioBtn.tabIndex = 0;
    studioBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i><span>Novel Gen</span>';
    const open = e => {
      if (e.type === 'keydown' && !['Enter', ' '].includes(e.key)) return;
      e.stopPropagation();
      setTimeout(() => openStudio('free', 'prompt'), 0);
    };
    studioBtn.addEventListener('click', open);
    studioBtn.addEventListener('keydown', open);
    document.getElementById('ng-wand-submenu').insertAdjacentElement('afterend', studioBtn);
  }
}

function lastMessage() {
  try { return String(ctx().chat?.at(-1)?.mes || '').trim(); } catch { return ''; }
}
function characterName() {
  try { return String(ctx().name2 || ctx().characters?.[ctx().characterId]?.name || '').trim(); } catch { return ''; }
}
function modePrompt(mode) {
  const char = characterName(), last = lastMessage();
  if (mode === 'portrait') return char ? `portrait of ${char}, detailed character illustration` : 'detailed character portrait';
  if (mode === 'selfie') return char ? `${char} taking a selfie, candid composition` : 'character taking a selfie, candid composition';
  if (mode === 'user') return 'portrait of the user persona, detailed character illustration';
  if (mode === 'last') return last;
  if (mode === 'manga') return last ? `manga panel, ${last}` : 'manga panel, dynamic composition';
  return '';
}
function newStudio(mode, focus) {
  const s = settings().image;
  return {
    mode, focus, prompt: modePrompt(mode), negative: '',
    preset: s.preset, width: s.width, height: s.height, steps: s.steps, guidance: s.guidance,
    sampler: s.sampler, scheduler: s.scheduler, seed: s.seed, n: s.n,
    characters: [], vibes: [], precise: [], source: null, mask: null, editMode: 'img2img', strength: .6, noise: .1,
  };
}

function studioHtml() {
  const s = studio;
  const modeName = ({portrait:'Portrait', selfie:'Selfie', user:'User', last:'Last Message', manga:'Manga Panel', free:'Free / Scene'})[s.mode] || 'Free / Scene';
  return `<div class="ng-studio-shell" role="dialog" aria-modal="true">
    <header class="ng-studio-header"><div class="ng-studio-title"><i class="fa-solid fa-wand-magic-sparkles"></i><span><strong>Novel Gen</strong><small>${modeName}</small></span></div><button id="ng-close" class="menu_button ng-studio-close" type="button"><i class="fa-solid fa-xmark"></i></button></header>
    <main class="ng-studio-main">
      <section id="ng-preview" class="ng-studio-preview"><div class="ng-preview-empty"><i class="fa-regular fa-image"></i><strong>Ready to generate</strong><span>Generated images appear here.</span></div></section>
      <aside class="ng-studio-controls">
        <div class="ng-studio-tabs"><button class="menu_button is-active" data-tab="generate" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate</button><button class="menu_button" data-tab="gallery" type="button"><i class="fa-solid fa-images"></i> Gallery <span id="ng-gallery-count">${gallery.length}</span></button></div>
        <div id="ng-generate-panel">
          ${studioSection('prompt','fa-pen','Prompt', `${field('Prompt', `<textarea id="ng-prompt" class="text_pole" rows="7">${esc(s.prompt)}</textarea>`)}${field('Undesired Content', `<textarea id="ng-negative" class="text_pole" rows="4"></textarea>`)}`, true)}
          ${studioSection('characters','fa-people-group','Character Prompts', `<div id="ng-character-list"></div><button id="ng-character-add" class="menu_button" type="button"><i class="fa-solid fa-plus"></i> Add Character</button>`)}
          ${studioSection('vibe','fa-wand-magic-sparkles','Vibe Transfer', `<label class="menu_button ng-file-button"><i class="fa-solid fa-upload"></i> Add vibe image<input id="ng-vibe-file" type="file" accept="image/*" multiple></label><div id="ng-vibe-list" class="ng-reference-list"></div>`)}
          ${studioSection('precise','fa-id-card-clip','Precise Reference', `<label class="menu_button ng-file-button"><i class="fa-solid fa-upload"></i> Add precise reference<input id="ng-precise-file" type="file" accept="image/*" multiple></label><div id="ng-precise-list" class="ng-reference-list"></div>`)}
          ${studioSection('edit','fa-mask','Image-to-Image / Inpaint', `${field('Mode', `<select id="ng-edit-mode" class="text_pole"><option value="img2img">Image-to-Image</option><option value="inpaint">Inpaint</option></select>`)}<div class="ng-edit-upload-grid"><label class="ng-upload-box"><span>Source image</span><input id="ng-source-file" type="file" accept="image/*"><img id="ng-source-preview" hidden></label><label class="ng-upload-box"><span>Mask</span><input id="ng-mask-file" type="file" accept="image/*"><img id="ng-mask-preview" hidden></label></div>${range('ng-strength','Strength',s.strength)}${range('ng-noise','Noise',s.noise)}`)}
          ${studioSection('parameters','fa-sliders','Image Parameters', `${sizePicker('ng-studio', s)}<div class="ng-grid ng-grid-2">${field('Steps', `<input id="ng-studio-steps" class="text_pole" type="number" value="${s.steps}">`)}${field('Guidance', `<input id="ng-studio-guidance" class="text_pole" type="number" step=".1" value="${s.guidance}">`)}${field('Sampler', `<select id="ng-studio-sampler" class="text_pole"><option value="k_euler_ancestral">Euler Ancestral</option><option value="k_dpmpp_2m">DPM++ 2M</option><option value="k_euler">Euler</option><option value="k_dpmpp_sde">DPM++ SDE</option></select>`)}${field('Scheduler', `<select id="ng-studio-scheduler" class="text_pole"><option value="native">Provider default</option><option value="karras">Karras</option><option value="exponential">Exponential</option></select>`)}${field('Seed', `<input id="ng-studio-seed" class="text_pole" type="number" value="${s.seed}">`)}${field('Images', `<input id="ng-studio-n" class="text_pole" type="number" min="1" max="4" value="${s.n}">`)}</div>`)}
        </div>
        <div id="ng-gallery-panel" hidden><div id="ng-gallery-grid" class="ng-gallery-grid"></div></div>
      </aside>
    </main>
    <footer class="ng-studio-footer"><div id="ng-gen-status" class="ng-generation-status"></div><button id="ng-generate" class="menu_button" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate</button></footer>
  </div>`;
}
function studioSection(focus, icon, title, body, open = false) {
  return `<details class="ng-studio-section" data-focus="${focus}" ${open ? 'open' : ''}><summary><i class="fa-solid ${icon}"></i><span>${title}</span><i class="fa-solid fa-chevron-down"></i></summary><div class="ng-studio-section-body">${body}</div></details>`;
}
function range(id, label, value) {
  return `<label class="ng-range-row"><span>${label} <output>${Number(value).toFixed(2)}</output></span><input id="${id}" type="range" min="0" max="1" step=".01" value="${value}"></label>`;
}

function openStudio(mode='free', focus='prompt') {
  closeStudio();
  studio = newStudio(mode, focus);
  const overlay = document.createElement('div');
  overlay.id = 'ng-studio-overlay';
  overlay.className = 'ng-studio-overlay';
  overlay.innerHTML = studioHtml();
  document.documentElement.appendChild(overlay);
  document.body?.classList.add('ng-studio-open');
  bindStudio();

  if (focus === 'gallery') switchTab('gallery');
  else {
    const target = overlay.querySelector(`[data-focus="${focus}"]`);
    if (target) { target.open = true; setTimeout(() => target.scrollIntoView({block:'nearest'}), 20); }
  }
  escapeHandler = e => { if (e.key === 'Escape') closeStudio(); };
  document.addEventListener('keydown', escapeHandler);
}
function closeStudio() {
  document.getElementById('ng-studio-overlay')?.remove();
  document.body?.classList.remove('ng-studio-open');
  if (escapeHandler) document.removeEventListener('keydown', escapeHandler);
  escapeHandler = null;
}

function bindStudio() {
  document.getElementById('ng-close')?.addEventListener('click', closeStudio);
  document.getElementById('ng-studio-overlay')?.addEventListener('pointerdown', e => e.stopPropagation());
  document.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  document.getElementById('ng-prompt')?.addEventListener('input', e => studio.prompt = e.currentTarget.value);
  document.getElementById('ng-negative')?.addEventListener('input', e => studio.negative = e.currentTarget.value);
  document.getElementById('ng-edit-mode')?.addEventListener('change', e => studio.editMode = e.currentTarget.value);
  document.getElementById('ng-character-add')?.addEventListener('click', () => { studio.characters.push({prompt:'', position:'auto'}); renderCharacters(); });
  document.getElementById('ng-vibe-file')?.addEventListener('change', async e => { await addRefs(e.currentTarget.files, 'vibe'); e.currentTarget.value=''; });
  document.getElementById('ng-precise-file')?.addEventListener('change', async e => { await addRefs(e.currentTarget.files, 'precise'); e.currentTarget.value=''; });
  document.getElementById('ng-source-file')?.addEventListener('change', async e => { studio.source = await readRef(e.currentTarget.files?.[0]); showUpload('ng-source-preview', studio.source); });
  document.getElementById('ng-mask-file')?.addEventListener('change', async e => { studio.mask = await readRef(e.currentTarget.files?.[0]); showUpload('ng-mask-preview', studio.mask); });

  [['ng-strength','strength'],['ng-noise','noise']].forEach(([id,key]) => {
    const el = document.getElementById(id);
    el?.addEventListener('input', () => { studio[key] = +el.value; el.closest('.ng-range-row').querySelector('output').textContent = (+el.value).toFixed(2); });
  });
  [['ng-studio-steps','steps'],['ng-studio-guidance','guidance'],['ng-studio-seed','seed'],['ng-studio-n','n'],['ng-studio-width','width'],['ng-studio-height','height']].forEach(([id,key]) => {
    document.getElementById(id)?.addEventListener('input', e => studio[key] = +e.currentTarget.value);
  });
  const sampler = document.getElementById('ng-studio-sampler'), scheduler = document.getElementById('ng-studio-scheduler');
  sampler.value = studio.sampler; scheduler.value = studio.scheduler;
  sampler.addEventListener('change', () => studio.sampler = sampler.value);
  scheduler.addEventListener('change', () => studio.scheduler = scheduler.value);
  document.querySelectorAll('#ng-studio-overlay .ng-size-choice').forEach(btn => btn.addEventListener('click', () => setSize('studio', btn.dataset.ngSize)));
  document.getElementById('ng-generate')?.addEventListener('click', generate);
  renderCharacters(); renderRefs('vibe'); renderRefs('precise'); renderGallery();
}
function switchTab(tab) {
  document.querySelectorAll('[data-tab]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.tab === tab));
  const gen = document.getElementById('ng-generate-panel'), gal = document.getElementById('ng-gallery-panel'), button = document.getElementById('ng-generate');
  if (gen) gen.hidden = tab !== 'generate';
  if (gal) gal.hidden = tab !== 'gallery';
  if (button) button.hidden = tab !== 'generate';
  if (tab === 'gallery') renderGallery();
}

function dataUrl(file) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
async function readRef(file) {
  if (!file) return null;
  const url = await dataUrl(file);
  return { id:`${Date.now()}-${Math.random().toString(36).slice(2)}`, name:file.name || 'image.png', url, base64:url.split(',')[1] || '' };
}
async function addRefs(files, kind) {
  const list = kind === 'vibe' ? studio.vibes : studio.precise;
  for (const file of Array.from(files || [])) {
    const ref = await readRef(file);
    if (kind === 'vibe') list.push({...ref, strength:.6, information:1});
    else list.push({...ref, type:'character', strength:1, fidelity:1});
  }
  renderRefs(kind);
}
function renderRefs(kind) {
  const container = document.getElementById(kind === 'vibe' ? 'ng-vibe-list' : 'ng-precise-list');
  if (!container) return;
  const list = kind === 'vibe' ? studio.vibes : studio.precise;
  if (!list.length) return container.innerHTML = '<p class="ng-muted">No reference images added.</p>';
  container.innerHTML = list.map((ref,i) => `<article class="ng-reference-card"><img src="${attr(ref.url)}"><div class="ng-reference-controls"><div class="ng-reference-head"><strong>${esc(ref.name)}</strong><button class="menu_button ng-ref-delete" data-i="${i}" type="button"><i class="fa-solid fa-trash"></i></button></div>${kind === 'precise' ? field('Type', `<select class="text_pole ng-ref-type" data-i="${i}"><option value="character">Character</option><option value="style">Style</option><option value="character&style">Character + Style</option></select>`) : ''}${refRange(i,'strength','Strength',ref.strength)}${kind === 'vibe' ? refRange(i,'information','Information',ref.information) : refRange(i,'fidelity','Fidelity',ref.fidelity)}</div></article>`).join('');
  container.querySelectorAll('.ng-ref-delete').forEach(btn => btn.addEventListener('click', () => { list.splice(+btn.dataset.i,1); renderRefs(kind); }));
  container.querySelectorAll('.ng-ref-type').forEach(sel => { sel.value = list[+sel.dataset.i].type; sel.addEventListener('change', () => list[+sel.dataset.i].type = sel.value); });
  container.querySelectorAll('[data-ref-key]').forEach(input => input.addEventListener('input', () => { list[+input.dataset.i][input.dataset.refKey] = +input.value; input.closest('.ng-range-row').querySelector('output').textContent=(+input.value).toFixed(2); }));
}
function refRange(i,key,label,value) {
  return `<label class="ng-range-row"><span>${label} <output>${Number(value).toFixed(2)}</output></span><input data-i="${i}" data-ref-key="${key}" type="range" min="0" max="1" step=".01" value="${value}"></label>`;
}
function renderCharacters() {
  const container = document.getElementById('ng-character-list');
  if (!container) return;
  if (!studio.characters.length) return container.innerHTML = '<p class="ng-muted">No separate character prompts yet.</p>';
  container.innerHTML = studio.characters.map((c,i) => `<div class="ng-character-card"><div class="ng-reference-head"><strong>Character ${i+1}</strong><button class="menu_button ng-char-delete" data-i="${i}" type="button"><i class="fa-solid fa-trash"></i></button></div>${field('Prompt', `<textarea class="text_pole ng-char-prompt" data-i="${i}" rows="3">${esc(c.prompt)}</textarea>`)}${field('Position', `<select class="text_pole ng-char-pos" data-i="${i}"><option value="auto">Auto</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select>`)}</div>`).join('');
  container.querySelectorAll('.ng-char-delete').forEach(btn => btn.addEventListener('click', () => { studio.characters.splice(+btn.dataset.i,1); renderCharacters(); }));
  container.querySelectorAll('.ng-char-prompt').forEach(el => el.addEventListener('input', () => studio.characters[+el.dataset.i].prompt = el.value));
  container.querySelectorAll('.ng-char-pos').forEach(el => { el.value = studio.characters[+el.dataset.i].position; el.addEventListener('change', () => studio.characters[+el.dataset.i].position = el.value); });
}
function showUpload(id, ref) {
  const img = document.getElementById(id);
  if (img && ref) { img.src = ref.url; img.hidden = false; }
}

function strictPayload() {
  const s = settings();
  return { model:s.model, prompt:studio.prompt.trim(), n:Math.max(1,Math.min(4,+studio.n||1)), size:`${studio.width}x${studio.height}`, response_format:s.responseFormat };
}
function proxyPayload() {
  const p = strictPayload();
  Object.assign(p, {
    negative_prompt: studio.negative.trim(), width:studio.width, height:studio.height, steps:studio.steps,
    guidance:studio.guidance, scale:studio.guidance, sampler:studio.sampler, scheduler:studio.scheduler,
    noise_schedule: studio.scheduler === 'native' ? undefined : studio.scheduler, seed:studio.seed,
  });
  if (studio.characters.some(c => c.prompt.trim())) p.character_prompts = studio.characters.filter(c => c.prompt.trim()).map(c => ({prompt:c.prompt.trim(), position:c.position}));
  if (studio.vibes.length) p.vibe_transfer = studio.vibes.map(r => ({image:r.base64, strength:r.strength, information_extracted:r.information}));
  if (studio.precise.length) p.precise_reference = studio.precise.map(r => ({image:r.base64, type:r.type, strength:r.strength, fidelity:r.fidelity}));
  if (studio.source) Object.assign(p, {image:studio.source.base64, action:studio.editMode, strength:studio.strength, noise:studio.noise});
  if (studio.editMode === 'inpaint' && studio.mask) p.mask = studio.mask.base64;
  for (const k of Object.keys(p)) if (p[k] === '' || p[k] == null) delete p[k];
  return p;
}
async function generate() {
  const s = settings();
  if (!base()) return toastr.warning('Set Base URL in the Novel Generation drawer first.', 'Novel Generation');
  if (!apiKey) return toastr.warning('Enter and test the API key first.', 'Novel Generation');
  if (!s.model) return toastr.warning('Select a model first.', 'Novel Generation');
  if (!studio.prompt.trim()) return toastr.warning('Enter a prompt first.', 'Novel Generation');

  const button = document.getElementById('ng-generate'), out = document.getElementById('ng-gen-status');
  button?.setAttribute('disabled','disabled'); if (out) out.textContent='Generating…';
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.max(1000,s.timeoutMs));
  try {
    const payload = s.compatibility === 'strict' ? strictPayload() : proxyPayload();
    const res = await fetch(endpoint('/v1/images/generations'), {method:'POST', headers:headers(), body:JSON.stringify(payload), signal:controller.signal});
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await errText(res)}`);
    const images = extractImages(await res.json());
    if (!images.length) throw new Error('The proxy returned no image URL or base64 image.');
    showImages(images);
    if (s.roleplay.gallery) {
      images.forEach(src => gallery.unshift({id:`${Date.now()}-${Math.random().toString(36).slice(2)}`,src,prompt:studio.prompt,negative:studio.negative,model:s.model,width:studio.width,height:studio.height,seed:studio.seed,createdAt:new Date().toISOString()}));
      gallery.splice(30);
      const count = document.getElementById('ng-gallery-count'); if (count) count.textContent=gallery.length;
    }
    if (out) out.textContent=`Generated ${images.length} image${images.length===1?'':'s'}.`;
  } catch (e) {
    if (out) out.textContent=`Generation failed: ${e.message}`;
    toastr.error(e.message, 'Novel Generation');
  } finally { clearTimeout(timer); button?.removeAttribute('disabled'); }
}
function extractImages(data) {
  const out = [], items = Array.isArray(data?.data) ? data.data : Array.isArray(data?.images) ? data.images : [];
  for (const item of items) {
    if (typeof item === 'string') out.push(norm(item));
    else if (item?.b64_json) out.push(`data:image/png;base64,${item.b64_json}`);
    else if (item?.base64) out.push(norm(item.base64));
    else if (item?.url) out.push(norm(item.url));
  }
  if (!out.length && data?.url) out.push(norm(data.url));
  if (!out.length && data?.b64_json) out.push(`data:image/png;base64,${data.b64_json}`);
  return out.filter(Boolean);
}
function norm(v) {
  const t=String(v||'').trim();
  if (!t) return '';
  if (/^(data:image\/|https?:\/\/|blob:)/i.test(t)) return t;
  return t.length>200 ? `data:image/png;base64,${t.replace(/\s+/g,'')}` : t;
}
function showImages(images) {
  const preview=document.getElementById('ng-preview');
  if (!preview) return;
  preview.innerHTML=`<div class="ng-generated-grid">${images.map((src,i)=>`<figure class="ng-generated-card"><img src="${attr(src)}"><figcaption><a class="menu_button" href="${attr(src)}" download="novel-generation-${Date.now()}-${i+1}.png"><i class="fa-solid fa-download"></i> Save</a></figcaption></figure>`).join('')}</div>`;
}
function renderGallery() {
  const grid=document.getElementById('ng-gallery-grid');
  if (!grid) return;
  if (!gallery.length) return grid.innerHTML='<div class="ng-preview-empty"><i class="fa-regular fa-images"></i><strong>No images yet</strong><span>Successful generations appear here.</span></div>';
  grid.innerHTML=gallery.map(item=>`<article class="ng-gallery-item"><img src="${attr(item.src)}"><div><strong>${esc(item.model)}</strong><small>${item.width} × ${item.height}</small></div><a class="menu_button" href="${attr(item.src)}" download="novel-generation-${item.id}.png"><i class="fa-solid fa-download"></i></a></article>`).join('');
}
function exportGallery() {
  const metadata=gallery.map(({src,...rest})=>rest), blob=new Blob([JSON.stringify(metadata,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=`novel-generation-gallery-${Date.now()}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function injectSettings() {
  const host=document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
  if (!host || document.getElementById('ng-settings')) return;
  const wrap=document.createElement('div'); wrap.innerHTML=settingsHtml(); host.appendChild(wrap.firstElementChild); bindSettings();
}
function init() {
  settings(); injectSettings(); initWand();
  new MutationObserver(()=>{injectSettings();initWand();}).observe(document.body,{childList:true,subtree:true});
}
if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
