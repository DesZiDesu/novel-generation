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
      if (!byId('ng-studio-overlay') && typeof globalThis.openStudio === 'function') {
        globalThis.openStudio('free', 'ai-helper');
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
