const EXTENSION_NAME = 'novelGeneration';

const defaultSettings = {
  provider: 'custom',
  baseUrl: '',
  apiKey: '',
  model: 'nai-diffusion-4-5-full',
  responseFormat: 'b64_json',
  timeoutMs: 120000,
  imageDefaults: {
    width: 832,
    height: 1216,
    steps: 28,
    guidance: 5,
    sampler: 'k_euler_ancestral',
    scheduler: 'native',
    seed: -1,
    images: 1,
  },
  rpDefaults: {
    injectCharacter: true,
    injectPersona: true,
    includeLastMessage: true,
    saveToGallery: true,
  },
  advanced: {
    enableVibeTransfer: true,
    enablePreciseReference: true,
    enableInpaint: true,
    enableImg2Img: true,
    enableMultiCharacter: true,
  },
};

function getContext() {
  return SillyTavern.getContext();
}

function getSettings() {
  const ctx = getContext();
  ctx.extensionSettings[EXTENSION_NAME] ??= structuredClone(defaultSettings);
  const settings = ctx.extensionSettings[EXTENSION_NAME];

  settings.imageDefaults ??= structuredClone(defaultSettings.imageDefaults);
  settings.rpDefaults ??= structuredClone(defaultSettings.rpDefaults);
  settings.advanced ??= structuredClone(defaultSettings.advanced);

  for (const [key, value] of Object.entries(defaultSettings)) {
    if (!(key in settings)) settings[key] = structuredClone(value);
  }

  return settings;
}

function persistSettings() {
  const ctx = getContext();
  ctx.saveSettingsDebounced?.();
}

function escapeHtml(value = '') {
  const div = document.createElement('div');
  div.textContent = String(value);
  return div.innerHTML;
}

function createField(label, controlHtml, help = '') {
  return `
    <label class="ng-field">
      <span class="ng-label">${label}</span>
      ${controlHtml}
      ${help ? `<span class="ng-help">${help}</span>` : ''}
    </label>
  `;
}

function accordion(title, icon, body, id) {
  return `
    <details class="ng-card" id="${id}">
      <summary>
        <span class="ng-summary-left"><i class="fa-solid ${icon}"></i><span>${title}</span></span>
        <i class="fa-solid fa-chevron-down ng-chevron"></i>
      </summary>
      <div class="ng-card-body">${body}</div>
    </details>
  `;
}

function settingsHtml() {
  const s = getSettings();

  const connection = `
    <div class="ng-grid ng-grid-2">
      ${createField('Provider', `
        <select id="ng-provider" class="text_pole">
          <option value="custom" ${s.provider === 'custom' ? 'selected' : ''}>Custom / Reverse Proxy (OpenAI-compatible)</option>
        </select>
      `)}
      ${createField('Response format', `
        <select id="ng-response-format" class="text_pole">
          <option value="b64_json" ${s.responseFormat === 'b64_json' ? 'selected' : ''}>b64_json</option>
          <option value="url" ${s.responseFormat === 'url' ? 'selected' : ''}>url</option>
        </select>
      `)}
    </div>
    ${createField('Base URL', `<input id="ng-base-url" class="text_pole" type="url" value="${escapeHtml(s.baseUrl)}" placeholder="https://example.com/v1">`, 'The extension will use this URL for model discovery and image generation.')}
    ${createField('API Key', `
      <div class="ng-inline">
        <input id="ng-api-key" class="text_pole" type="password" value="${escapeHtml(s.apiKey)}" placeholder="sk-...">
        <button id="ng-toggle-key" class="menu_button" type="button" title="Show/hide API key"><i class="fa-solid fa-eye"></i></button>
      </div>
    `)}
    ${createField('Model', `<input id="ng-model" class="text_pole" type="text" value="${escapeHtml(s.model)}" placeholder="nai-diffusion-4-5-full">`)}
    <div class="ng-actions">
      <button id="ng-test-connection" class="menu_button"><i class="fa-solid fa-plug-circle-check"></i> Test Connection</button>
      <button id="ng-fetch-models" class="menu_button"><i class="fa-solid fa-magnifying-glass"></i> Find Models</button>
    </div>
    <div id="ng-connection-status" class="ng-status" aria-live="polite">Not tested yet.</div>
  `;

  const generation = `
    <div class="ng-grid ng-grid-2">
      ${createField('Width', `<input id="ng-width" class="text_pole" type="number" min="64" step="64" value="${s.imageDefaults.width}">`)}
      ${createField('Height', `<input id="ng-height" class="text_pole" type="number" min="64" step="64" value="${s.imageDefaults.height}">`)}
      ${createField('Steps', `<input id="ng-steps" class="text_pole" type="number" min="1" max="100" value="${s.imageDefaults.steps}">`)}
      ${createField('Guidance', `<input id="ng-guidance" class="text_pole" type="number" min="0" max="30" step="0.1" value="${s.imageDefaults.guidance}">`)}
      ${createField('Sampler', `<input id="ng-sampler" class="text_pole" type="text" value="${escapeHtml(s.imageDefaults.sampler)}">`)}
      ${createField('Scheduler', `<input id="ng-scheduler" class="text_pole" type="text" value="${escapeHtml(s.imageDefaults.scheduler)}">`)}
      ${createField('Seed', `<input id="ng-seed" class="text_pole" type="number" value="${s.imageDefaults.seed}">`, '-1 means random when supported by the provider.')}
      ${createField('Images', `<input id="ng-images" class="text_pole" type="number" min="1" max="8" value="${s.imageDefaults.images}">`)}
    </div>
  `;

  const roleplay = `
    <label class="ng-toggle-row"><span><strong>Character data</strong><small>Use active character information when building RP prompts.</small></span><input id="ng-rp-character" type="checkbox" ${s.rpDefaults.injectCharacter ? 'checked' : ''}></label>
    <label class="ng-toggle-row"><span><strong>Persona data</strong><small>Use the current user persona when applicable.</small></span><input id="ng-rp-persona" type="checkbox" ${s.rpDefaults.injectPersona ? 'checked' : ''}></label>
    <label class="ng-toggle-row"><span><strong>Last message context</strong><small>Use the latest roleplay message for scene generation.</small></span><input id="ng-rp-last-message" type="checkbox" ${s.rpDefaults.includeLastMessage ? 'checked' : ''}></label>
    <label class="ng-toggle-row"><span><strong>Save generations to gallery</strong><small>Keep generated image records for later export.</small></span><input id="ng-rp-gallery" type="checkbox" ${s.rpDefaults.saveToGallery ? 'checked' : ''}></label>
  `;

  const references = `
    <div class="ng-feature-grid">
      <div class="ng-feature-tile"><i class="fa-solid fa-wand-magic-sparkles"></i><div><strong>Vibe Transfer</strong><small>Reference image slots, strength, and information extraction controls.</small></div></div>
      <div class="ng-feature-tile"><i class="fa-solid fa-id-card-clip"></i><div><strong>Precise Reference</strong><small>Character/style reference controls with strength and fidelity.</small></div></div>
      <div class="ng-feature-tile"><i class="fa-solid fa-mask"></i><div><strong>Inpaint</strong><small>Image + mask workflow prepared for the full-screen generator.</small></div></div>
      <div class="ng-feature-tile"><i class="fa-solid fa-images"></i><div><strong>Image-to-Image</strong><small>Reference image, strength and noise workflow prepared.</small></div></div>
      <div class="ng-feature-tile"><i class="fa-solid fa-people-group"></i><div><strong>Multi Character</strong><small>Separate character prompt blocks and scene composition.</small></div></div>
    </div>
  `;

  const gallery = `
    <div class="ng-empty-state">
      <i class="fa-solid fa-photo-film"></i>
      <div><strong>Gallery storage is prepared</strong><small>Generated image metadata, download and export controls will live here as generation support is connected.</small></div>
    </div>
  `;

  const developer = `
    ${createField('Request timeout (ms)', `<input id="ng-timeout" class="text_pole" type="number" min="1000" step="1000" value="${s.timeoutMs}">`)}
    <div class="ng-note"><i class="fa-solid fa-shield-halved"></i><span>The API key is kept inside SillyTavern extension settings and is never printed into the UI status log.</span></div>
  `;

  return `
    <div id="ng-settings" class="ng-settings-root">
      <div class="ng-settings-header">
        <div class="ng-brand-mark"><i class="fa-solid fa-image"></i></div>
        <div><h3>Novel Generation</h3><p>Image generation, roleplay scene tools and advanced NovelAI-style controls.</p></div>
      </div>
      ${accordion('Connection & Provider', 'fa-link', connection, 'ng-card-connection')}
      ${accordion('Image Parameters', 'fa-sliders', generation, 'ng-card-generation')}
      ${accordion('Roleplay Integration', 'fa-comments', roleplay, 'ng-card-roleplay')}
      ${accordion('Vibe, Reference & Editing', 'fa-layer-group', references, 'ng-card-references')}
      ${accordion('Gallery & Export', 'fa-photo-film', gallery, 'ng-card-gallery')}
      ${accordion('Advanced / Developer', 'fa-code', developer, 'ng-card-developer')}
    </div>
  `;
}

function bindSettings() {
  const s = getSettings();
  const bind = (id, assign, event = 'input') => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(event, () => {
      assign(el);
      persistSettings();
    });
  };

  bind('ng-provider', el => s.provider = el.value, 'change');
  bind('ng-response-format', el => s.responseFormat = el.value, 'change');
  bind('ng-base-url', el => s.baseUrl = el.value.trim());
  bind('ng-api-key', el => s.apiKey = el.value);
  bind('ng-model', el => s.model = el.value.trim());
  bind('ng-width', el => s.imageDefaults.width = Number(el.value) || 832);
  bind('ng-height', el => s.imageDefaults.height = Number(el.value) || 1216);
  bind('ng-steps', el => s.imageDefaults.steps = Number(el.value) || 28);
  bind('ng-guidance', el => s.imageDefaults.guidance = Number(el.value) || 5);
  bind('ng-sampler', el => s.imageDefaults.sampler = el.value.trim());
  bind('ng-scheduler', el => s.imageDefaults.scheduler = el.value.trim());
  bind('ng-seed', el => s.imageDefaults.seed = Number(el.value));
  bind('ng-images', el => s.imageDefaults.images = Number(el.value) || 1);
  bind('ng-timeout', el => s.timeoutMs = Number(el.value) || 120000);
  bind('ng-rp-character', el => s.rpDefaults.injectCharacter = el.checked, 'change');
  bind('ng-rp-persona', el => s.rpDefaults.injectPersona = el.checked, 'change');
  bind('ng-rp-last-message', el => s.rpDefaults.includeLastMessage = el.checked, 'change');
  bind('ng-rp-gallery', el => s.rpDefaults.saveToGallery = el.checked, 'change');

  document.getElementById('ng-toggle-key')?.addEventListener('click', () => {
    const input = document.getElementById('ng-api-key');
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('ng-test-connection')?.addEventListener('click', testConnection);
  document.getElementById('ng-fetch-models')?.addEventListener('click', fetchModels);
}

function normalizedBaseUrl() {
  return getSettings().baseUrl.trim().replace(/\/+$/, '');
}

function headers() {
  const s = getSettings();
  return {
    'Content-Type': 'application/json',
    ...(s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {}),
  };
}

function modelsUrl() {
  const base = normalizedBaseUrl();
  if (!base) return '';
  return /\/v1$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
}

async function testConnection() {
  const status = document.getElementById('ng-connection-status');
  const s = getSettings();
  if (!s.baseUrl) {
    toastr.warning('Enter a Base URL first.', 'Novel Generation');
    return;
  }
  status.textContent = 'Testing connection…';
  status.className = 'ng-status is-testing';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, s.timeoutMs));
  try {
    const res = await fetch(modelsUrl(), { headers: headers(), signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    status.textContent = 'Connected successfully.';
    status.className = 'ng-status is-ok';
    toastr.success('Connection successful.', 'Novel Generation');
  } catch (err) {
    status.textContent = `Connection failed: ${err?.message ?? 'Unknown error'}`;
    status.className = 'ng-status is-error';
    toastr.error(status.textContent, 'Novel Generation');
  } finally {
    clearTimeout(timer);
  }
}

async function fetchModels() {
  const s = getSettings();
  if (!s.baseUrl) {
    toastr.warning('Enter a Base URL first.', 'Novel Generation');
    return;
  }
  try {
    const res = await fetch(modelsUrl(), { headers: headers() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = Array.isArray(data?.data) ? data.data.map(x => x.id).filter(Boolean) : [];
    if (!models.length) {
      toastr.info('The endpoint responded, but no model list was returned.', 'Novel Generation');
      return;
    }
    const preferred = models.find(m => /nai.*4.?5.*full/i.test(m)) ?? models[0];
    s.model = preferred;
    const modelInput = document.getElementById('ng-model');
    if (modelInput) modelInput.value = preferred;
    persistSettings();
    toastr.success(`Found ${models.length} model${models.length === 1 ? '' : 's'}. Selected ${preferred}.`, 'Novel Generation');
  } catch (err) {
    toastr.error(`Model discovery failed: ${err?.message ?? 'Unknown error'}`, 'Novel Generation');
  }
}

function makeWandButton(id, icon, label, handler) {
  if (document.getElementById(id)) return;
  const menu = document.getElementById('extensionsMenu');
  if (!menu) return;
  const item = document.createElement('div');
  item.id = id;
  item.className = 'list-group-item flex-container flexGap5 interactable';
  item.tabIndex = 0;
  item.innerHTML = `<i class="fa-solid ${icon}"></i><span>${label}</span>`;
  item.addEventListener('click', handler);
  item.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') handler();
  });
  menu.appendChild(item);
}

function ensureQuickMenu() {
  if (document.getElementById('ng-quick-submenu')) return document.getElementById('ng-quick-submenu');
  const menu = document.createElement('div');
  menu.id = 'ng-quick-submenu';
  menu.className = 'ng-quick-menu';
  menu.innerHTML = `
    <button data-ng-mode="portrait"><i class="fa-solid fa-user"></i><span>Portrait</span></button>
    <button data-ng-mode="selfie"><i class="fa-solid fa-face-smile"></i><span>Selfie</span></button>
    <button data-ng-mode="user"><i class="fa-solid fa-user-astronaut"></i><span>User</span></button>
    <button data-ng-mode="last"><i class="fa-solid fa-message"></i><span>Last Message</span></button>
    <button data-ng-mode="manga"><i class="fa-solid fa-table-cells-large"></i><span>Manga Panel</span></button>
    <button data-ng-mode="free"><i class="fa-solid fa-pen-nib"></i><span>Free / Scene</span></button>
  `;
  menu.addEventListener('click', e => {
    const btn = e.target.closest('button[data-ng-mode]');
    if (!btn) return;
    openStudio(btn.dataset.ngMode);
    menu.classList.remove('is-open');
  });
  document.body.appendChild(menu);
  return menu;
}

function positionQuickMenu(anchor) {
  const menu = ensureQuickMenu();
  const rect = anchor.getBoundingClientRect();
  const maxWidth = Math.min(360, window.innerWidth - 24);
  menu.style.width = `${maxWidth}px`;
  menu.style.left = `${Math.max(12, Math.min(window.innerWidth - maxWidth - 12, rect.right + 8))}px`;
  menu.style.top = `${Math.max(12, Math.min(window.innerHeight - menu.offsetHeight - 12, rect.top - 8))}px`;
  menu.classList.toggle('is-open');
}

function studioHtml(mode = 'free') {
  const modeName = {
    portrait: 'Portrait', selfie: 'Selfie', user: 'User', last: 'Last Message', manga: 'Manga Panel', free: 'Free / Scene'
  }[mode] ?? 'Free / Scene';

  return `
    <div class="ng-studio-shell" role="dialog" aria-modal="true" aria-label="Novel Gen">
      <header class="ng-studio-header">
        <div class="ng-studio-title"><div class="ng-brand-mark"><i class="fa-solid fa-wand-magic-sparkles"></i></div><div><strong>Novel Gen</strong><small>${modeName}</small></div></div>
        <button id="ng-studio-close" class="ng-icon-button" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </header>
      <main class="ng-studio-main">
        <section class="ng-studio-preview">
          <div class="ng-preview-placeholder"><i class="fa-regular fa-image"></i><strong>Generation workspace</strong><span>Preview and gallery output will appear here.</span></div>
        </section>
        <aside class="ng-studio-controls">
          <div class="ng-studio-modebar">
            <button class="active">${modeName}</button><button>Gallery</button>
          </div>
          <details class="ng-card" open>
            <summary><span class="ng-summary-left"><i class="fa-solid fa-pen"></i><span>Prompt</span></span><i class="fa-solid fa-chevron-down ng-chevron"></i></summary>
            <div class="ng-card-body">
              <label class="ng-field"><span class="ng-label">Prompt</span><textarea id="ng-studio-prompt" class="text_pole" rows="6" placeholder="Describe the image…"></textarea></label>
              <label class="ng-field"><span class="ng-label">Undesired Content</span><textarea id="ng-studio-negative" class="text_pole" rows="3" placeholder="What should not appear…"></textarea></label>
            </div>
          </details>
          <details class="ng-card"><summary><span class="ng-summary-left"><i class="fa-solid fa-people-group"></i><span>Character Prompts</span></span><i class="fa-solid fa-chevron-down ng-chevron"></i></summary><div class="ng-card-body"><button class="menu_button"><i class="fa-solid fa-plus"></i> Add Character</button><p class="ng-muted">Separate character prompt blocks and positioning controls are prepared for the generation phase.</p></div></details>
          <details class="ng-card"><summary><span class="ng-summary-left"><i class="fa-solid fa-wand-magic-sparkles"></i><span>Vibe Transfer</span></span><i class="fa-solid fa-chevron-down ng-chevron"></i></summary><div class="ng-card-body"><div class="ng-upload-zone"><i class="fa-solid fa-arrow-up-from-bracket"></i><strong>Add reference image</strong><span>Strength and information extraction controls will appear per image.</span></div></div></details>
          <details class="ng-card"><summary><span class="ng-summary-left"><i class="fa-solid fa-id-card-clip"></i><span>Precise Reference</span></span><i class="fa-solid fa-chevron-down ng-chevron"></i></summary><div class="ng-card-body"><div class="ng-upload-zone"><i class="fa-solid fa-arrow-up-from-bracket"></i><strong>Add reference</strong><span>Character, style, strength and fidelity controls.</span></div></div></details>
          <details class="ng-card"><summary><span class="ng-summary-left"><i class="fa-solid fa-mask"></i><span>Inpaint / Image-to-Image</span></span><i class="fa-solid fa-chevron-down ng-chevron"></i></summary><div class="ng-card-body"><div class="ng-upload-zone"><i class="fa-regular fa-images"></i><strong>Upload source image</strong><span>Mask editor and image strength controls are staged for implementation.</span></div></div></details>
          <details class="ng-card"><summary><span class="ng-summary-left"><i class="fa-solid fa-sliders"></i><span>Image Parameters</span></span><i class="fa-solid fa-chevron-down ng-chevron"></i></summary><div class="ng-card-body"><p class="ng-muted">Uses the defaults configured in the Extension drawer. Per-generation overrides will be added here.</p></div></details>
        </aside>
      </main>
      <footer class="ng-studio-footer">
        <button id="ng-studio-generate" class="ng-primary-button"><i class="fa-solid fa-sparkles"></i> Generate</button>
      </footer>
    </div>
  `;
}

function openStudio(mode = 'free') {
  closeStudio();
  const overlay = document.createElement('div');
  overlay.id = 'ng-studio-overlay';
  overlay.className = 'ng-studio-overlay';
  overlay.innerHTML = studioHtml(mode);
  document.body.appendChild(overlay);
  document.body.classList.add('ng-studio-open');
  document.getElementById('ng-studio-close')?.addEventListener('click', closeStudio);
  document.getElementById('ng-studio-generate')?.addEventListener('click', () => {
    toastr.info('The generator UI is ready. API generation wiring is the next implementation phase.', 'Novel Generation');
  });
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeStudio();
  });
}

function closeStudio() {
  document.getElementById('ng-studio-overlay')?.remove();
  document.body.classList.remove('ng-studio-open');
}

function initWandMenu() {
  makeWandButton('ng-wand-generate', 'fa-image', 'Novel Image Gen', function () { positionQuickMenu(this); });
  makeWandButton('ng-wand-studio', 'fa-wand-magic-sparkles', 'Novel Gen', () => openStudio('free'));
}

function injectSettingsDrawer() {
  const host = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
  if (!host || document.getElementById('ng-settings')) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = settingsHtml();
  host.appendChild(wrapper.firstElementChild);
  bindSettings();
}

function init() {
  getSettings();
  injectSettingsDrawer();
  initWandMenu();

  const observer = new MutationObserver(() => {
    injectSettingsDrawer();
    initWandMenu();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
