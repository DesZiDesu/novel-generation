// Novel Generation v0.5.5 — mobile workspace + AI Prompt Helper.
var NG_V055_RELEASE = '0.5.5';

function ngV055IsMobile() {
  try { return window.matchMedia('(max-width: 650px)').matches || Boolean(ctx()?.isMobile?.()); }
  catch { return window.matchMedia('(max-width: 650px)').matches; }
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

function ngV055NormalizeAiTags(raw) {
  var text = String(raw || '').replace(/```(?:\w+)?/gi, '').replace(/```/g, '')
    .replace(/^\s*(?:tags?|prompt)\s*:\s*/i, '').replace(/\r/g, '\n').replace(/[;\n]+/g, ',');
  var seen = new Set();
  return text.split(',').map(function (tag) { return tag.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, ' '); })
    .filter(Boolean).filter(function (tag) { var key = tag.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
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
  studio.prompt = append && studio.prompt
    ? (typeof ngV040AppendTags === 'function' ? ngV040AppendTags(studio.prompt, ngV055NormalizeAiTags(next)) : studio.prompt.replace(/\s*,?\s*$/, '') + ', ' + next)
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
    if (output) output.value = finalPrompt;
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
    + '<p class="ng-muted">Describe the image naturally in Thai, English, or another language. The helper uses your current SillyTavern AI connection to convert it into NovelAI/Danbooru-style tags.</p>'
    + '<label class="ng-field"><span class="ng-label">Image idea</span><textarea id="ng-v055-ai-input" class="text_pole" rows="4" placeholder="ผู้หญิงใส่เสื้อแจ็คเก็ตยืนตากแดดที่สี่แยกเมืองชินจูกุ"></textarea></label>'
    + '<div class="ng-v055-ai-options">'
    + '<label class="checkbox_label"><input id="ng-v055-ai-quality" type="checkbox" ' + (prefs.aiHelperQuality ? 'checked' : '') + '><span>Add model-aware Quality Tags</span></label>'
    + '<label class="checkbox_label"><input id="ng-v055-ai-artists" type="checkbox" ' + (prefs.aiHelperArtists ? 'checked' : '') + '><span>Add selected Danbooru artist mix</span></label>'
    + '<label class="checkbox_label"><input id="ng-v055-ai-suggest" type="checkbox" ' + (prefs.aiHelperSuggestions ? 'checked' : '') + '><span>Add local Suggest Tags</span></label>'
    + '</div><div class="ng-actions"><button id="ng-v055-ai-run" class="menu_button" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Convert to Tags</button></div>'
    + '<small id="ng-v055-ai-status" class="ng-help">Uses the same AI/model currently selected in SillyTavern and consumes one text-generation call.</small>'
    + '<label class="ng-field"><span class="ng-label">Generated tags</span><textarea id="ng-v055-ai-output" class="text_pole" rows="6" placeholder="AI-generated tags appear here…"></textarea></label>'
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
