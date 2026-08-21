/*
 * Novel Generation — full photo analysis and prompt builder.
 */
(() => {
  'use strict';
  const EXT = 'novelGeneration';
  const OVERLAY_ID = 'ng-image-analyzer-overlay';
  const DEFAULTS = {
    preset: 'tags',
    language: 'auto',
    model: '',
    instruction: '',
    timeoutMs: 120000,
    temperature: 0.35,
    maxTokens: 1400,
  };
  const state = { image: null, result: '', busy: false };
  let escapeHandler = null;
  let fallbackSettings = { imageAnalysis: { ...DEFAULTS } };
  const context = () => globalThis.SillyTavern?.getContext?.();
  const byId = id => document.getElementById(id);

  function extensionSettings() {
    try {
      const c = context();
      c.extensionSettings ??= {};
      c.extensionSettings[EXT] ??= {};
      const s = c.extensionSettings[EXT];
      s.imageAnalysis ??= {};
      for (const [key, value] of Object.entries(DEFAULTS)) {
        if (!(key in s.imageAnalysis)) s.imageAnalysis[key] = value;
      }
      return s;
    } catch {
      return fallbackSettings;
    }
  }

  function saveSettings() {
    try { context()?.saveSettingsDebounced?.(); } catch { /* SillyTavern may not be ready yet. */ }
  }

  function escapeHtml(value = '') {
    const node = document.createElement('div');
    node.textContent = String(value);
    return node.innerHTML;
  }

  function escapeAttr(value = '') {
    return escapeHtml(value).replace(/"/g, '&quot;');
  }

  function toast(kind, message) {
    const t = globalThis.toastr;
    if (t?.[kind]) t[kind](message, 'Novel Generation');
    else console[kind === 'error' ? 'error' : 'log']('[Novel Generation] ' + message);
  }

  function selected(actual, expected) {
    return actual === expected ? ' selected' : '';
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

  function analysisBaseUrl(s) {
    const a = s.imageAnalysis || {};
    const raw = String(a.baseUrl || s.proxyBaseUrl || (s.provider === 'proxy' ? s.baseUrl : '') || '').trim();
    return raw.replace(/\/+$/, '');
  }

  function analysisEndpoint(s) {
    const base = analysisBaseUrl(s);
    if (!base) return '';
    return /\/v1$/i.test(base) ? base + '/chat/completions' : base + '/v1/chat/completions';
  }

  function analysisKey(s) {
    const a = s.imageAnalysis || {};
    return String(a.apiKey || s.proxyApiKey || (s.provider === 'proxy' ? s.apiKey : '') || '').trim();
  }

  function analysisModel(s) {
    const a = s.imageAnalysis || {};
    return String(a.model || s.analysisModel || s.model || '').trim();
  }

  function systemInstruction() {
    return [
      'You are a meticulous visual prompt analyst for an image-generation workflow.',
      'Inspect the attached image itself and describe only what is visibly supported.',
      'Cover the main subject or subjects, count, pose, expression, clothing, hair, notable objects, setting,',
      'composition, camera angle, framing, lighting, color palette, materials, atmosphere, visual style,',
      'and any legible text. Do not identify real people or invent hidden details.',
      'Respect the user request while preserving important visible details from the source image.',
    ].join(' ');
  }

  function userInstruction(s) {
    const a = s.imageAnalysis || {};
    const request = String(a.instruction || '').trim() || 'Create the most faithful image-generation description of this image.';
    const language = languageLabel(a.language);
    if (a.preset === 'native') {
      return [
        'Analyze the attached image and write one polished, detailed image-generation prompt.',
        'Write the final prompt in ' + language + '.',
        'Include subject, action, environment, composition, camera perspective, lighting, colors, mood,',
        'texture, and style when visible. If the user asks for a change, incorporate that change clearly.',
        'Do not add an introduction, explanation, labels, or markdown. Return only the final prompt as one paragraph.',
        'User request: ' + request,
      ].join(' ');
    }
    return [
      'Analyze the attached image and convert the visible content into a precise image-generation tag prompt.',
      'Write the tags in ' + language + '.',
      'Return ONLY one comma-separated line of concise tags. Do not use bullets, labels, explanations, sentences,',
      'markdown, or a code block. Include subject, number of subjects, appearance, clothing, pose, setting,',
      'composition, camera/framing, lighting, colors, atmosphere, materials, and visual style when visible.',
      'Do not invent details that cannot be seen. Add the requested transformation when one is provided.',
      'User request: ' + request,
    ].join(' ');
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
      const preview = await readFile(file);
      const analysis = await optimizeForAnalysis(preview);
      state.image = {
        name: file.name || 'selected-image',
        type: file.type || 'image/*',
        size: file.size,
        preview,
        analysis,
      };
      state.result = '';
      render();
    } catch (error) {
      toast('error', error.message);
    }
  }

  function removeImage() {
    state.image = null;
    state.result = '';
    const input = byId('ng-ia-file');
    if (input) input.value = '';
    render();
  }
  function parseMessageContent(content) {
    if (Array.isArray(content)) {
      return content.map(part => typeof part === 'string' ? part : part?.text || '').join('');
    }
    return String(content || '');
  }

  function cleanResult(value, preset) {
    let text = String(value || '').trim();
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

  async function responseError(response) {
    try {
      const text = await response.text();
      return text ? text.slice(0, 1000) : response.statusText;
    } catch {
      return response.statusText;
    }
  }
  async function analyze() {
    if (!state.image || state.busy) return;
    const s = extensionSettings();
    const a = s.imageAnalysis;
    const endpoint = analysisEndpoint(s);
    const model = analysisModel(s);
    if (!endpoint) {
      setStatus('Set an OpenAI-compatible proxy Base URL in Novel Generation settings first.', 'error');
      return;
    }
    if (!model) {
      setStatus('Set a vision-capable model before analyzing an image.', 'error');
      return;
    }
    if (s.provider === 'novelai' && !s.proxyBaseUrl && !a.baseUrl) {
      setStatus('Direct NovelAI image generation does not provide vision analysis. Configure an OpenAI-compatible proxy URL.', 'error');
      return;
    }

    state.busy = true;
    setStatus('Reading the image and building your prompt…', 'working');
    render();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(a.timeoutMs) || 120000));
    try {
      const headers = { 'Content-Type': 'application/json' };
      const key = analysisKey(s);
      if (key) headers.Authorization = 'Bearer ' + key;
      const payload = {
        model,
        messages: [
          { role: 'system', content: systemInstruction() },
          {
            role: 'user',
            content: [
              { type: 'text', text: userInstruction(s) },
              { type: 'image_url', image_url: { url: state.image.analysis } },
            ],
          },
        ],
        temperature: Number(a.temperature) || 0.35,
        max_tokens: Math.max(200, Number(a.maxTokens) || 1400),
      };
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + await responseError(response));
      const data = await response.json();
      const raw = parseMessageContent(data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text);
      if (!raw.trim()) throw new Error('The model returned an empty prompt.');
      state.result = cleanResult(raw, a.preset);
      setStatus('Analysis complete. Review the prompt, then copy or download it.', 'ok');
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? 'Analysis timed out. Try a smaller image or a shorter request.'
        : error.message || 'Image analysis failed.';
      setStatus(message, 'error');
    } finally {
      clearTimeout(timeout);
      state.busy = false;
      render();
    }
  }

  function setStatus(message, kind = '') {
    const status = byId('ng-ia-status');
    if (status) {
      status.textContent = message;
      status.className = 'ng-ia-status' + (kind ? ' is-' + kind : '');
    }
  }
  function copyResult() {
    if (!state.result) return;
    const done = () => toast('success', 'Prompt copied to clipboard.');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(state.result).then(done).catch(() => fallbackCopy(done));
    } else {
      fallbackCopy(done);
    }
  }

  function fallbackCopy(done) {
    const output = byId('ng-ia-output');
    if (!output) return;
    output.focus();
    output.select();
    document.execCommand('copy');
    done();
  }

  function downloadResult() {
    if (!state.result) return;
    const blob = new Blob([state.result], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'novel-generation-image-prompt.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function render() {
    const image = state.image;
    const preview = byId('ng-ia-preview');
    const empty = byId('ng-ia-empty');
    const drop = byId('ng-ia-drop');
    const remove = byId('ng-ia-remove');
    const analyzeButton = byId('ng-ia-analyze');
    const copy = byId('ng-ia-copy');
    const download = byId('ng-ia-download');
    const output = byId('ng-ia-output');
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
    if (drop) drop.classList.toggle('has-image', Boolean(image));
    if (remove) remove.disabled = !image || state.busy;
    if (analyzeButton) {
      analyzeButton.disabled = !image || state.busy;
      analyzeButton.innerHTML = state.busy
        ? '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing image…'
        : '<i class="fa-solid fa-wand-magic-sparkles"></i> Analyze image';
    }
    if (copy) copy.disabled = !state.result || state.busy;
    if (download) download.disabled = !state.result || state.busy;
    if (output && output.value !== state.result) output.value = state.result;
    const fileMeta = byId('ng-ia-file-meta');
    if (fileMeta) fileMeta.textContent = image ? image.name + ' · ' + formatBytes(image.size) : 'No image selected';
  }
  function analyzerHtml() {
    const s = extensionSettings();
    const a = s.imageAnalysis;
    return [
      '<div class="ng-ia-dialog" role="dialog" aria-modal="true" aria-labelledby="ng-ia-title">',
      '<header class="ng-ia-header"><div class="ng-ia-title"><i class="fa-solid fa-camera-retro"></i><span><strong id="ng-ia-title">Image Prompt Analyzer</strong><small>Turn a reference image into a generation prompt</small></span></div><button id="ng-ia-close" class="menu_button ng-ia-close" type="button" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></header>',
      '<main class="ng-ia-main">',
      '<section class="ng-ia-card ng-ia-source-card"><div class="ng-ia-card-title"><i class="fa-solid fa-image"></i><span><strong>Source image</strong><small>Select, replace, or remove the image at any time</small></span></div>',
      '<div id="ng-ia-drop" class="ng-ia-drop"><div id="ng-ia-empty" class="ng-ia-empty"><i class="fa-regular fa-image"></i><strong>Choose an image to analyze</strong><span>Drop an image here or use the button below</span></div><img id="ng-ia-preview" hidden alt="Selected source preview"></div>',
      '<div class="ng-ia-file-row"><label class="menu_button ng-ia-file-button"><i class="fa-solid fa-arrow-up-from-bracket"></i><span>Choose / replace image</span><input id="ng-ia-file" type="file" accept="image/*"></label><button id="ng-ia-remove" class="menu_button ng-ia-danger" type="button" disabled><i class="fa-solid fa-trash"></i> Remove</button></div>',
      '<small id="ng-ia-file-meta" class="ng-ia-file-meta">No image selected</small></section>',
      '<section class="ng-ia-card ng-ia-options-card"><div class="ng-ia-card-title"><i class="fa-solid fa-sliders"></i><span><strong>Prompt options</strong><small>Choose how the model should write the result</small></span></div>',
      '<label class="ng-ia-field"><span>Prompt preset</span><select id="ng-ia-preset" class="text_pole"><option value="tags"' + selected(a.preset, 'tags') + '>Pure tags prompt</option><option value="native"' + selected(a.preset, 'native') + '>Native-language prompt</option></select></label>',
      '<label class="ng-ia-field"><span>Output language</span><select id="ng-ia-language" class="text_pole"><option value="auto"' + selected(a.language, 'auto') + '>Auto / language of request</option><option value="English"' + selected(a.language, 'English') + '>English</option><option value="Thai"' + selected(a.language, 'Thai') + '>ไทย (Thai)</option><option value="Japanese"' + selected(a.language, 'Japanese') + '>日本語 (Japanese)</option><option value="Chinese"' + selected(a.language, 'Chinese') + '>简体中文 (Chinese)</option><option value="Korean"' + selected(a.language, 'Korean') + '>한국어 (Korean)</option><option value="Spanish"' + selected(a.language, 'Spanish') + '>Español (Spanish)</option><option value="French"' + selected(a.language, 'French') + '>Français (French)</option><option value="German"' + selected(a.language, 'German') + '>Deutsch (German)</option><option value="Portuguese"' + selected(a.language, 'Portuguese') + '>Português (Portuguese)</option><option value="Vietnamese"' + selected(a.language, 'Vietnamese') + '>Tiếng Việt (Vietnamese)</option></select></label>',
      '<label class="ng-ia-field"><span>Vision model</span><input id="ng-ia-model" class="text_pole" type="text" value="' + escapeAttr(a.model || '') + '" placeholder="Leave blank to use the configured model"><small>Use a vision-capable model exposed by the same OpenAI-compatible proxy. No second API key is needed.</small></label>',
      '<label class="ng-ia-field"><span>What should change or be emphasized?</span><textarea id="ng-ia-instruction" class="text_pole" rows="4" placeholder="Example: keep the outfit, change the background to a moonlit forest">' + escapeHtml(a.instruction || '') + '</textarea></label>',
      '<div class="ng-ia-note"><i class="fa-solid fa-circle-info"></i><span>Pure tags returns one comma-separated line. Native-language prompt returns one polished paragraph. The model is asked to describe visible details without guessing hidden information.</span></div>',
      '<button id="ng-ia-analyze" class="menu_button ng-ia-primary" type="button" disabled><i class="fa-solid fa-wand-magic-sparkles"></i> Analyze image</button></section>',
      '<section class="ng-ia-card ng-ia-result-card"><div class="ng-ia-card-title"><i class="fa-solid fa-file-lines"></i><span><strong>Generated prompt</strong><small>Review it before sending it to your image generator</small></span></div>',
      '<textarea id="ng-ia-output" class="text_pole ng-ia-output" rows="12" readonly placeholder="Your generated tags or native-language prompt will appear here."></textarea>',
      '<div class="ng-ia-result-actions"><button id="ng-ia-copy" class="menu_button" type="button" disabled><i class="fa-solid fa-copy"></i> Copy prompt</button><button id="ng-ia-download" class="menu_button" type="button" disabled><i class="fa-solid fa-download"></i> Download .txt</button></div>',
      '<div id="ng-ia-status" class="ng-ia-status">Choose an image to begin.</div></section>',
      '</main></div>',
    ].join('');
  }
  function bindAnalyzer() {
    const overlay = byId(OVERLAY_ID);
    if (!overlay) return;
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeAnalyzer();
    });
    byId('ng-ia-close')?.addEventListener('click', closeAnalyzer);
    byId('ng-ia-remove')?.addEventListener('click', removeImage);
    byId('ng-ia-analyze')?.addEventListener('click', analyze);
    byId('ng-ia-copy')?.addEventListener('click', copyResult);
    byId('ng-ia-download')?.addEventListener('click', downloadResult);
    byId('ng-ia-file')?.addEventListener('change', async event => {
      await setImageFile(event.currentTarget.files?.[0]);
      event.currentTarget.value = '';
    });

    const drop = byId('ng-ia-drop');
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

    const s = extensionSettings();
    const a = s.imageAnalysis;
    byId('ng-ia-preset')?.addEventListener('change', event => {
      a.preset = event.currentTarget.value;
      saveSettings();
    });
    byId('ng-ia-language')?.addEventListener('change', event => {
      a.language = event.currentTarget.value;
      saveSettings();
    });
    byId('ng-ia-model')?.addEventListener('input', event => {
      a.model = event.currentTarget.value;
      saveSettings();
    });
    byId('ng-ia-instruction')?.addEventListener('input', event => {
      a.instruction = event.currentTarget.value;
      saveSettings();
    });
  }

  function openAnalyzer() {
    if (byId(OVERLAY_ID)) return;
    injectStyles();
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'ng-ia-overlay';
    overlay.innerHTML = analyzerHtml();
    (document.body || document.documentElement).appendChild(overlay);
    document.body?.classList.add('ng-ia-open');
    bindAnalyzer();
    render();
    setStatus(state.image ? 'Image ready. Choose a preset and analyze it.' : 'Choose an image to begin.');
    escapeHandler = event => {
      if (event.key === 'Escape') closeAnalyzer();
    };
    document.addEventListener('keydown', escapeHandler);
  }

  function closeAnalyzer() {
    byId(OVERLAY_ID)?.remove();
    document.body?.classList.remove('ng-ia-open');
    if (escapeHandler) document.removeEventListener('keydown', escapeHandler);
    escapeHandler = null;
  }
  function injectStyles() {
    if (byId('ng-image-analyzer-styles')) return;
    const style = document.createElement('style');
    style.id = 'ng-image-analyzer-styles';
    style.textContent = [
      '#ng-image-analyzer-overlay{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:18px;background:rgba(3,7,14,.78);backdrop-filter:blur(12px);font-family:inherit}',
      '.ng-ia-dialog{width:min(1050px,100%);max-height:min(900px,100%);overflow:hidden;border:1px solid rgba(157,190,226,.28);border-radius:18px;background:linear-gradient(145deg,#101a29,#0a101b 72%);box-shadow:0 24px 90px rgba(0,0,0,.55);color:#edf5ff;display:flex;flex-direction:column}',
      '.ng-ia-header{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 18px;border-bottom:1px solid rgba(157,190,226,.16);background:rgba(22,34,53,.7)}',
      '.ng-ia-title,.ng-ia-card-title{display:flex;align-items:center;gap:11px}.ng-ia-title>i,.ng-ia-card-title>i{color:#82c7ff;font-size:20px}.ng-ia-title span,.ng-ia-card-title span{display:flex;flex-direction:column;gap:2px}.ng-ia-title strong{font-size:17px}.ng-ia-title small,.ng-ia-card-title small{color:#aab8cb;font-size:11px}.ng-ia-close{min-width:36px!important;width:36px;height:36px;padding:0!important}',
      '.ng-ia-main{display:grid;grid-template-columns:minmax(300px,.9fr) minmax(320px,1.1fr);gap:12px;padding:14px;overflow:auto}.ng-ia-card{min-width:0;padding:14px;border:1px solid rgba(157,190,226,.16);border-radius:14px;background:rgba(13,23,37,.74);display:flex;flex-direction:column;gap:12px}.ng-ia-source-card{grid-row:span 2}.ng-ia-card-title{padding-bottom:10px;border-bottom:1px solid rgba(157,190,226,.12)}.ng-ia-card-title strong{font-size:13px}',
      '.ng-ia-drop{min-height:330px;display:grid;place-items:center;overflow:hidden;border:1px dashed rgba(130,199,255,.44);border-radius:12px;background:radial-gradient(circle at 50% 35%,rgba(66,111,160,.22),transparent 60%),#0a111d;transition:.18s}.ng-ia-drop.is-dragging{border-color:#8bd0ff;background-color:rgba(70,140,210,.2)}.ng-ia-drop.has-image{border-style:solid}.ng-ia-drop img{width:100%;height:100%;max-height:470px;object-fit:contain;display:block}.ng-ia-empty{display:flex;flex-direction:column;align-items:center;gap:7px;padding:30px;text-align:center;color:#aab8cb}.ng-ia-empty i{font-size:38px;color:#6faee0}.ng-ia-empty strong{color:#edf5ff;font-size:14px}.ng-ia-empty span{font-size:11px}',
      '.ng-ia-file-row,.ng-ia-result-actions{display:flex;flex-wrap:wrap;gap:8px}.ng-ia-file-button{position:relative;overflow:hidden}.ng-ia-file-button input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}.ng-ia-danger{color:#ffb2b2!important}.ng-ia-file-meta{color:#8f9fb3;font-size:11px;min-height:15px}',
      '.ng-ia-field{display:flex;flex-direction:column;gap:6px}.ng-ia-field>span{font-size:12px;color:#dce9f8}.ng-ia-field small{color:#8f9fb3;font-size:10px;line-height:1.4}.ng-ia-field textarea{resize:vertical;min-height:84px}.ng-ia-note{display:flex;gap:8px;align-items:flex-start;padding:10px;border-radius:9px;background:rgba(81,131,180,.12);color:#aabed4;font-size:11px;line-height:1.45}.ng-ia-note i{color:#82c7ff;margin-top:2px}.ng-ia-primary{justify-content:center;background:linear-gradient(135deg,#327db5,#5f55a9)!important;border-color:rgba(166,221,255,.45)!important;font-weight:700}.ng-ia-output{width:100%;min-height:250px;resize:vertical;line-height:1.55;font-size:12px}.ng-ia-result-actions .menu_button{flex:1}.ng-ia-status{min-height:18px;color:#9eb0c6;font-size:11px;line-height:1.4}.ng-ia-status.is-working{color:#b5dfff}.ng-ia-status.is-ok{color:#8de0ad}.ng-ia-status.is-error{color:#ff9e9e}',
      '@media(max-width:760px){#ng-image-analyzer-overlay{padding:0}.ng-ia-dialog{width:100%;height:100%;max-height:none;border-radius:0;border-left:0;border-right:0}.ng-ia-main{display:flex;flex-direction:column;padding:10px}.ng-ia-source-card{order:0}.ng-ia-options-card{order:1}.ng-ia-result-card{order:2}.ng-ia-drop{min-height:210px;max-height:39vh}.ng-ia-drop img{max-height:39vh}.ng-ia-header{padding:calc(12px + env(safe-area-inset-top)) 12px 12px}.ng-ia-title small{display:none}.ng-ia-card{padding:11px}.ng-ia-output{min-height:190px}.ng-ia-file-row .menu_button{flex:1;justify-content:center}}',
    ].join('\n');
    document.head.appendChild(style);
  }
  function mountWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('ng-wand-image-analyzer')) return Boolean(menu);
    const row = document.createElement('div');
    row.id = 'ng-wand-image-analyzer';
    row.className = 'list-group-item flex-container flexGap5 interactable ng-wand-image-analyzer';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.innerHTML = '<i class="fa-solid fa-camera-retro"></i><span>Image Prompt Analyzer</span>';
    row.addEventListener('click', event => {
      event.stopPropagation();
      openAnalyzer();
    });
    row.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      openAnalyzer();
    });
    const anchor = document.getElementById('ng-wand-studio') || document.getElementById('ng-wand-image');
    if (anchor) anchor.insertAdjacentElement('afterend', row);
    else menu.appendChild(row);
    return true;
  }

  function startMount() {
    if (mountWandButton()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (mountWandButton() || attempts > 120) clearInterval(timer);
    }, 250);
  }

  globalThis.__novelGenerationImageAnalyzerReady = true;
  globalThis.__novelGenerationImageAnalyzerOpen = openAnalyzer;
  startMount();
})();
