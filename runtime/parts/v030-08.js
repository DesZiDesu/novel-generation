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
