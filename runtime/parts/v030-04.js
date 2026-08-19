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

function openStudio(mode = 'free', focus = 'prompt') {
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
    if (target) {
      target.open = true;
      setTimeout(() => target.scrollIntoView({ block: 'nearest' }), 30);
    }
  }
  escapeHandler = event => { if (event.key === 'Escape') closeStudio(); };
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
  document.getElementById('ng-studio-overlay')?.addEventListener('pointerdown', event => event.stopPropagation());
  document.querySelectorAll('#ng-studio-overlay [data-tab]').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
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
    document.getElementById(id)?.addEventListener('input', event => { studio[key] = +event.currentTarget.value; });
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
