// Novel Generation v0.5.1 — additive feature layer on top of the restored v0.4 UI/runtime.
// This layer intentionally keeps the v0.4 drawer, wand menu, Studio, Vibe/Precise,
// touch mask painter, gallery/export, and Prompt Assistant designs intact.

var NG_V051_RELEASE = '0.5.1';
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
