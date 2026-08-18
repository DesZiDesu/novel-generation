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
  bind('ng-base-url', el => s.baseUrl = el.value.trim());
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
  bind('ng-width', el => { s.image.width = +el.value || 832; s.image.preset = 'custom'; });
  bind('ng-height', el => { s.image.height = +el.value || 1216; s.image.preset = 'custom'; });

  document.getElementById('ng-api-key')?.addEventListener('input', e => { apiKey = e.currentTarget.value; });
  document.getElementById('ng-key-eye')?.addEventListener('click', () => {
    const input = document.getElementById('ng-api-key');
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('ng-connect')?.addEventListener('click', connectAndLoadModels);
  document.querySelectorAll('#ng-settings .ng-size-choice').forEach(btn => btn.addEventListener('click', () => setSize('settings', btn.dataset.ngSize)));
  document.querySelectorAll('#ng-settings .ng-feature-open').forEach(btn => btn.addEventListener('click', () => openStudio('free', btn.dataset.feature)));
  document.getElementById('ng-gallery-open')?.addEventListener('click', () => openStudio('free', 'gallery'));
  document.getElementById('ng-gallery-export')?.addEventListener('click', exportGallery);
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
  if (target === 'settings') save();
  const root = target === 'settings' ? document.getElementById('ng-settings') : document.getElementById('ng-studio-overlay');
  root?.querySelectorAll('.ng-size-choice').forEach(btn => btn.classList.toggle('is-active', btn.dataset.ngSize === preset));
  const prefix = target === 'settings' ? 'ng' : 'ng-studio';
  root?.querySelector(`[data-ng-custom="${prefix}"]`)?.classList.toggle('is-visible', preset === 'custom');
  const width = document.getElementById(`${prefix}-width`);
  const height = document.getElementById(`${prefix}-height`);
  if (width) width.value = data.width;
  if (height) height.value = data.height;
}

const base = () => settings().baseUrl.trim().replace(/\/+$/, '');
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

function bindPress(row, handler) {
  const run = event => {
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    if (event.type === 'keydown') event.preventDefault();
    event.stopPropagation();
    handler(event);
  };
  row.addEventListener('click', run);
  row.addEventListener('keydown', run);
}
