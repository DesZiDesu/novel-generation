// Novel Generation v0.5.0 — single-runtime SillyTavern extension
// Safe bootstrap remains in bootstrap.js. This file intentionally avoids a global MutationObserver.

const EXT = 'novelGeneration';
const VERSION = '0.5.0';
const DANBOORU = 'https://danbooru.donmai.us';

const SIZE_PRESETS = [
  { id: 'portrait-small', group: 'Portrait', label: 'Small Portrait · 512 × 768', width: 512, height: 768 },
  { id: 'portrait-3x4', group: 'Portrait', label: 'Portrait 3:4 · 768 × 1024', width: 768, height: 1024 },
  { id: 'portrait-normal', group: 'Portrait', label: 'Portrait · 832 × 1216', width: 832, height: 1216 },
  { id: 'portrait-tall', group: 'Portrait', label: 'Tall Portrait · 768 × 1344', width: 768, height: 1344 },
  { id: 'portrait-large', group: 'Portrait', label: 'Large Portrait · 1024 × 1536', width: 1024, height: 1536 },
  { id: 'square-small', group: 'Square', label: 'Small Square · 512 × 512', width: 512, height: 512 },
  { id: 'square-medium', group: 'Square', label: 'Medium Square · 768 × 768', width: 768, height: 768 },
  { id: 'square-normal', group: 'Square', label: 'Square · 1024 × 1024', width: 1024, height: 1024 },
  { id: 'square-large', group: 'Square', label: 'Large Square · 1472 × 1472', width: 1472, height: 1472 },
  { id: 'landscape-small', group: 'Landscape', label: 'Small Landscape · 768 × 512', width: 768, height: 512 },
  { id: 'landscape-4x3', group: 'Landscape', label: 'Landscape 4:3 · 1024 × 768', width: 1024, height: 768 },
  { id: 'landscape-normal', group: 'Landscape', label: 'Landscape · 1216 × 832', width: 1216, height: 832 },
  { id: 'landscape-wide', group: 'Landscape', label: 'Wide Landscape · 1344 × 768', width: 1344, height: 768 },
  { id: 'landscape-large', group: 'Landscape', label: 'Large Landscape · 1536 × 1024', width: 1536, height: 1024 },
  { id: 'custom', group: 'Custom', label: 'Custom size', width: 832, height: 1216 },
];

const PARAM_PRESETS = {
  balanced: { label: 'Balanced V4/V4.5', steps: 28, guidance: 5, sampler: 'k_euler_ancestral', scheduler: 'karras' },
  dpm: { label: 'DPM++ 2M', steps: 28, guidance: 5, sampler: 'k_dpmpp_2m', scheduler: 'karras' },
  fast: { label: 'Fast Preview', steps: 20, guidance: 5, sampler: 'k_euler_ancestral', scheduler: 'karras' },
  detail: { label: 'More Iterations', steps: 32, guidance: 5, sampler: 'k_dpmpp_2m', scheduler: 'karras' },
};

const SAMPLERS = [
  ['k_euler_ancestral', 'Euler Ancestral — recommended'],
  ['k_dpmpp_2m', 'DPM++ 2M — recommended'],
  ['k_euler', 'Euler'],
  ['k_dpm_2', 'DPM2'],
  ['k_dpmpp_2s_ancestral', 'DPM++ 2S Ancestral'],
  ['k_dpmpp_sde', 'DPM++ SDE'],
  ['k_dpm_fast', 'DPM Fast'],
  ['ddim_v3', 'DDIM'],
];

const SCHEDULERS = [
  ['native', 'Provider default'],
  ['karras', 'Karras'],
  ['exponential', 'Exponential'],
  ['polyexponential', 'Polyexponential'],
];

const TAGS = {
  quality: ['masterpiece', 'very aesthetic', 'best quality', 'amazing quality', 'great quality', 'location', 'no text', 'absurdres'],
  aesthetic: ['masterpiece', 'top aesthetic', 'very aesthetic', 'aesthetic', 'displeasing', 'very displeasing'],
  special: ['year 2026', 'year 2020', 'year 2018', 'year 2014', 'fur dataset', 'background dataset', 'location', 'no text'],
  roles: ['source#hug', 'target#hug', 'mutual#hug', 'source#kiss', 'target#kiss', 'mutual#kiss', 'source#holding hands', 'target#holding hands', 'mutual#holding hands', 'source#looking at another', 'target#looking at another'],
  weighting: ['{tag}', '{{tag}}', '[tag]', '[[tag]]', '1.15::tag ::', '1.3::tag ::', '1.5::tag ::', '0.8::tag ::', '0.5::tag ::', '-1::tag ::'],
  negative: ['lowres', 'artistic error', 'film grain', 'scan artifacts', 'worst quality', 'bad quality', 'jpeg artifacts', 'very displeasing', 'chromatic aberration', 'dithering', 'halftone', 'screentone', 'multiple views', 'logo', 'too many watermarks', 'negative space', 'blank page', 'bad anatomy', 'bad hands'],
  medium: ['traditional media', 'faux traditional media', 'mixed media', 'watercolor (medium)', 'oil painting (medium)', 'ink (medium)', 'colored pencil (medium)', 'anime screencap', 'pixel art', 'game cg', 'official art'],
  art: ['anime coloring', 'cel shading', 'soft shading', 'painterly', 'sketch', 'lineart', 'no lineart', 'pastel colors', 'muted color', 'vibrant colors', 'monochrome', 'greyscale', 'high contrast'],
  fx: ['backlighting', 'rim lighting', 'dramatic lighting', 'volumetric lighting', 'golden hour', 'moonlight', 'bloom', 'bokeh', 'depth of field', 'lens flare', 'motion blur', 'soft focus', 'sparkle'],
  camera: ['portrait', 'close-up', 'upper body', 'cowboy shot', 'full body', 'wide shot', 'pov', 'perspective', 'dutch angle', 'fisheye', 'from above', 'from below', 'from behind', 'dynamic angle', 'face focus'],
  character: ['solo', '1girl', '1boy', '2girls', '2boys', '1girl, 1boy', 'looking at viewer', 'looking away', 'looking at another', 'eye contact', 'smile', 'blush', 'open mouth', 'windblown hair'],
  costume: ['school uniform', 'casual clothes', 'dress', 'armor', 'swimsuit', 'alternate costume', 'official alternate costume', 'damaged clothes', 'wet clothes', 'jacket', 'hoodie'],
  rating: ['rating:general', 'rating:sensitive', 'rating:questionable', 'rating:explicit'],
};

const UC_PRESETS = {
  none: '',
  light: 'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
  human: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy',
  heavy: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
};

const QUICK_PRESETS = {
  portrait: ['portrait', 'solo', 'upper body', 'looking at viewer', 'detailed face', 'depth of field'],
  selfie: ['selfie', 'looking at viewer', 'close-up', 'face focus', 'candid', 'natural lighting'],
  manga: ['manga', 'monochrome', 'screentone', 'dramatic composition', 'dynamic angle'],
  scenery: ['background dataset', 'scenery', 'wide shot', 'atmospheric perspective', 'detailed background'],
  romantic: ['romantic atmosphere', 'soft lighting', 'blush', 'warm colors', 'depth of field'],
  action: ['dynamic pose', 'action scene', 'motion blur', 'dramatic lighting', 'dynamic angle'],
};

const DEFAULTS = {
  baseUrl: '',
  model: 'nai-diffusion-4-5-full',
  responseFormat: 'b64_json',
  timeoutMs: 120000,
  routeMode: 'images',
  autoInsertTarget: 'assistant',
  image: {
    preset: 'portrait-normal',
    width: 832,
    height: 1216,
    steps: 28,
    guidance: 5,
    sampler: 'k_euler_ancestral',
    scheduler: 'karras',
    seed: -1,
    n: 1,
    smeaMode: 'off',
    decrisper: false,
    prefix: '',
    suffix: '',
    negativePreset: 'human',
    defaultNegative: '',
    extraBody: '',
  },
  roleplay: {
    character: true,
    persona: true,
    lastMessage: true,
    gallery: true,
    autoInsert: true,
    personaPresence: 'auto',
    contextMessages: 4,
    perMessageChars: 1200,
    contextChars: 7000,
    quickPreview: true,
  },
  promptAssistant: {
    autoQuality: true,
    useArtistsQuick: true,
    selectedArtists: [],
    presets: [],
  },
};

let apiKey = '';
let models = [];
let studio = null;
let gallery = [];
let debugLog = [];
let mountTimer = null;
let mountAttempts = 0;
let artistDebounce = null;
const artistCache = new Map();
const providerCaps = { wrapper: 'unknown', nativeGenerate: 'unknown', encodeVibe: 'unknown', checkedAt: '' };

function ctx() {
  return globalThis.SillyTavern?.getContext?.() || globalThis.getContext?.() || {};
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return target;
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
      deepMerge(target[key], value);
    } else if (target[key] === undefined) {
      target[key] = clone(value);
    }
  }
  return target;
}

function settings() {
  const c = ctx();
  c.extensionSettings ??= {};
  c.extensionSettings[EXT] ??= {};
  const s = c.extensionSettings[EXT];
  deepMerge(s, DEFAULTS);

  const oldMap = { portrait: 'portrait-normal', square: 'square-normal', landscape: 'landscape-normal' };
  if (oldMap[s.image?.preset]) s.image.preset = oldMap[s.image.preset];
  if (!SIZE_PRESETS.some(item => item.id === s.image?.preset)) s.image.preset = 'custom';
  if (!Array.isArray(s.promptAssistant.selectedArtists)) s.promptAssistant.selectedArtists = [];
  if (!Array.isArray(s.promptAssistant.presets)) s.promptAssistant.presets = [];
  return s;
}

function save() {
  try { ctx().saveSettingsDebounced?.(); } catch {}
  try { globalThis.saveSettingsDebounced?.(); } catch {}
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function attr(value) { return esc(value); }
function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
function round64(value) { return Math.max(64, Math.round(clamp(value, 64, 4096, 512) / 64) * 64); }
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

function toast(type, message) {
  const t = globalThis.toastr;
  if (t?.[type]) t[type](message, 'Novel Generation');
  else console[type === 'error' ? 'error' : 'log'](`[Novel Generation] ${message}`);
}

function base() { return String(settings().baseUrl || '').trim().replace(/\/+$/, ''); }
function endpoint(path) {
  const b = base();
  if (!b) return '';
  const p = path.startsWith('/') ? path : `/${path}`;
  if (/\/v1$/i.test(b) && p.startsWith('/v1/')) return `${b}${p.slice(3)}`;
  return `${b}${p}`;
}
function headers() {
  return { 'Content-Type': 'application/json', Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
}

function modelIds(data) {
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
  return [...new Set(list.map(item => typeof item === 'string' ? item : item?.id || item?.name).filter(Boolean))];
}

function field(label, control, help = '') {
  return `<label class="ng-field"><span class="ng-label">${label}</span>${control}${help ? `<small class="ng-help">${help}</small>` : ''}</label>`;
}
function section(id, icon, title, subtitle, body, open = false) {
  return `<details class="ng-section" id="${id}" ${open ? 'open' : ''}><summary><span class="ng-section-icon"><i class="${icon}"></i></span><span class="ng-section-copy"><strong>${title}</strong><small>${subtitle}</small></span><i class="fa-solid fa-chevron-down ng-section-chevron"></i></summary><div class="ng-section-body">${body}</div></details>`;
}

function sizeOptions(selected) {
  const groups = new Map();
  for (const preset of SIZE_PRESETS) {
    if (!groups.has(preset.group)) groups.set(preset.group, []);
    groups.get(preset.group).push(preset);
  }
  return [...groups.entries()].map(([group, items]) => `<optgroup label="${attr(group)}">${items.map(item => `<option value="${item.id}" ${selected === item.id ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</optgroup>`).join('');
}
function samplerOptions(selected) { return SAMPLERS.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${esc(label)}</option>`).join(''); }
function schedulerOptions(selected) { return SCHEDULERS.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${esc(label)}</option>`).join(''); }

function qualityTagsForModel(model = settings().model) {
  const text = String(model || '').toLowerCase();
  if (/4[-_. ]?5/.test(text) && /curated/.test(text)) return ['location', 'masterpiece', 'no text', '-0.8::feet ::', 'rating:general'];
  if (/4[-_. ]?5/.test(text)) return ['location', 'very aesthetic', 'masterpiece', 'no text'];
  if (/4/.test(text) && /curated/.test(text)) return ['rating:general', 'amazing quality', 'very aesthetic', 'absurdres'];
  if (/4/.test(text)) return ['no text', 'best quality', 'very aesthetic', 'absurdres'];
  if (/furry.*3|3.*furry/.test(text)) return ['{best quality}', '{amazing quality}'];
  return ['best quality', 'amazing quality', 'very aesthetic', 'absurdres'];
}

function normalizeTag(tag) { return String(tag || '').trim().replace(/\s+/g, ' '); }
function promptParts(text) { return String(text || '').split(',').map(normalizeTag).filter(Boolean); }
function appendTags(text, tags) {
  const parts = promptParts(text);
  const seen = new Set(parts.map(item => item.toLowerCase()));
  for (const raw of tags || []) {
    const tag = normalizeTag(raw);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    parts.push(tag); seen.add(tag.toLowerCase());
  }
  return parts.join(', ');
}

function artistPromptTags() {
  return settings().promptAssistant.selectedArtists.map(item => {
    const name = String(item?.name || '').replace(/_/g, ' ').trim();
    if (!name) return '';
    const weight = clamp(item.weight ?? 1, -3, 3, 1);
    return Math.abs(weight - 1) < 0.001 ? name : `${weight}::${name} ::`;
  }).filter(Boolean);
}

function imageConfigHtml(prefix = 'ng') {
  const s = settings();
  const image = s.image;
  const customVisible = image.preset === 'custom' ? '' : 'hidden';
  return `<div class="ng-param-presets">${Object.entries(PARAM_PRESETS).map(([id, preset]) => `<button class="menu_button ng-param-preset" data-param-preset="${id}" type="button">${esc(preset.label)}</button>`).join('')}</div>
    ${field('Image size', `<select id="${prefix}-size-preset" class="text_pole ng-size-preset">${sizeOptions(image.preset)}</select>`, 'Choose a preset or Custom. Width/height are rounded to multiples of 64 for custom sizes.')}
    <div id="${prefix}-custom-size" class="ng-custom-size ${customVisible}">
      ${field('Width', `<input id="${prefix}-width" class="text_pole ng-width" type="number" min="64" max="4096" step="64" value="${image.width}">`)}
      <button class="menu_button ng-swap-size" type="button" title="Swap width and height"><i class="fa-solid fa-right-left"></i></button>
      ${field('Height', `<input id="${prefix}-height" class="text_pole ng-height" type="number" min="64" max="4096" step="64" value="${image.height}">`)}
      <button class="menu_button ng-round-size" type="button">Round ×64</button>
    </div>
    <div id="${prefix}-size-info" class="ng-size-info"></div>
    <div class="ng-grid-2">
      ${field('Sampler', `<select id="${prefix}-sampler" class="text_pole ng-sampler">${samplerOptions(image.sampler)}</select>`, 'NovelAI recommends Euler Ancestral or DPM++ 2M for consistent general use.')}
      ${field('Noise schedule', `<select id="${prefix}-scheduler" class="text_pole ng-scheduler">${schedulerOptions(image.scheduler)}</select>`, 'Karras is a useful default. Provider default leaves the wrapper in control.')}
      ${field('Steps', `<input id="${prefix}-steps" class="text_pole ng-steps" type="number" min="1" max="50" value="${image.steps}">`, 'More steps are not automatically better. 28 is a practical V4/V4.5 starting point.')}
      ${field('Prompt Guidance / CFG', `<input id="${prefix}-guidance" class="text_pole ng-guidance" type="number" min="0.1" max="20" step="0.1" value="${image.guidance}">`, 'V3+ commonly works around 5–6. Higher values follow the prompt more aggressively.')}
      ${field('Seed', `<input id="${prefix}-seed" class="text_pole ng-seed" type="number" value="${image.seed}">`, '-1 requests a random seed. Reuse a fixed seed for A/B prompt comparisons.')}
      ${field('Images', `<input id="${prefix}-n" class="text_pole ng-n" type="number" min="1" max="4" value="${image.n}">`, 'Higher resolutions may limit batch size on some providers and batches can cost more.')}
    </div>
    <details class="ng-mini-details"><summary>Advanced sampler options</summary><div class="ng-mini-body">
      ${field('SMEA', `<select id="${prefix}-smea" class="text_pole ng-smea"><option value="off" ${image.smeaMode === 'off' ? 'selected' : ''}>Off</option><option value="auto" ${image.smeaMode === 'auto' ? 'selected' : ''}>Auto for high resolution</option><option value="smea" ${image.smeaMode === 'smea' ? 'selected' : ''}>SMEA</option><option value="smea_dyn" ${image.smeaMode === 'smea_dyn' ? 'selected' : ''}>SMEA DYN</option></select>`, 'Passed as NovelAI-style sm/sm_dyn fields. OpenAI-compatible proxies may ignore these fields.')}
      <label class="checkbox_label"><input id="${prefix}-decrisper" class="ng-decrisper" type="checkbox" ${image.decrisper ? 'checked' : ''}><span>Decrisper / dynamic thresholding <small>Useful when high Guidance causes harsh color/artifact behavior; proxy support varies.</small></span></label>
    </div></details>`;
}

function settingsHtml() {
  const s = settings();
  const p = s.promptAssistant;
  const r = s.roleplay;
  const connection = `${field('Base URL', `<input id="ng-base-url" class="text_pole" type="url" value="${attr(s.baseUrl)}" placeholder="https://provider.example">`, 'The extension appends /v1/models and /v1/images/generations. Your API key is kept only in this browser session.')}
    ${field('API key', `<input id="ng-api-key" class="text_pole" type="password" value="" autocomplete="off" placeholder="Paste API key">`)}
    <div class="ng-actions"><button id="ng-connect" class="menu_button" type="button"><i class="fa-solid fa-plug"></i> Test connection & load models</button></div>
    ${field('Model', `<select id="ng-model" class="text_pole" ${models.length ? '' : 'disabled'}>${models.length ? models.map(model => `<option value="${attr(model)}" ${model === s.model ? 'selected' : ''}>${esc(model)}</option>`).join('') : `<option>${esc(s.model || 'Connect first')}</option>`}</select>`)}
    <div id="ng-status" class="ng-status">Not tested.</div><div id="ng-capabilities" class="ng-status ng-capabilities"></div>`;

  const image = `${imageConfigHtml('ng-settings')}
    ${field('Default Undesired Content preset', `<select id="ng-uc-preset" class="text_pole"><option value="none" ${s.image.negativePreset === 'none' ? 'selected' : ''}>None</option><option value="light" ${s.image.negativePreset === 'light' ? 'selected' : ''}>Light V4.5 style</option><option value="human" ${s.image.negativePreset === 'human' ? 'selected' : ''}>Human Focus V4.5 style</option><option value="heavy" ${s.image.negativePreset === 'heavy' ? 'selected' : ''}>Heavy V4.5 style</option></select>`, 'The built-in lists are convenient starting points; edit the Studio negative prompt for scene-specific exclusions.')}
    ${field('Default negative additions', `<textarea id="ng-default-negative" class="text_pole" rows="3">${esc(s.image.defaultNegative)}</textarea>`)}
    ${field('Prompt prefix', `<input id="ng-prefix" class="text_pole" type="text" value="${attr(s.image.prefix)}" placeholder="Optional tags added before every prompt">`)}
    ${field('Prompt suffix', `<input id="ng-suffix" class="text_pole" type="text" value="${attr(s.image.suffix)}" placeholder="Optional tags added after every prompt">`)}`;

  const roleplay = `<label class="checkbox_label"><input id="ng-role-char" type="checkbox" ${r.character ? 'checked' : ''}><span>Use active character information</span></label>
    <label class="checkbox_label"><input id="ng-role-persona" type="checkbox" ${r.persona ? 'checked' : ''}><span>Use user/persona information</span></label>
    <label class="checkbox_label"><input id="ng-role-auto-insert" type="checkbox" ${r.autoInsert ? 'checked' : ''}><span>Insert Quick Generation images into chat automatically</span></label>
    ${field('Insert target', `<select id="ng-insert-target" class="text_pole"><option value="assistant" ${s.autoInsertTarget === 'assistant' ? 'selected' : ''}>Latest assistant message</option><option value="user" ${s.autoInsertTarget === 'user' ? 'selected' : ''}>Latest user message</option><option value="latest" ${s.autoInsertTarget === 'latest' ? 'selected' : ''}>Latest message</option></select>`)}
    ${field('Persona presence in scene modes', `<select id="ng-persona-presence" class="text_pole"><option value="auto" ${r.personaPresence === 'auto' ? 'selected' : ''}>Auto — only when scene suggests user is present</option><option value="always" ${r.personaPresence === 'always' ? 'selected' : ''}>Always include persona</option><option value="never" ${r.personaPresence === 'never' ? 'selected' : ''}>Never include persona</option></select>`, 'Auto uses local name/pronoun checks and does not call another AI.')}
    <div class="ng-grid-3">${field('Recent messages', `<input id="ng-context-messages" class="text_pole" type="number" min="1" max="10" value="${r.contextMessages}">`)}${field('Chars / message', `<input id="ng-context-per-message" class="text_pole" type="number" min="200" max="5000" step="100" value="${r.perMessageChars}">`)}${field('Total context chars', `<input id="ng-context-total" class="text_pole" type="number" min="1000" max="20000" step="500" value="${r.contextChars}">`)}</div>
    <label class="checkbox_label"><input id="ng-quick-preview" type="checkbox" ${r.quickPreview ? 'checked' : ''}><span>Preview/edit Quick Generation prompt before sending</span></label>
    <label class="checkbox_label"><input id="ng-auto-quality" type="checkbox" ${p.autoQuality ? 'checked' : ''}><span>Add model-aware Quality Tags to Quick Generation</span></label>
    <label class="checkbox_label"><input id="ng-quick-artists" type="checkbox" ${p.useArtistsQuick ? 'checked' : ''}><span>Use selected Danbooru artists in Quick Generation</span></label>
    <div class="ng-actions"><button id="ng-open-studio" class="menu_button" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Open Novel Gen Studio</button><button id="ng-preview-context" class="menu_button" type="button"><i class="fa-solid fa-comments"></i> Preview context</button></div>`;

  const cheats = cheatsheetHtml('drawer');
  const advanced = `${field('Timeout (ms)', `<input id="ng-timeout" class="text_pole" type="number" min="5000" max="300000" step="1000" value="${s.timeoutMs}">`)}
    ${field('Route', `<select id="ng-route" class="text_pole"><option value="images" ${s.routeMode === 'images' ? 'selected' : ''}>/v1/images/generations</option><option value="auto" ${s.routeMode === 'auto' ? 'selected' : ''}>Auto fallback to chat route</option><option value="chat" ${s.routeMode === 'chat' ? 'selected' : ''}>/v1/chat/completions</option></select>`)}
    ${field('Extra request body (JSON)', `<textarea id="ng-extra-body" class="text_pole" rows="5" placeholder='{"custom_field":true}'>${esc(s.image.extraBody)}</textarea>`, 'Merged last into the extended image payload. Use only when your provider documents additional fields.')}
    <div class="ng-actions"><button id="ng-copy-debug" class="menu_button" type="button">Copy Request Debug</button><button id="ng-clear-debug" class="menu_button" type="button">Clear</button></div><pre id="ng-debug-output" class="ng-debug">No requests yet.</pre>`;

  return `<div id="ng-settings" class="ng-settings inline-drawer">
    <div id="ng-drawer-toggle" class="ng-drawer-toggle" role="button" tabindex="0" aria-expanded="false"><div><strong>Novel Generation</strong><small class="ng-version">v${VERSION}</small></div><i class="fa-solid fa-chevron-down"></i></div>
    <div id="ng-drawer-content" class="ng-drawer-content" style="display:none">
      ${section('ng-connection', 'fa-solid fa-plug', 'Connection', 'OpenAI-compatible NovelAI proxy', connection, true)}
      ${section('ng-image-parameters', 'fa-solid fa-sliders', 'Image Parameters', 'Sizes, sampler, scheduler, Steps, Guidance, SMEA and defaults', image, true)}
      ${section('ng-roleplay', 'fa-solid fa-comments', 'Roleplay Image Generation', 'Read the current SillyTavern scene without an extra AI call', roleplay)}
      ${section('ng-cheatsheet', 'fa-solid fa-book-open', 'NovelAI Cheatsheet & Prompt Assistant', 'Tags, weighting, quality, artist browser and recommendations', cheats)}
      ${section('ng-advanced', 'fa-solid fa-code', 'Advanced / Debug', 'Provider-specific request options and diagnostics', advanced)}
    </div>
  </div>`;
}

function tagButtons(tags, target = 'prompt') {
  return `<div class="ng-tag-grid">${tags.map(tag => `<button class="menu_button ng-tag-button" data-target="${target}" data-tag="${attr(tag)}" type="button">${esc(tag)}</button>`).join('')}</div>`;
}

function cheatsheetHtml(scope) {
  const selected = settings().promptAssistant.selectedArtists;
  return `<div class="ng-cheats" data-cheat-scope="${scope}">
    <div class="ng-cheat-toolbar"><select class="text_pole ng-insert-target"><option value="prompt">Insert into Prompt</option><option value="negative">Insert into Undesired Content</option></select><button class="menu_button ng-suggest-tags" type="button"><i class="fa-solid fa-lightbulb"></i> Suggest Tags</button><button class="menu_button ng-export-cheats" type="button"><i class="fa-solid fa-file-arrow-down"></i> Save all as .md</button></div>
    <details class="ng-cheat" open><summary><i class="fa-solid fa-palette"></i><span>Artist / Style tags</span></summary><div class="ng-cheat-body"><p>Search Danbooru artist tags lazily. Select multiple artists and give each a weight to mix styles.</p><div class="ng-search-row"><input class="text_pole ng-artist-search" type="search" placeholder="Search Danbooru artist tags…"><button class="menu_button ng-artist-clear" type="button">Clear</button></div><div class="ng-artist-results"></div><h4>Selected style mix</h4><div class="ng-selected-artists">${selected.length ? '' : '<small>No artists selected yet.</small>'}</div><button class="menu_button ng-apply-artists" type="button">Apply style mix to prompt</button></div></details>
    <details class="ng-cheat"><summary><i class="fa-solid fa-people-arrows"></i><span>source# / target# / mutual#</span></summary><div class="ng-cheat-body"><p>Use action-role prefixes in multi-character prompting to disambiguate who performs or receives an action.</p>${tagButtons(TAGS.roles)}</div></details>
    <details class="ng-cheat"><summary><i class="fa-solid fa-scale-balanced"></i><span>Density / tag weighting</span></summary><div class="ng-cheat-body"><p>Braces strengthen, brackets weaken, and V4+ numerical emphasis gives more explicit control. V4.5 can use negative numerical emphasis for targeted removals.</p>${tagButtons(TAGS.weighting)}</div></details>
    <details class="ng-cheat"><summary><i class="fa-solid fa-star"></i><span>Quality / Aesthetic / Special tags</span></summary><div class="ng-cheat-body"><h4>Quality</h4>${tagButtons(TAGS.quality)}<h4>Aesthetic</h4>${tagButtons(TAGS.aesthetic)}<h4>Year / Dataset / Special</h4>${tagButtons(TAGS.special)}<button class="menu_button ng-apply-quality" type="button">Apply quality tags for selected model</button></div></details>
    <details class="ng-cheat"><summary><i class="fa-solid fa-ban"></i><span>Undesired Content (negative)</span></summary><div class="ng-cheat-body"><p>Use Undesired Content for broad exclusions; negative numerical emphasis is better for targeted concept removal.</p>${tagButtons(TAGS.negative, 'negative')}<div class="ng-cheat-actions"><button class="menu_button ng-set-uc" data-uc="light" type="button">Use Light UC</button><button class="menu_button ng-set-uc" data-uc="human" type="button">Use Human Focus UC</button><button class="menu_button ng-set-uc" data-uc="heavy" type="button">Use Heavy UC</button></div></div></details>
    <details class="ng-cheat"><summary><i class="fa-solid fa-brush"></i><span>Medium / Art style / Coloring / FX</span></summary><div class="ng-cheat-body"><h4>Medium</h4>${tagButtons(TAGS.medium)}<h4>Style / Coloring</h4>${tagButtons(TAGS.art)}<h4>Lighting / FX</h4>${tagButtons(TAGS.fx)}</div></details>
    <details class="ng-cheat"><summary><i class="fa-solid fa-camera"></i><span>Camera / Frame / Lighting</span></summary><div class="ng-cheat-body"><p>Pick one main framing tag when possible, then use camera direction and lighting tags to reinforce composition.</p>${tagButtons(TAGS.camera)}${tagButtons(TAGS.fx)}</div></details>
    <details class="ng-cheat"><summary><i class="fa-solid fa-shirt"></i><span>Character / Costume variant tags</span></summary><div class="ng-cheat-body"><h4>Character / gaze / expression</h4>${tagButtons(TAGS.character)}<h4>Costume</h4>${tagButtons(TAGS.costume)}</div></details>
    <details class="ng-cheat"><summary><i class="fa-solid fa-triangle-exclamation"></i><span>NSFW / rating tags (18+)</span></summary><div class="ng-cheat-body"><p>Rating tags are optional prompt controls. Use them only where appropriate for your own generation workflow.</p>${tagButtons(TAGS.rating)}</div></details>
    <details class="ng-cheat"><summary><i class="fa-solid fa-sliders"></i><span>Recommended values + Anlas notes</span></summary><div class="ng-cheat-body"><div class="ng-info-grid"><div><strong>Samplers</strong><span>Euler Ancestral and DPM++ 2M are reliable general choices.</span></div><div><strong>Steps</strong><span>Start around 28; excessive Steps can provide little benefit.</span></div><div><strong>Guidance</strong><span>V3+ commonly works around 5–6. Increase carefully.</span></div><div><strong>Seed</strong><span>Fix the seed when comparing tag or parameter changes.</span></div><div><strong>SMEA</strong><span>Intended to improve coherency at higher resolutions; it can cost more compute.</span></div><div><strong>Anlas</strong><span>On NovelAI itself, Opus has special no-Anlas conditions at ≤28 Steps and normal-size single generations. Proxy billing can be different.</span></div><div><strong>Large reference canvas</strong><span>1024×1536, 1472×1472 and 1536×1024 are useful large canvases and match Precise Reference preparation sizes.</span></div><div><strong>Upscale</strong><span>NovelAI's dedicated upscale is distinct from creative img2img/enhance. Proxy endpoints vary.</span></div></div></div></details>
    <details class="ng-cheat" open><summary><i class="fa-solid fa-lightbulb"></i><span>Suggestion Tags</span></summary><div class="ng-cheat-body"><div class="ng-suggestions"><small>Press Suggest Tags to analyze the current prompt locally. No LLM/API quota is used.</small></div></div></details>
  </div>`;
}

function bindDrawer() {
  const toggle = document.getElementById('ng-drawer-toggle');
  const content = document.getElementById('ng-drawer-content');
  if (!toggle || !content || toggle.dataset.bound === '1') return;
  toggle.dataset.bound = '1';
  const setOpen = open => {
    content.style.display = open ? 'block' : 'none';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('is-open', open);
  };
  const activate = event => {
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  };
  toggle.addEventListener('click', activate, true);
  toggle.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') activate(event); }, true);
  setOpen(false);
}

function bindImageConfig(root, prefix) {
  const s = settings();
  const image = s.image;
  const q = selector => root.querySelector(selector);
  const preset = q(`#${prefix}-size-preset`);
  const custom = q(`#${prefix}-custom-size`);
  const width = q(`#${prefix}-width`);
  const height = q(`#${prefix}-height`);
  const info = q(`#${prefix}-size-info`);

  const syncInfo = () => {
    const w = image.width, h = image.height;
    const mp = (w * h / 1_000_000).toFixed(2);
    const ratio = (w / h).toFixed(3);
    const high = w * h > 1024 * 1024;
    if (info) info.innerHTML = `<strong>${w} × ${h}</strong><span>${mp} MP · ratio ${ratio}${high ? ' · high-resolution' : ''}</span>`;
  };
  const applyPreset = id => {
    image.preset = id;
    const item = SIZE_PRESETS.find(entry => entry.id === id);
    if (item && id !== 'custom') { image.width = item.width; image.height = item.height; }
    if (custom) custom.classList.toggle('hidden', id !== 'custom');
    if (width) width.value = image.width;
    if (height) height.value = image.height;
    save(); syncInfo();
    if (studio) { studio.width = image.width; studio.height = image.height; }
  };
  preset?.addEventListener('change', () => applyPreset(preset.value));
  const updateCustom = () => {
    image.preset = 'custom'; image.width = round64(width?.value); image.height = round64(height?.value);
    if (preset) preset.value = 'custom'; if (width) width.value = image.width; if (height) height.value = image.height;
    if (custom) custom.classList.remove('hidden'); save(); syncInfo();
    if (studio) { studio.width = image.width; studio.height = image.height; }
  };
  width?.addEventListener('change', updateCustom); height?.addEventListener('change', updateCustom);
  q('.ng-swap-size')?.addEventListener('click', () => {
    const old = image.width; image.width = image.height; image.height = old; image.preset = 'custom';
    if (preset) preset.value = 'custom'; if (custom) custom.classList.remove('hidden'); if (width) width.value = image.width; if (height) height.value = image.height; save(); syncInfo();
    if (studio) { studio.width = image.width; studio.height = image.height; }
  });
  q('.ng-round-size')?.addEventListener('click', updateCustom);

  const scalar = [
    ['.ng-steps', 'steps', value => Math.round(clamp(value, 1, 50, 28))],
    ['.ng-guidance', 'guidance', value => clamp(value, 0.1, 20, 5)],
    ['.ng-seed', 'seed', value => Math.round(Number(value) || -1)],
    ['.ng-n', 'n', value => Math.round(clamp(value, 1, 4, 1))],
  ];
  for (const [selector, key, parse] of scalar) q(selector)?.addEventListener('change', event => { image[key] = parse(event.currentTarget.value); event.currentTarget.value = image[key]; save(); if (studio) studio[key] = image[key]; });
  q('.ng-sampler')?.addEventListener('change', event => { image.sampler = event.currentTarget.value; save(); if (studio) studio.sampler = image.sampler; });
  q('.ng-scheduler')?.addEventListener('change', event => { image.scheduler = event.currentTarget.value; save(); if (studio) studio.scheduler = image.scheduler; });
  q('.ng-smea')?.addEventListener('change', event => { image.smeaMode = event.currentTarget.value; save(); if (studio) studio.smeaMode = image.smeaMode; });
  q('.ng-decrisper')?.addEventListener('change', event => { image.decrisper = event.currentTarget.checked; save(); if (studio) studio.decrisper = image.decrisper; });
  root.querySelectorAll('.ng-param-preset').forEach(button => button.addEventListener('click', () => {
    const presetData = PARAM_PRESETS[button.dataset.paramPreset]; if (!presetData) return;
    Object.assign(image, { steps: presetData.steps, guidance: presetData.guidance, sampler: presetData.sampler, scheduler: presetData.scheduler });
    save();
    q('.ng-steps') && (q('.ng-steps').value = image.steps); q('.ng-guidance') && (q('.ng-guidance').value = image.guidance); q('.ng-sampler') && (q('.ng-sampler').value = image.sampler); q('.ng-scheduler') && (q('.ng-scheduler').value = image.scheduler);
    if (studio) Object.assign(studio, { steps: image.steps, guidance: image.guidance, sampler: image.sampler, scheduler: image.scheduler });
    toast('success', `Applied ${presetData.label}.`);
  }));
  syncInfo();
}

function bindSettings() {
  const root = document.getElementById('ng-settings');
  if (!root || root.dataset.bound === '1') return;
  root.dataset.bound = '1'; bindDrawer(); bindImageConfig(root, 'ng-settings');
  const s = settings();
  const val = (id, fn) => document.getElementById(id)?.addEventListener('change', event => { fn(event.currentTarget); save(); });
  val('ng-base-url', el => s.baseUrl = el.value.trim());
  document.getElementById('ng-api-key')?.addEventListener('input', event => { apiKey = event.currentTarget.value.trim(); });
  document.getElementById('ng-connect')?.addEventListener('click', connectAndLoadModels);
  val('ng-model', el => s.model = el.value);
  val('ng-uc-preset', el => s.image.negativePreset = el.value);
  val('ng-default-negative', el => s.image.defaultNegative = el.value);
  val('ng-prefix', el => s.image.prefix = el.value);
  val('ng-suffix', el => s.image.suffix = el.value);
  val('ng-role-char', el => s.roleplay.character = el.checked);
  val('ng-role-persona', el => s.roleplay.persona = el.checked);
  val('ng-role-auto-insert', el => s.roleplay.autoInsert = el.checked);
  val('ng-insert-target', el => s.autoInsertTarget = el.value);
  val('ng-persona-presence', el => s.roleplay.personaPresence = el.value);
  val('ng-context-messages', el => { s.roleplay.contextMessages = Math.round(clamp(el.value, 1, 10, 4)); el.value = s.roleplay.contextMessages; });
  val('ng-context-per-message', el => { s.roleplay.perMessageChars = Math.round(clamp(el.value, 200, 5000, 1200)); el.value = s.roleplay.perMessageChars; });
  val('ng-context-total', el => { s.roleplay.contextChars = Math.round(clamp(el.value, 1000, 20000, 7000)); el.value = s.roleplay.contextChars; });
  val('ng-quick-preview', el => s.roleplay.quickPreview = el.checked);
  val('ng-auto-quality', el => s.promptAssistant.autoQuality = el.checked);
  val('ng-quick-artists', el => s.promptAssistant.useArtistsQuick = el.checked);
  val('ng-timeout', el => { s.timeoutMs = Math.round(clamp(el.value, 5000, 300000, 120000)); el.value = s.timeoutMs; });
  val('ng-route', el => s.routeMode = el.value);
  val('ng-extra-body', el => s.image.extraBody = el.value);
  document.getElementById('ng-open-studio')?.addEventListener('click', () => openStudio('last'));
  document.getElementById('ng-preview-context')?.addEventListener('click', showContextPreview);
  document.getElementById('ng-copy-debug')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(JSON.stringify(debugLog, null, 2)); toast('success', 'Request Debug copied.'); } catch { toast('error', 'Could not copy Request Debug.'); } });
  document.getElementById('ng-clear-debug')?.addEventListener('click', () => { debugLog = []; renderDebug(); });
  bindCheatsheet(root);
  renderCapabilities(); renderDebug();
}

function status(message, kind = '') {
  const node = document.getElementById('ng-status'); if (!node) return;
  node.textContent = message; node.className = `ng-status ${kind ? `is-${kind}` : ''}`;
}
function renderCapabilities() {
  const node = document.getElementById('ng-capabilities'); if (!node) return;
  const label = value => value === 'supported' ? 'Supported' : value === 'missing' ? 'Not exposed' : value === 'blocked' ? 'Route found, blocked' : value === 'testing' ? 'Testing…' : 'Unknown';
  node.innerHTML = `<strong>Provider capabilities</strong><span>OpenAI image wrapper: ${label(providerCaps.wrapper)}</span><span>NovelAI native generate: ${label(providerCaps.nativeGenerate)}</span><span>V4/V4.5 vibe encoder: ${label(providerCaps.encodeVibe)}</span>${providerCaps.checkedAt ? `<small>Checked ${new Date(providerCaps.checkedAt).toLocaleTimeString()}</small>` : ''}`;
}

function providerPathCandidates(path) {
  const current = base(); if (!current) return [];
  const p = path.startsWith('/') ? path : `/${path}`; const trimmed = current.replace(/\/+$/, ''); const root = trimmed.replace(/\/v1$/i, '');
  return [...new Set([`${root}${p}`, `${trimmed}${p}`, ...(!/\/v1$/i.test(trimmed) ? [`${trimmed}/v1${p}`] : [])])];
}
async function probeEndpoint(path) {
  let network = false;
  for (const url of providerPathCandidates(path)) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, { method: 'POST', headers: headers(), body: '{}', signal: controller.signal });
      response.body?.cancel?.().catch?.(() => {});
      if (response.status === 404) continue;
      if (response.status === 401 || response.status === 403) return 'blocked';
      if ([200, 400, 405, 415, 422].includes(response.status) || response.status < 500) return 'supported';
    } catch (error) { network = true; } finally { clearTimeout(timer); }
  }
  return network ? 'unknown' : 'missing';
}

async function connectAndLoadModels() {
  const s = settings();
  if (!base()) return toast('warning', 'Enter a Base URL first.');
  if (!apiKey) return toast('warning', 'Enter an API key first.');
  const button = document.getElementById('ng-connect'); button?.setAttribute('disabled', 'disabled');
  status('Testing connection and loading models…', 'testing'); providerCaps.wrapper = 'testing'; renderCapabilities();
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), s.timeoutMs);
  try {
    const response = await fetch(endpoint('/v1/models'), { headers: headers(), signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    models = modelIds(await response.json()); if (!models.length) throw new Error('/v1/models returned no selectable models.');
    const select = document.getElementById('ng-model');
    const preferred = models.includes(s.model) ? s.model : models.find(model => /nai.*4.?5.*full/i.test(model)) || models[0];
    s.model = preferred; save();
    if (select) { select.innerHTML = models.map(model => `<option value="${attr(model)}">${esc(model)}</option>`).join(''); select.value = preferred; select.disabled = false; }
    providerCaps.wrapper = 'supported'; providerCaps.nativeGenerate = 'testing'; providerCaps.encodeVibe = 'testing'; renderCapabilities();
    const [native, vibe] = await Promise.all([probeEndpoint('/ai/generate-image'), probeEndpoint('/ai/encode-vibe')]);
    providerCaps.nativeGenerate = native; providerCaps.encodeVibe = vibe; providerCaps.checkedAt = new Date().toISOString(); renderCapabilities();
    status(`Connected. ${models.length} model${models.length === 1 ? '' : 's'} available.`, 'ok'); toast('success', 'Connected and models loaded.');
  } catch (error) {
    providerCaps.wrapper = 'unknown'; status(`Connection failed: ${error.message}`, 'error'); toast('error', error.message);
  } finally { clearTimeout(timer); button?.removeAttribute('disabled'); }
}

function stripMarkup(text) {
  let value = String(text || '');
  value = value.replace(/```[\s\S]*?```/g, ' ').replace(/<!--([\s\S]*?)-->/g, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  try { const div = document.createElement('div'); div.innerHTML = value; value = div.textContent || div.innerText || ''; } catch { value = value.replace(/<[^>]+>/g, ' '); }
  return value.replace(/\s+/g, ' ').trim();
}
function characterData() {
  const c = ctx(); const id = c.characterId ?? c.this_chid; const item = id != null ? c.characters?.[id] : null;
  return { name: item?.name || c.name2 || 'Character', description: item?.description || item?.data?.description || item?.personality || '' };
}
function personaData() {
  const c = ctx();
  return { name: c.name1 || 'User', description: c.powerUserSettings?.persona_description || c.persona?.description || '' };
}
function latestChatMessage() {
  const chat = Array.isArray(ctx().chat) ? ctx().chat : [];
  for (let i = chat.length - 1; i >= 0; i--) if (chat[i] && !chat[i].is_system && chat[i].mes) return chat[i];
  return null;
}
function personaPresent() {
  const mode = settings().roleplay.personaPresence;
  if (mode === 'always') return true; if (mode === 'never') return false;
  const message = latestChatMessage(); if (!message) return false; if (message.is_user) return true;
  const text = stripMarkup(message.mes).toLowerCase(); const name = personaData().name.toLowerCase().trim();
  if (name && name !== 'user' && text.includes(name)) return true;
  return /\b(you|your|yours|yourself)\b/i.test(text) || /(คุณ|นาย|เธอ|แก|มึง|ของคุณ|ของนาย|ของเธอ)/i.test(text);
}
function recentContext() {
  const s = settings().roleplay; const chat = Array.isArray(ctx().chat) ? ctx().chat : []; const char = characterData(); const persona = personaData();
  const lines = chat.filter(message => message && !message.is_system && message.mes).slice(-s.contextMessages).map(message => {
    const speaker = message.is_user ? persona.name : char.name; return `${speaker}: ${stripMarkup(message.mes).slice(0, s.perMessageChars)}`;
  });
  return lines.join('\n').slice(-s.contextChars);
}

function buildContextPrompt(mode, manual = '') {
  if (manual.trim()) return manual.trim();
  const s = settings(); const char = characterData(); const persona = personaData(); const scene = recentContext(); const includePersona = mode === 'user' || (s.roleplay.persona && personaPresent());
  const appearance = s.roleplay.character && char.description ? `Character reference: ${stripMarkup(char.description).slice(0, 1800)}.` : '';
  const personaInfo = includePersona && persona.description ? `User/persona reference: ${stripMarkup(persona.description).slice(0, 1200)}.` : includePersona ? `User/persona: ${persona.name}.` : 'The user/persona is not necessarily visible; do not add them unless the scene explicitly requires them.';
  const base = mode === 'portrait' ? `solo portrait of ${char.name}, current outfit and expression, detailed character illustration`
    : mode === 'selfie' ? `${char.name} taking a selfie, close-up face focus, candid current expression and current setting`
    : mode === 'user' ? `portrait of ${persona.name}, current outfit, expression and setting`
    : mode === 'manga' ? 'manga panel, cinematic storytelling, preserve the current action, cast, positions and setting, no dialogue text'
    : mode === 'last' ? 'illustrate the current roleplay moment faithfully as one image; preserve the cast, final positions, visible actions, expressions, current clothing, environment, time of day and lighting'
    : 'illustrate the current roleplay scene';
  let prompt = `${base}. ${appearance} ${personaInfo}\nScene context:\n${scene}`.trim();
  const preset = QUICK_PRESETS[mode]; if (preset) prompt = appendTags(prompt, preset);
  if (s.promptAssistant.useArtistsQuick) prompt = appendTags(prompt, artistPromptTags());
  if (s.promptAssistant.autoQuality) prompt = appendTags(prompt, qualityTagsForModel());
  return prompt;
}

function suggestTags(promptText) {
  const text = String(promptText || '').toLowerCase(); const set = new Set(); const add = (...items) => items.forEach(item => set.add(item));
  if (/(portrait|face|headshot|close[- ]?up)/.test(text)) add('upper body', 'looking at viewer', 'detailed face', 'depth of field');
  if (/selfie/.test(text)) add('selfie', 'looking at viewer', 'face focus', 'candid');
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
  qualityTagsForModel().forEach(item => set.add(item)); return [...set].slice(0, 28);
}

function showContextPreview() {
  const text = recentContext();
  const overlay = document.createElement('div'); overlay.className = 'ng-modal-backdrop';
  overlay.innerHTML = `<div class="ng-modal"><header><strong>Roleplay Context Preview</strong><button class="menu_button ng-close" type="button"><i class="fa-solid fa-xmark"></i></button></header><pre class="ng-context-preview">${esc(text || 'No roleplay context found.')}</pre></div>`;
  document.documentElement.appendChild(overlay); overlay.querySelector('.ng-close')?.addEventListener('click', () => overlay.remove()); overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
}

function newStudio(mode = 'free', manual = '') {
  const image = settings().image;
  return { mode, prompt: buildContextPrompt(mode, manual), negative: '', width: image.width, height: image.height, steps: image.steps, guidance: image.guidance, sampler: image.sampler, scheduler: image.scheduler, seed: image.seed, n: image.n, smeaMode: image.smeaMode, decrisper: image.decrisper, source: null, mask: null, editMode: 'generate', strength: 0.55, noise: 0.15, generated: [] };
}

function studioHtml() {
  return `<div id="ng-studio-overlay" class="ng-studio-overlay"><div id="ng-generate-panel" class="ng-studio-panel">
    <header class="ng-studio-header"><div><strong>Novel Gen Studio</strong><small>v${VERSION}</small></div><div class="ng-actions"><button id="ng-studio-close" class="menu_button" type="button"><i class="fa-solid fa-xmark"></i></button></div></header>
    <div class="ng-studio-scroll">
      <details class="ng-studio-section" open data-focus="prompt"><summary><i class="fa-solid fa-pen"></i><span>Prompt Workspace</span><i class="fa-solid fa-chevron-down"></i></summary><div class="ng-studio-section-body">
        ${field('Prompt', `<textarea id="ng-prompt" class="text_pole" rows="10">${esc(studio.prompt)}</textarea>`)}
        ${field('Undesired Content', `<textarea id="ng-negative" class="text_pole" rows="5">${esc(studio.negative)}</textarea>`)}
        <div class="ng-actions"><button id="ng-studio-suggest" class="menu_button" type="button"><i class="fa-solid fa-lightbulb"></i> Suggest Tags</button><button id="ng-studio-context" class="menu_button" type="button"><i class="fa-solid fa-comments"></i> Append fresh chat context</button><button id="ng-copy-prompt" class="menu_button" type="button"><i class="fa-solid fa-copy"></i> Copy prompt</button></div>
        <div class="ng-preset-grid">${Object.keys(QUICK_PRESETS).map(name => `<button class="menu_button ng-quick-preset" data-preset="${name}" type="button">${esc(name)}</button>`).join('')}</div>
        <div class="ng-actions"><button id="ng-save-preset" class="menu_button" type="button">Save current prompt preset</button></div><div id="ng-custom-presets"></div>
      </div></details>
      <details class="ng-studio-section" open data-focus="parameters"><summary><i class="fa-solid fa-sliders"></i><span>Image Parameters</span><i class="fa-solid fa-chevron-down"></i></summary><div class="ng-studio-section-body">${imageConfigHtml('ng-studio')}</div></details>
      <details class="ng-studio-section" data-focus="assistant"><summary><i class="fa-solid fa-book-open"></i><span>NovelAI Cheatsheet & Prompt Assistant</span><i class="fa-solid fa-chevron-down"></i></summary><div class="ng-studio-section-body">${cheatsheetHtml('studio')}</div></details>
      <details class="ng-studio-section" data-focus="edit"><summary><i class="fa-solid fa-image"></i><span>Image2Image / Inpaint Source</span><i class="fa-solid fa-chevron-down"></i></summary><div class="ng-studio-section-body">
        <p class="ng-muted">These fields are forwarded to compatible proxies. Your current provider may support basic generation while ignoring or rejecting edit fields.</p>
        <div class="ng-grid-2">${field('Mode', `<select id="ng-edit-mode" class="text_pole"><option value="generate">Text to image</option><option value="img2img">Image2Image</option><option value="inpaint">Inpaint (mask upload)</option></select>`)}${field('Source image', `<input id="ng-source-file" class="text_pole" type="file" accept="image/*">`)}</div>
        <div id="ng-source-preview" class="ng-source-preview"></div>
        <div class="ng-grid-2">${field('Strength', `<input id="ng-strength" class="text_pole" type="number" min="0" max="1" step="0.01" value="${studio.strength}">`, 'Higher values allow more reinterpretation.')}${field('Noise', `<input id="ng-noise" class="text_pole" type="number" min="0" max="1" step="0.01" value="${studio.noise}">`, 'Higher noise can add detail but can also introduce artifacts.')}</div>
        ${field('Mask image (inpaint)', `<input id="ng-mask-file" class="text_pole" type="file" accept="image/*">`, 'Use a mask accepted by your proxy. Native NovelAI route support is provider-dependent.')}
        <div class="ng-actions"><button id="ng-clear-source" class="menu_button" type="button">Clear source/mask</button><button id="ng-upscale-2x" class="menu_button" type="button">Try 2× upscale</button><button id="ng-upscale-4k" class="menu_button" type="button">Try 4K / large</button></div>
      </div></details>
      <details class="ng-studio-section" data-focus="references"><summary><i class="fa-solid fa-images"></i><span>Vibe / Precise Reference</span><i class="fa-solid fa-chevron-down"></i></summary><div class="ng-studio-section-body"><div id="ng-reference-status" class="ng-status"></div><p class="ng-muted">The extension does not fake advanced reference support. V4/V4.5 Vibe needs an encoding route and Precise Reference needs compatible Director Reference handling. The current connection capability test tells you whether the native routes are exposed.</p></div></details>
      <details class="ng-studio-section" open data-focus="output"><summary><i class="fa-solid fa-images"></i><span>Generated Images / Gallery</span><i class="fa-solid fa-chevron-down"></i></summary><div class="ng-studio-section-body"><div id="ng-preview" class="ng-preview"><div class="ng-preview-empty"><i class="fa-regular fa-images"></i><strong>No image yet</strong><span>Generate an image to see it here.</span></div></div><div id="ng-gallery-grid" class="ng-gallery-grid"></div></div></details>
      <details class="ng-studio-section" data-focus="debug"><summary><i class="fa-solid fa-code"></i><span>Request Debug</span><i class="fa-solid fa-chevron-down"></i></summary><div class="ng-studio-section-body"><pre id="ng-studio-debug" class="ng-debug"></pre></div></details>
    </div>
    <footer class="ng-studio-footer"><div id="ng-gen-status" class="ng-status">Ready.</div><button id="ng-generate" class="menu_button ng-primary" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate</button></footer>
  </div></div>`;
}

function openStudio(mode = 'free', manual = '') {
  document.getElementById('ng-studio-overlay')?.remove(); studio = newStudio(mode, manual);
  const wrap = document.createElement('div'); wrap.innerHTML = studioHtml(); document.documentElement.appendChild(wrap.firstElementChild); bindStudio();
}
function closeStudio() { document.getElementById('ng-studio-overlay')?.remove(); }
function openStudioSection(focus) { const node = document.querySelector(`#ng-studio-overlay [data-focus="${focus}"]`); if (node) { node.open = true; setTimeout(() => node.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 20); } }

function fileToRef(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, base64: String(reader.result || '').split(',')[1] || '', dataUrl: String(reader.result || '') }); reader.onerror = () => reject(reader.error || new Error('Could not read image.')); reader.readAsDataURL(file); });
}

function bindStudio() {
  const root = document.getElementById('ng-studio-overlay'); if (!root) return;
  document.getElementById('ng-studio-close')?.addEventListener('click', closeStudio);
  root.addEventListener('click', event => { if (event.target === root) closeStudio(); });
  document.getElementById('ng-prompt')?.addEventListener('input', event => studio.prompt = event.currentTarget.value);
  document.getElementById('ng-negative')?.addEventListener('input', event => studio.negative = event.currentTarget.value);
  bindImageConfig(root, 'ng-studio'); bindCheatsheet(root); renderCustomPresets(); renderGallery(); renderDebug(); renderReferenceStatus();
  document.getElementById('ng-studio-suggest')?.addEventListener('click', () => renderSuggestions(root));
  document.getElementById('ng-studio-context')?.addEventListener('click', () => { const context = recentContext(); if (!context) return toast('warning', 'No recent roleplay context found.'); studio.prompt = `${studio.prompt.trim()}\n\nScene context:\n${context}`.trim(); const area = document.getElementById('ng-prompt'); if (area) area.value = studio.prompt; });
  document.getElementById('ng-copy-prompt')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(studio.prompt); toast('success', 'Prompt copied.'); } catch { toast('error', 'Could not copy prompt.'); } });
  root.querySelectorAll('.ng-quick-preset').forEach(button => button.addEventListener('click', () => { studio.prompt = appendTags(studio.prompt, QUICK_PRESETS[button.dataset.preset] || []); const area = document.getElementById('ng-prompt'); if (area) area.value = studio.prompt; }));
  document.getElementById('ng-save-preset')?.addEventListener('click', savePromptPreset);
  document.getElementById('ng-edit-mode')?.addEventListener('change', event => studio.editMode = event.currentTarget.value);
  document.getElementById('ng-strength')?.addEventListener('change', event => { studio.strength = clamp(event.currentTarget.value, 0, 1, 0.55); event.currentTarget.value = studio.strength; });
  document.getElementById('ng-noise')?.addEventListener('change', event => { studio.noise = clamp(event.currentTarget.value, 0, 1, 0.15); event.currentTarget.value = studio.noise; });
  document.getElementById('ng-source-file')?.addEventListener('change', async event => { const file = event.currentTarget.files?.[0]; if (!file) return; studio.source = await fileToRef(file); if (studio.editMode === 'generate') { studio.editMode = 'img2img'; document.getElementById('ng-edit-mode').value = 'img2img'; } renderSourcePreview(); });
  document.getElementById('ng-mask-file')?.addEventListener('change', async event => { const file = event.currentTarget.files?.[0]; if (!file) return; studio.mask = await fileToRef(file); studio.editMode = 'inpaint'; document.getElementById('ng-edit-mode').value = 'inpaint'; renderSourcePreview(); });
  document.getElementById('ng-clear-source')?.addEventListener('click', () => { studio.source = null; studio.mask = null; studio.editMode = 'generate'; document.getElementById('ng-edit-mode').value = 'generate'; renderSourcePreview(); });
  document.getElementById('ng-upscale-2x')?.addEventListener('click', () => runUpscale('2x'));
  document.getElementById('ng-upscale-4k')?.addEventListener('click', () => runUpscale('4k'));
  document.getElementById('ng-generate')?.addEventListener('click', generateStudio);
}

function renderSourcePreview() {
  const node = document.getElementById('ng-source-preview'); if (!node) return;
  node.innerHTML = studio?.source ? `<figure><img src="${attr(studio.source.dataUrl)}"><figcaption>Source${studio.mask ? ' · mask loaded' : ''}</figcaption></figure>${studio.mask ? `<figure><img src="${attr(studio.mask.dataUrl)}"><figcaption>Mask</figcaption></figure>` : ''}` : '<small>No source image selected.</small>';
}
function renderReferenceStatus() {
  const node = document.getElementById('ng-reference-status'); if (!node) return;
  node.innerHTML = `Native generation: <strong>${esc(providerCaps.nativeGenerate)}</strong> · Vibe encoder: <strong>${esc(providerCaps.encodeVibe)}</strong>.`;
}

function savePromptPreset() {
  if (!studio?.prompt.trim()) return toast('warning', 'Write a prompt before saving.');
  const name = window.prompt('Preset name:'); if (!name?.trim()) return;
  const list = settings().promptAssistant.presets; const found = list.find(item => item.name.toLowerCase() === name.trim().toLowerCase()); const snapshot = { name: name.trim(), prompt: studio.prompt, negative: studio.negative };
  if (found) Object.assign(found, snapshot); else list.unshift(snapshot); list.splice(20); save(); renderCustomPresets();
}
function renderCustomPresets() {
  const node = document.getElementById('ng-custom-presets'); if (!node) return; const list = settings().promptAssistant.presets;
  node.innerHTML = list.length ? list.map((item, index) => `<div class="ng-preset-row"><button class="menu_button ng-load-preset" data-index="${index}" type="button">${esc(item.name)}</button><button class="menu_button ng-delete-preset" data-index="${index}" type="button"><i class="fa-solid fa-trash"></i></button></div>`).join('') : '<small class="ng-help">No custom presets saved.</small>';
  node.querySelectorAll('.ng-load-preset').forEach(button => button.addEventListener('click', () => { const item = list[+button.dataset.index]; if (!item) return; studio.prompt = item.prompt || ''; studio.negative = item.negative || ''; document.getElementById('ng-prompt').value = studio.prompt; document.getElementById('ng-negative').value = studio.negative; }));
  node.querySelectorAll('.ng-delete-preset').forEach(button => button.addEventListener('click', () => { list.splice(+button.dataset.index, 1); save(); renderCustomPresets(); }));
}

function bindCheatsheet(root) {
  root.querySelectorAll('.ng-cheats').forEach(cheat => {
    if (cheat.dataset.bound === '1') return; cheat.dataset.bound = '1';
    cheat.querySelectorAll('.ng-tag-button').forEach(button => button.addEventListener('click', () => {
      const target = button.dataset.target === 'negative' ? 'negative' : (cheat.querySelector('.ng-insert-target')?.value || 'prompt'); insertTag(target, button.dataset.tag);
    }));
    cheat.querySelector('.ng-suggest-tags')?.addEventListener('click', () => renderSuggestions(cheat));
    cheat.querySelector('.ng-export-cheats')?.addEventListener('click', exportCheatsheet);
    cheat.querySelector('.ng-apply-quality')?.addEventListener('click', () => qualityTagsForModel().forEach(tag => insertTag('prompt', tag)));
    cheat.querySelector('.ng-apply-artists')?.addEventListener('click', () => artistPromptTags().forEach(tag => insertTag('prompt', tag)));
    cheat.querySelectorAll('.ng-set-uc').forEach(button => button.addEventListener('click', () => { const text = UC_PRESETS[button.dataset.uc] || ''; setNegative(text); }));
    const search = cheat.querySelector('.ng-artist-search');
    search?.addEventListener('input', () => { clearTimeout(artistDebounce); const query = search.value; if (query.trim().length < 2) return renderArtistResults(cheat, []); artistDebounce = setTimeout(async () => { try { renderArtistResults(cheat, await searchArtists(query)); } catch (error) { renderArtistResults(cheat, [], error.message); } }, 350); });
    cheat.querySelector('.ng-artist-clear')?.addEventListener('click', () => { if (search) search.value = ''; renderArtistResults(cheat, []); });
    renderSelectedArtists(cheat);
  });
}

function insertTag(target, tag) {
  if (studio) {
    const key = target === 'negative' ? 'negative' : 'prompt'; studio[key] = appendTags(studio[key], [tag]); const area = document.getElementById(key === 'negative' ? 'ng-negative' : 'ng-prompt'); if (area) area.value = studio[key]; return;
  }
  if (target === 'negative') settings().image.defaultNegative = appendTags(settings().image.defaultNegative, [tag]);
  else settings().image.suffix = appendTags(settings().image.suffix, [tag]);
  save(); toast('success', `Added “${tag}” to ${target === 'negative' ? 'default negative additions' : 'prompt suffix'}.`);
}
function setNegative(text) {
  if (studio) { studio.negative = text; const area = document.getElementById('ng-negative'); if (area) area.value = text; }
  else { settings().image.defaultNegative = text; const area = document.getElementById('ng-default-negative'); if (area) area.value = text; save(); }
}
function renderSuggestions(root) {
  const container = root.querySelector?.('.ng-suggestions') || document.querySelector('.ng-suggestions'); if (!container) return;
  const prompt = studio?.prompt || settings().image.suffix || ''; const items = suggestTags(prompt);
  container.innerHTML = items.map(tag => `<button class="menu_button ng-suggestion" data-tag="${attr(tag)}" type="button">${esc(tag)}</button>`).join(''); container.querySelectorAll('.ng-suggestion').forEach(button => button.addEventListener('click', () => insertTag('prompt', button.dataset.tag)));
}

async function searchArtists(query) {
  const normalized = String(query || '').trim().replace(/\s+/g, '_').toLowerCase(); if (normalized.length < 2) return []; if (artistCache.has(normalized)) return artistCache.get(normalized);
  const params = new URLSearchParams({ 'search[name_or_alias_matches]': `${normalized}*`, 'search[category]': '1', 'search[order]': 'count', 'search[is_deprecated]': 'false', limit: '30' });
  const response = await fetch(`${DANBOORU}/tags.json?${params.toString()}`, { headers: { Accept: 'application/json' } }); if (!response.ok) throw new Error(`Danbooru HTTP ${response.status}`);
  const items = (await response.json()).filter(item => Number(item.category) === 1 && !item.is_deprecated && item.name).map(item => ({ name: item.name, postCount: Number(item.post_count) || 0 })).slice(0, 30); artistCache.set(normalized, items); return items;
}
function renderArtistResults(cheat, items, error = '') {
  const node = cheat.querySelector('.ng-artist-results'); if (!node) return;
  if (error) { node.innerHTML = `<div class="ng-status is-error">Artist search failed: ${esc(error)}</div>`; return; }
  node.innerHTML = items.length ? items.map(item => `<button class="menu_button ng-artist-result" data-name="${attr(item.name)}" type="button"><span>${esc(item.name.replace(/_/g, ' '))}</span><small>${item.postCount.toLocaleString()} posts</small></button>`).join('') : '<small class="ng-help">Type at least 2 characters to search artist tags.</small>';
  node.querySelectorAll('.ng-artist-result').forEach(button => button.addEventListener('click', () => { const list = settings().promptAssistant.selectedArtists; if (!list.some(item => item.name === button.dataset.name)) list.push({ name: button.dataset.name, weight: 1 }); save(); document.querySelectorAll('.ng-cheats').forEach(renderSelectedArtists); }));
}
function renderSelectedArtists(cheat) {
  const node = cheat.querySelector?.('.ng-selected-artists'); if (!node) return; const items = settings().promptAssistant.selectedArtists;
  node.innerHTML = items.length ? items.map((item, index) => `<div class="ng-artist-chip"><span>${esc(item.name.replace(/_/g, ' '))}</span><label>Weight <input class="text_pole ng-artist-weight" data-index="${index}" type="number" min="-3" max="3" step="0.1" value="${Number(item.weight ?? 1)}"></label><button class="menu_button ng-artist-remove" data-index="${index}" type="button"><i class="fa-solid fa-xmark"></i></button></div>`).join('') : '<small class="ng-help">No artists selected yet.</small>';
  node.querySelectorAll('.ng-artist-weight').forEach(input => input.addEventListener('change', () => { const item = items[+input.dataset.index]; if (item) item.weight = clamp(input.value, -3, 3, 1); save(); }));
  node.querySelectorAll('.ng-artist-remove').forEach(button => button.addEventListener('click', () => { items.splice(+button.dataset.index, 1); save(); document.querySelectorAll('.ng-cheats').forEach(renderSelectedArtists); }));
}

function cheatsheetMarkdown() {
  const artists = settings().promptAssistant.selectedArtists.map(item => `- ${item.name.replace(/_/g, ' ')} — weight ${item.weight ?? 1}`).join('\n') || '- None selected';
  return `# NovelAI Cheatsheet — Novel Generation ${VERSION}\n\n## Artist / Style tags\nSearch Danbooru artist tags lazily in the extension. Multiple artists can be mixed with numeric weights.\n\n${artists}\n\n## source# / target# / mutual#\n- source#action: the character performs the action.\n- target#action: the character receives the action.\n- mutual#action: the action is mutual.\n\n## Density / weighting\n- {tag} strengthens; [tag] weakens.\n- V4+ supports numerical emphasis such as 1.3::tag :: and 0.5::tag ::.\n- V4.5 supports negative numerical emphasis such as -1::tag :: for targeted removal/inversion.\n\n## Quality / Aesthetic / Special\n${[...TAGS.quality, ...TAGS.aesthetic, ...TAGS.special].map(tag => `- ${tag}`).join('\n')}\n\n## Undesired Content\n${TAGS.negative.map(tag => `- ${tag}`).join('\n')}\n\n## Medium / Art style / Coloring / FX\n${[...TAGS.medium, ...TAGS.art, ...TAGS.fx].map(tag => `- ${tag}`).join('\n')}\n\n## Camera / Frame / Lighting\n${TAGS.camera.map(tag => `- ${tag}`).join('\n')}\n\n## Character / Costume\n${[...TAGS.character, ...TAGS.costume].map(tag => `- ${tag}`).join('\n')}\n\n## Rating tags\n${TAGS.rating.map(tag => `- ${tag}`).join('\n')}\n\n## Image parameter notes\n- Euler Ancestral and DPM++ 2M are reliable general samplers.\n- Around 28 Steps and Guidance around 5–6 are useful V3+ starting points.\n- Reuse a fixed seed for A/B comparisons.\n- SMEA is aimed at higher-resolution coherency and can cost more compute.\n- NovelAI Opus no-Anlas conditions and third-party proxy billing are not the same thing.\n- Precise Reference uses large reference canvases such as 1024×1536, 1472×1472 and 1536×1024.\n\nGenerated by Novel Generation.\n`;
}
function exportCheatsheet() {
  const blob = new Blob([cheatsheetMarkdown()], { type: 'text/markdown;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `novelai-cheatsheet-${Date.now()}.md`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function effectivePrompt(state) {
  const image = settings().image; let text = state.prompt.trim();
  if (image.prefix.trim()) text = `${image.prefix.trim()}, ${text}`;
  if (image.suffix.trim()) text = appendTags(text, promptParts(image.suffix));
  return text;
}
function effectiveNegative(state) {
  const image = settings().image; let text = UC_PRESETS[image.negativePreset] || '';
  text = appendTags(text, promptParts(image.defaultNegative)); text = appendTags(text, promptParts(state.negative)); return text;
}
function smeaFields(state) {
  if (state.source) return { sm: false, sm_dyn: false };
  const pixels = state.width * state.height; const mode = state.smeaMode;
  if (mode === 'auto') return { sm: pixels > 1024 * 1024, sm_dyn: false };
  if (mode === 'smea') return { sm: true, sm_dyn: false };
  if (mode === 'smea_dyn') return { sm: true, sm_dyn: true };
  return { sm: false, sm_dyn: false };
}
function parseExtraBody() {
  const raw = settings().image.extraBody.trim(); if (!raw) return {};
  try { const data = JSON.parse(raw); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { throw new Error('Extra request body is not valid JSON.'); }
}
function buildPayload(state, strict = false) {
  const s = settings(); const prompt = effectivePrompt(state); const negative = effectiveNegative(state);
  const basic = { model: s.model, prompt, n: Math.round(clamp(state.n, 1, 4, 1)), size: `${state.width}x${state.height}`, response_format: s.responseFormat };
  if (strict) return basic;
  const samplerExtras = smeaFields(state);
  const extended = cleanObject({ ...basic, width: state.width, height: state.height, steps: state.steps, guidance: state.guidance, scale: state.guidance, cfg_scale: state.guidance, sampler: state.sampler, scheduler: state.scheduler === 'native' ? undefined : state.scheduler, noise_schedule: state.scheduler === 'native' ? undefined : state.scheduler, seed: state.seed, negative_prompt: negative, ...samplerExtras, dynamic_thresholding: Boolean(state.decrisper) });
  if (state.source) {
    extended.action = state.editMode === 'inpaint' ? 'infill' : 'img2img'; extended.image = state.source.base64; extended.strength = state.strength; extended.noise = state.noise; extended.add_original_image = true; if (state.editMode === 'inpaint' && state.mask) extended.mask = state.mask.base64;
    extended.parameters = cleanObject({ params_version: 3, width: state.width, height: state.height, scale: state.guidance, sampler: state.sampler, steps: state.steps, seed: state.seed, n_samples: extended.n, noise_schedule: state.scheduler === 'native' ? 'karras' : state.scheduler, uc: negative, ...samplerExtras, dynamic_thresholding: Boolean(state.decrisper), image: state.source.base64, strength: state.strength, noise: state.noise, add_original_image: true, ...(state.editMode === 'inpaint' && state.mask ? { mask: state.mask.base64 } : {}) });
  }
  return cleanObject({ ...extended, ...parseExtraBody() });
}

function safeDebug(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'string' && item.length > 600 ? `${item.slice(0, 100)}…[${item.length} chars]` : item));
}
function debugAttempt(entry) { debugLog.unshift({ time: new Date().toISOString(), ...entry }); debugLog.splice(40); renderDebug(); }
function renderDebug() {
  const text = debugLog.length ? JSON.stringify(debugLog, null, 2) : 'No requests yet.'; const a = document.getElementById('ng-debug-output'); const b = document.getElementById('ng-studio-debug'); if (a) a.textContent = text; if (b) b.textContent = text;
}

function normImage(value) {
  const text = String(value || '').trim(); if (!text) return ''; if (/^(data:image\/|https?:\/\/|blob:|\/)/i.test(text)) return text; return text.length > 200 ? `data:image/png;base64,${text.replace(/\s+/g, '')}` : text;
}
function extractImages(data) {
  const out = []; const items = Array.isArray(data?.data) ? data.data : Array.isArray(data?.images) ? data.images : [];
  for (const item of items) { if (typeof item === 'string') out.push(normImage(item)); else if (item?.b64_json) out.push(`data:image/png;base64,${item.b64_json}`); else if (item?.base64) out.push(normImage(item.base64)); else if (item?.url) out.push(normImage(item.url)); else if (item?.image_url?.url) out.push(normImage(item.image_url.url)); }
  if (!out.length && data?.url) out.push(normImage(data.url)); if (!out.length && data?.b64_json) out.push(`data:image/png;base64,${data.b64_json}`);
  const message = data?.choices?.[0]?.message; const content = message?.content; if (Array.isArray(content)) for (const part of content) { if (part?.image_url?.url) out.push(normImage(part.image_url.url)); if (part?.b64_json) out.push(`data:image/png;base64,${part.b64_json}`); }
  if (Array.isArray(message?.images)) for (const image of message.images) out.push(normImage(image?.image_url?.url || image?.url || image?.b64_json || ''));
  return [...new Set(out.filter(Boolean))];
}

async function postImageRequest(payload, schema, signal) {
  const url = endpoint('/v1/images/generations'); const started = performance.now();
  const response = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(payload), signal }); const raw = await response.text(); let data; try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  debugAttempt({ route: 'images', schema, status: response.status, ms: Math.round(performance.now() - started), payload: safeDebug(payload), response: safeDebug(data) });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}: ${raw.slice(0, 700) || response.statusText}`), { status: response.status });
  const images = extractImages(data); if (!images.length) throw Object.assign(new Error('Provider returned success but no image URL/base64 was found.'), { status: 200 });
  return { images, data, schema, route: 'images' };
}
async function postChatRequest(payload, signal) {
  const body = { model: payload.model, messages: [{ role: 'user', content: payload.prompt }], modalities: ['text', 'image'], image_generation: payload }; const started = performance.now(); const response = await fetch(endpoint('/v1/chat/completions'), { method: 'POST', headers: headers(), body: JSON.stringify(body), signal }); const raw = await response.text(); let data; try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  debugAttempt({ route: 'chat', schema: 'chat-image-generation', status: response.status, ms: Math.round(performance.now() - started), payload: safeDebug(body), response: safeDebug(data) });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}: ${raw.slice(0, 700) || response.statusText}`), { status: response.status }); const images = extractImages(data); if (!images.length) throw new Error('Chat route returned no image.'); return { images, data, schema: 'chat-image-generation', route: 'chat' };
}

async function generateState(state) {
  const s = settings(); if (!base()) throw new Error('Set Base URL first.'); if (!apiKey) throw new Error('Enter the API key again for this session.'); if (!s.model) throw new Error('Select a model first.'); if (!state.prompt.trim()) throw new Error('Enter a prompt first.'); if (state.editMode === 'inpaint' && (!state.source || !state.mask)) throw new Error('Inpaint requires both a source image and a mask image.');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), s.timeoutMs); const failures = [];
  try {
    if (s.routeMode !== 'chat') {
      const extended = buildPayload(state, false);
      try { return await postImageRequest(extended, 'openai-novelai-extended', controller.signal); }
      catch (error) { failures.push(error.message); if (error.name === 'AbortError' || error.status === 401 || error.status === 403) throw error; if (![400, 404, 405, 415, 422].includes(error.status)) throw error; }
      if (!state.source) {
        try { return await postImageRequest(buildPayload(state, true), 'strict-openai-fallback', controller.signal); }
        catch (error) { failures.push(error.message); if (error.name === 'AbortError' || error.status === 401 || error.status === 403) throw error; }
      }
    }
    if (s.routeMode === 'chat' || s.routeMode === 'auto') {
      if (state.source) throw new Error('Chat fallback is disabled for Image2Image/Inpaint.');
      try { return await postChatRequest(buildPayload(state, true), controller.signal); }
      catch (error) { failures.push(error.message); }
    }
  } finally { clearTimeout(timer); }
  throw new Error(failures.at(-1) || 'Generation failed.');
}

function rememberImages(images, state, extra = {}) {
  if (!settings().roleplay.gallery) return; images.forEach(src => gallery.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, src, prompt: effectivePrompt(state), negative: effectiveNegative(state), model: settings().model, width: state.width, height: state.height, seed: state.seed, createdAt: new Date().toISOString(), ...extra })); gallery.splice(40); renderGallery();
}

function imageActions(index) {
  return `<div class="ng-generated-actions"><button class="menu_button ng-send-chat" data-index="${index}" type="button"><i class="fa-solid fa-comment"></i> Send to chat</button><button class="menu_button ng-use-source" data-index="${index}" type="button"><i class="fa-solid fa-image"></i> Use as source</button><a class="menu_button ng-download" data-index="${index}" href="#"><i class="fa-solid fa-download"></i> Save</a></div>`;
}
function showImages(images) {
  const node = document.getElementById('ng-preview'); if (!node) return; studio.generated = images; node.innerHTML = `<div class="ng-generated-grid">${images.map((src, index) => `<figure class="ng-generated-card"><img src="${attr(src)}"><figcaption>${imageActions(index)}</figcaption></figure>`).join('')}</div>`; bindImageActions(node, images);
}
function bindImageActions(root, images) {
  root.querySelectorAll('.ng-send-chat').forEach(button => button.addEventListener('click', async () => { try { await insertImagesIntoChat([images[+button.dataset.index]], studio?.prompt || ''); toast('success', 'Image inserted into chat.'); } catch (error) { toast('error', error.message); } }));
  root.querySelectorAll('.ng-use-source').forEach(button => button.addEventListener('click', async () => { const src = images[+button.dataset.index]; const ref = await srcToRef(src); studio.source = ref; studio.editMode = 'img2img'; const mode = document.getElementById('ng-edit-mode'); if (mode) mode.value = 'img2img'; renderSourcePreview(); openStudioSection('edit'); }));
  root.querySelectorAll('.ng-download').forEach(anchor => anchor.addEventListener('click', event => { event.preventDefault(); const src = images[+anchor.dataset.index]; const a = document.createElement('a'); a.href = src; a.download = `novel-generation-${Date.now()}.png`; a.click(); }));
}
async function srcToRef(src) { if (src.startsWith('data:image/')) return { dataUrl: src, base64: src.split(',')[1] || '', name: 'generated.png' }; const response = await fetch(src); const blob = await response.blob(); return fileToRef(new File([blob], 'generated.png', { type: blob.type || 'image/png' })); }

async function generateStudio() {
  const button = document.getElementById('ng-generate'); const statusNode = document.getElementById('ng-gen-status'); button?.setAttribute('disabled', 'disabled'); if (statusNode) statusNode.textContent = 'Generating…';
  try { const result = await generateState(studio); showImages(result.images); rememberImages(result.images, studio, { schema: result.schema, route: result.route }); if (statusNode) statusNode.textContent = `Generated ${result.images.length} image${result.images.length === 1 ? '' : 's'} using ${result.schema}.`; }
  catch (error) { if (statusNode) statusNode.textContent = `Generation failed: ${error.message}`; toast('error', error.message); } finally { button?.removeAttribute('disabled'); }
}

function quickPreview(state, mode) {
  return new Promise(resolve => { const overlay = document.createElement('div'); overlay.className = 'ng-modal-backdrop'; overlay.innerHTML = `<div class="ng-modal ng-quick-preview"><header><div><strong>Quick Generation Preview</strong><small>${esc(mode)}</small></div><button class="menu_button ng-cancel" type="button"><i class="fa-solid fa-xmark"></i></button></header>${field('Prompt', `<textarea class="text_pole ng-q-prompt" rows="10">${esc(state.prompt)}</textarea>`)}${field('Undesired Content additions', `<textarea class="text_pole ng-q-negative" rows="4">${esc(state.negative)}</textarea>`)}<div class="ng-tag-grid">${suggestTags(state.prompt).map(tag => `<button class="menu_button ng-q-tag" data-tag="${attr(tag)}" type="button">${esc(tag)}</button>`).join('')}</div><footer><button class="menu_button ng-cancel" type="button">Cancel</button><button class="menu_button ng-primary ng-approve" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate & insert</button></footer></div>`; document.documentElement.appendChild(overlay); const prompt = overlay.querySelector('.ng-q-prompt'); const negative = overlay.querySelector('.ng-q-negative'); overlay.querySelectorAll('.ng-q-tag').forEach(button => button.addEventListener('click', () => prompt.value = appendTags(prompt.value, [button.dataset.tag]))); const finish = value => { overlay.remove(); resolve(value); }; overlay.querySelectorAll('.ng-cancel').forEach(button => button.addEventListener('click', () => finish(null))); overlay.querySelector('.ng-approve')?.addEventListener('click', () => { state.prompt = prompt.value.trim(); state.negative = negative.value.trim(); finish(state); }); });
}
async function quickGenerate(mode, manual = '') {
  const state = newStudio(mode, manual); if (!state.prompt.trim()) return toast('warning', 'No prompt or roleplay context available.'); if (settings().roleplay.quickPreview && !(await quickPreview(state, mode))) return; toast('info', `Generating ${mode === 'last' ? 'current scene' : mode}…`);
  try { const result = await generateState(state); rememberImages(result.images, state, { schema: result.schema, route: result.route, quick: true }); if (settings().roleplay.autoInsert) await insertImagesIntoChat(result.images, state.prompt); toast('success', settings().roleplay.autoInsert ? 'Generated from chat context and inserted into chat.' : 'Generated from chat context.'); }
  catch (error) { toast('error', error.message); }
}

async function uploadDataImage(src) {
  if (!src.startsWith('data:image/')) return src; const c = ctx(); const match = src.match(/^data:([^;]+);base64,(.*)$/); if (!match) return src; const meta = match[1], data = match[2]; const extension = /jpeg/i.test(meta) ? 'jpg' : /webp/i.test(meta) ? 'webp' : 'png'; const response = await fetch('/api/files/upload', { method: 'POST', headers: c.getRequestHeaders?.() || { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `novel-generation-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`, data }) }); if (!response.ok) throw new Error(`Could not save image to SillyTavern media storage: HTTP ${response.status}`); const body = await response.json(); return body.path || body.url || src;
}
function findChatTarget(target) { const chat = ctx().chat || []; if (!chat.length) return -1; if (target === 'latest') return chat.length - 1; const wantUser = target === 'user'; for (let i = chat.length - 1; i >= 0; i--) { const message = chat[i]; if (!message || message.is_system) continue; if (Boolean(message.is_user) === wantUser) return i; } return chat.length - 1; }
async function insertImagesIntoChat(images, promptText = '') {
  const c = ctx(); const id = findChatTarget(settings().autoInsertTarget); if (id < 0) throw new Error('There is no chat message to attach the generated image to.'); const message = c.chat[id]; message.extra ??= {}; if (!Array.isArray(message.extra.media)) message.extra.media = [];
  for (let i = 0; i < images.length; i++) { const url = await uploadDataImage(images[i]); message.extra.media.push({ url, type: 'image', title: `Novel Generation${images.length > 1 ? ` ${i + 1}` : ''}`, source: 'generation', prompt: promptText }); }
  message.extra.media_index = message.extra.media.length - 1; message.extra.inline_image = true; await c.saveChat?.(); try { c.updateMessageBlock?.(id, message); } catch {} try { const block = globalThis.$?.(`.mes[mesid="${id}"]`); if (block?.length) c.appendMediaToMessage?.(message, block); } catch {} c.scrollChatToBottom?.();
}

function renderGallery() {
  const node = document.getElementById('ng-gallery-grid'); if (!node) return; if (!gallery.length) { node.innerHTML = '<small class="ng-help">Session gallery is empty.</small>'; return; }
  const images = gallery.map(item => item.src); node.innerHTML = gallery.map((item, index) => `<article class="ng-gallery-item"><img src="${attr(item.src)}"><div><strong>${esc(item.model)}</strong><small>${item.width} × ${item.height}</small></div>${imageActions(index)}</article>`).join(''); bindImageActions(node, images);
}

async function runUpscale(mode) {
  if (!studio?.source) return toast('warning', 'Choose a source image first.'); const src = studio.source; const ratio = studio.width / studio.height; let width, height;
  if (mode === '4k') { if (ratio >= 1) { width = 3840; height = round64(3840 / ratio); } else { height = 3840; width = round64(3840 * ratio); } } else { width = round64(studio.width * 2); height = round64(studio.height * 2); }
  const payload = { model: settings().model, image: src.base64, factor: mode === '4k' ? 4 : 2, scale: mode === '4k' ? 4 : 2, width, height, response_format: settings().responseFormat };
  for (const path of ['/v1/images/upscale', '/v1/images/upscales']) {
    try { const response = await fetch(endpoint(path), { method: 'POST', headers: headers(), body: JSON.stringify(payload) }); const raw = await response.text(); let data; try { data = JSON.parse(raw); } catch { data = { raw }; } debugAttempt({ route: path, schema: 'provider-upscale', status: response.status, payload: safeDebug(payload), response: safeDebug(data) }); if (response.ok) { const images = extractImages(data); if (images.length) { showImages(images); rememberImages(images, studio, { upscale: mode }); return toast('success', 'Provider upscale completed.'); } } } catch {}
  }
  const fallback = { ...studio, source: src, editMode: 'img2img', width, height, strength: 0.18, noise: 0.04, n: 1, prompt: studio.prompt.trim() || 'high quality, detailed, clean linework, refined details' };
  try { const result = await generateState(fallback); showImages(result.images); rememberImages(result.images, fallback, { upscale: mode, fallback: true }); toast('success', 'High-resolution img2img fallback completed.'); } catch (error) { toast('error', `Upscale failed: ${error.message}`); }
}

function wandRow(id, icon, title, subtitle) {
  return `<div id="${id}" class="list-group-item flex-container flexGap5 interactable ng-wand-row" tabindex="0" role="button"><i class="${icon} fa-fw"></i><div><strong>${title}</strong>${subtitle ? `<small>${subtitle}</small>` : ''}</div></div>`;
}
function bindPress(node, handler) { if (!node) return; const run = event => { event.preventDefault(); event.stopPropagation(); handler(event); }; node.addEventListener('click', run); node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') run(event); }); }
function initWand() {
  const menu = document.getElementById('extensionsMenu'); if (!menu || document.getElementById('ng-wand-image')) return Boolean(document.getElementById('ng-wand-image'));
  const wrap = document.createElement('div'); wrap.className = 'ng-wand-group'; wrap.innerHTML = `${wandRow('ng-wand-image', 'fa-solid fa-wand-magic-sparkles', 'Novel Image Gen', 'Roleplay-aware image generation')}<div class="ng-wand-submenu" id="ng-wand-submenu">${wandRow('ng-wand-portrait', 'fa-solid fa-user', 'Portrait', 'Current character')}${wandRow('ng-wand-selfie', 'fa-solid fa-camera-retro', 'Selfie', 'Close-up current scene')}${wandRow('ng-wand-user', 'fa-solid fa-user-pen', 'User', 'Current persona')}${wandRow('ng-wand-last', 'fa-solid fa-comments', 'Last Message / Scene', 'Read recent roleplay')}${wandRow('ng-wand-manga', 'fa-solid fa-table-cells-large', 'Manga Panel', 'Current scene as manga')}${wandRow('ng-wand-free', 'fa-solid fa-pen-to-square', 'Free / Scene', 'Manual prompt')}${wandRow('ng-wand-studio', 'fa-solid fa-sliders', 'Open Novel Gen Studio', 'Full prompt workspace')}</div>`;
  menu.appendChild(wrap); const submenu = wrap.querySelector('#ng-wand-submenu'); submenu.hidden = true; bindPress(wrap.querySelector('#ng-wand-image'), () => { submenu.hidden = !submenu.hidden; });
  const modes = [['portrait','portrait'],['selfie','selfie'],['user','user'],['last','last'],['manga','manga']]; modes.forEach(([id, mode]) => bindPress(wrap.querySelector(`#ng-wand-${id}`), () => { submenu.hidden = true; quickGenerate(mode); }));
  bindPress(wrap.querySelector('#ng-wand-free'), () => { submenu.hidden = true; const prompt = window.prompt('Image prompt / scene instruction:'); if (prompt?.trim()) quickGenerate('free', prompt); }); bindPress(wrap.querySelector('#ng-wand-studio'), () => { submenu.hidden = true; openStudio('last'); }); return true;
}

function injectSettings() {
  const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings'); if (!host || document.getElementById('ng-settings')) return Boolean(document.getElementById('ng-settings')); const wrap = document.createElement('div'); wrap.innerHTML = settingsHtml(); host.appendChild(wrap.firstElementChild); bindSettings(); return true;
}
function attemptMount() {
  mountAttempts += 1; const settingsReady = document.getElementById('ng-settings') ? true : injectSettings(); const wandReady = document.getElementById('ng-wand-image') ? true : initWand(); if ((settingsReady && wandReady) || mountAttempts >= 40) { if (mountTimer) clearInterval(mountTimer); mountTimer = null; }
}
function init() { settings(); attemptMount(); if (!mountTimer) mountTimer = setInterval(attemptMount, 500); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
