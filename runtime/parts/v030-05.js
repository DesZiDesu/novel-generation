function normalizeVibes(showToast = true) {
  if (!studio?.vibes?.length) return;
  const total = studio.vibes.reduce((sum, ref) => sum + Math.max(0, Number(ref.strength) || 0), 0);
  if (total > 1) studio.vibes.forEach(ref => { ref.strength = (Number(ref.strength) || 0) / total; });
  renderRefs('vibe');
  if (showToast) toast('success', total > 1 ? 'Vibe strengths normalized to a total of 1.0.' : 'Vibe strengths are already at or below 1.0.');
}

function refreshReferenceLocks() {
  if (!studio) return;
  const vibeInput = document.getElementById('ng-vibe-file');
  const preciseInput = document.getElementById('ng-precise-file');
  if (vibeInput) vibeInput.disabled = studio.precise.length > 0;
  if (preciseInput) preciseInput.disabled = studio.vibes.length > 0;
  const vibeNote = document.getElementById('ng-vibe-lock');
  const preciseNote = document.getElementById('ng-precise-lock');
  if (vibeNote) vibeNote.textContent = studio.precise.length ? 'Disabled while Precise Reference is active.' : 'V4/V4.5 uses native reference_image_multiple arrays when the proxy accepts them.';
  if (preciseNote) preciseNote.textContent = studio.vibes.length ? 'Disabled while Vibe Transfer is active.' : 'V4.5 Director Reference uses Character / Style / Character & Style plus Strength and Fidelity.';
}

function renderRefs(kind) {
  const container = document.getElementById(kind === 'vibe' ? 'ng-vibe-list' : 'ng-precise-list');
  if (!container || !studio) return;
  const list = kind === 'vibe' ? studio.vibes : studio.precise;
  if (!list.length) {
    container.innerHTML = '<p class="ng-muted">No reference images added.</p>';
    refreshReferenceLocks();
    return;
  }
  container.innerHTML = list.map((ref, index) => `<article class="ng-reference-card"><img src="${attr(ref.url)}"><div class="ng-reference-controls"><div class="ng-reference-head"><strong>${esc(ref.name)}</strong><button class="menu_button ng-ref-delete" data-i="${index}" type="button"><i class="fa-solid fa-trash"></i></button></div>${kind === 'precise' ? field('Type', `<select class="text_pole ng-ref-type" data-i="${index}"><option value="character">Character</option><option value="style">Style</option><option value="character&style">Character + Style</option></select>`) : ''}${refRange(index, 'strength', 'Strength', ref.strength)}${kind === 'vibe' ? refRange(index, 'information', 'Information Extracted', ref.information) : refRange(index, 'fidelity', 'Fidelity', ref.fidelity)}</div></article>`).join('');
  container.querySelectorAll('.ng-ref-delete').forEach(btn => btn.addEventListener('click', () => {
    list.splice(+btn.dataset.i, 1);
    renderRefs(kind);
    refreshReferenceLocks();
  }));
  container.querySelectorAll('.ng-ref-type').forEach(select => {
    select.value = list[+select.dataset.i].type;
    select.addEventListener('change', () => { list[+select.dataset.i].type = select.value; });
  });
  container.querySelectorAll('[data-ref-key]').forEach(input => input.addEventListener('input', () => {
    list[+input.dataset.i][input.dataset.refKey] = +input.value;
    const output = input.closest('.ng-range-row')?.querySelector('output');
    if (output) output.textContent = (+input.value).toFixed(2);
  }));
  refreshReferenceLocks();
}

function refRange(index, key, label, value) {
  return `<label class="ng-range-row"><span>${label} <output>${Number(value).toFixed(2)}</output></span><input data-i="${index}" data-ref-key="${key}" type="range" min="0" max="1" step=".01" value="${value}"></label>`;
}

function renderCharacters() {
  const container = document.getElementById('ng-character-list');
  if (!container || !studio) return;
  if (!studio.characters.length) {
    container.innerHTML = '<p class="ng-muted">No separate character prompts yet.</p>';
    return;
  }
  container.innerHTML = studio.characters.map((character, index) => `<div class="ng-character-card"><div class="ng-reference-head"><strong>Character ${index + 1}</strong><button class="menu_button ng-char-delete" data-i="${index}" type="button"><i class="fa-solid fa-trash"></i></button></div>${field('Prompt', `<textarea class="text_pole ng-char-prompt" data-i="${index}" rows="3">${esc(character.prompt)}</textarea>`)}${field('Position', `<select class="text_pole ng-char-pos" data-i="${index}"><option value="auto">Auto</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select>`)}</div>`).join('');
  container.querySelectorAll('.ng-char-delete').forEach(btn => btn.addEventListener('click', () => { studio.characters.splice(+btn.dataset.i, 1); renderCharacters(); }));
  container.querySelectorAll('.ng-char-prompt').forEach(input => input.addEventListener('input', () => { studio.characters[+input.dataset.i].prompt = input.value; }));
  container.querySelectorAll('.ng-char-pos').forEach(select => {
    select.value = studio.characters[+select.dataset.i].position;
    select.addEventListener('change', () => { studio.characters[+select.dataset.i].position = select.value; });
  });
}

function setStudioSource(ref) {
  if (!studio || !ref) return;
  studio.source = ref;
  const sourceCard = document.getElementById('ng-source-card');
  const upscaleCard = document.getElementById('ng-upscale-source');
  const cardHtml = `<img src="${attr(ref.url)}"><span>${esc(ref.name || 'Selected source')}</span>`;
  if (sourceCard) sourceCard.innerHTML = cardHtml;
  if (upscaleCard) upscaleCard.innerHTML = cardHtml;
  refreshMaskEditor();
}

function refreshMaskEditor() {
  const editor = document.getElementById('ng-mask-editor');
  if (!editor || !studio) return;
  const active = studio.editMode === 'inpaint' && studio.source;
  editor.hidden = !active;
  if (!active) return;
  const img = document.getElementById('ng-mask-source');
  if (!img) return;
  img.onload = () => initializeMaskCanvas(img);
  if (img.src !== studio.source.url) img.src = studio.source.url;
  else if (img.complete) initializeMaskCanvas(img);
}

function initializeMaskCanvas(img) {
  const canvas = document.getElementById('ng-mask-canvas');
  if (!canvas || !img.naturalWidth || !img.naturalHeight) return;
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const context = canvas.getContext('2d');
  context.save();
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = '#000000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
  studio.mask = null;
}

function bindMaskTools() {
  const canvas = document.getElementById('ng-mask-canvas');
  if (!canvas || !studio) return;
  document.querySelectorAll('[data-mask-tool]').forEach(button => button.addEventListener('click', () => {
    studio.maskTool = button.dataset.maskTool;
    document.querySelectorAll('[data-mask-tool]').forEach(item => item.classList.toggle('is-active', item === button));
  }));
  document.getElementById('ng-mask-clear')?.addEventListener('click', () => {
    const context = canvas.getContext('2d');
    if (context) { context.save(); context.globalCompositeOperation = 'source-over'; context.fillStyle = '#000000'; context.fillRect(0, 0, canvas.width, canvas.height); context.restore(); }
    studio.mask = null;
  });
  document.getElementById('ng-brush-size')?.addEventListener('input', event => { studio.brushSize = +event.currentTarget.value || 48; });

  let drawing = false;
  let previous = null;
  const position = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
  };
  const draw = event => {
    if (!drawing) return;
    const next = position(event);
    const context = canvas.getContext('2d');
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = Math.max(2, studio.brushSize * (canvas.width / Math.max(1, canvas.getBoundingClientRect().width)));
    context.globalCompositeOperation = 'source-over';
    context.strokeStyle = studio.maskTool === 'eraser' ? '#000000' : '#ffffff';
    context.beginPath();
    context.moveTo(previous?.x ?? next.x, previous?.y ?? next.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    context.restore();
    previous = next;
    event.preventDefault();
  };
  canvas.addEventListener('pointerdown', event => {
    drawing = true;
    previous = position(event);
    canvas.setPointerCapture?.(event.pointerId);
    draw(event);
  });
  canvas.addEventListener('pointermove', draw);
  const stop = event => {
    if (!drawing) return;
    draw(event);
    drawing = false;
    previous = null;
    updateMaskFromCanvas();
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('pointerleave', event => { if (drawing && event.buttons === 0) stop(event); });
}

function updateMaskFromCanvas() {
  const canvas = document.getElementById('ng-mask-canvas');
  if (!canvas || !studio) return;
  try {
    const url = canvas.toDataURL('image/png');
    studio.mask = { id: `mask-${Date.now()}`, name: 'mask.png', url, base64: url.split(',')[1] || '' };
  } catch (error) {
    console.warn('[Novel Generation] Could not export mask', error);
  }
}
