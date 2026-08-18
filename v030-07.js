function extractImages(data) {
  const out = [];
  const items = Array.isArray(data?.data) ? data.data : Array.isArray(data?.images) ? data.images : [];
  for (const item of items) {
    if (typeof item === 'string') out.push(norm(item));
    else if (item?.b64_json) out.push(`data:image/png;base64,${item.b64_json}`);
    else if (item?.base64) out.push(norm(item.base64));
    else if (item?.url) out.push(norm(item.url));
    else if (item?.image_url?.url) out.push(norm(item.image_url.url));
  }
  if (!out.length && data?.url) out.push(norm(data.url));
  if (!out.length && data?.b64_json) out.push(`data:image/png;base64,${data.b64_json}`);
  const message = data?.choices?.[0]?.message;
  const content = message?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.image_url?.url) out.push(norm(part.image_url.url));
      if (part?.b64_json) out.push(`data:image/png;base64,${part.b64_json}`);
    }
  }
  if (message?.images && Array.isArray(message.images)) {
    for (const image of message.images) out.push(norm(image?.image_url?.url || image?.url || image?.b64_json || ''));
  }
  return [...new Set(out.filter(Boolean))];
}

function norm(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^(data:image\/|https?:\/\/|blob:|\/)/i.test(text)) return text;
  return text.length > 200 ? `data:image/png;base64,${text.replace(/\s+/g, '')}` : text;
}

function rememberImages(images, state, extra = {}) {
  if (!settings().roleplay.gallery) return;
  images.forEach(src => gallery.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    src,
    prompt: state.prompt,
    negative: state.negative,
    model: settings().model,
    width: state.width,
    height: state.height,
    seed: state.seed,
    createdAt: new Date().toISOString(),
    ...extra,
  }));
  gallery.splice(40);
  const count = document.getElementById('ng-gallery-count');
  if (count) count.textContent = gallery.length;
}

async function generateStudio() {
  const button = document.getElementById('ng-generate');
  const out = document.getElementById('ng-gen-status');
  button?.setAttribute('disabled', 'disabled');
  if (out) out.textContent = 'Generating…';
  try {
    const result = await generateState(studio);
    studio.generated = result.images;
    showImages(result.images);
    rememberImages(result.images, studio, { schema: result.schema, route: result.route });
    if (out) out.textContent = `Generated ${result.images.length} image${result.images.length === 1 ? '' : 's'} using ${result.schema}.`;
  } catch (error) {
    if (out) out.textContent = `Generation failed: ${error.message}`;
    toast('error', error.message);
  } finally {
    button?.removeAttribute('disabled');
  }
}

async function quickGenerate(mode, manualPrompt = '') {
  const state = newStudio(mode, 'prompt');
  if (manualPrompt) state.prompt = manualPrompt;
  state.n = settings().image.n;
  toast('info', `Generating ${mode === 'last' ? 'the current scene' : mode}…`);
  try {
    const result = await generateState(state);
    rememberImages(result.images, state, { schema: result.schema, route: result.route, quick: true });
    if (settings().roleplay.autoInsert) await insertImagesIntoChat(result.images, state.prompt);
    toast('success', settings().roleplay.autoInsert ? `Generated ${result.images.length} image${result.images.length === 1 ? '' : 's'} and inserted into chat.` : `Generated ${result.images.length} image${result.images.length === 1 ? '' : 's'}.`);
  } catch (error) {
    toast('error', error.message);
  }
}

async function uploadDataImage(src) {
  if (!src.startsWith('data:image/')) return src;
  const c = ctx();
  const [, meta = '', data = ''] = src.match(/^data:([^;]+);base64,(.*)$/) || [];
  if (!data) return src;
  const extension = /jpeg/i.test(meta) ? 'jpg' : /webp/i.test(meta) ? 'webp' : 'png';
  const response = await fetch('/api/files/upload', {
    method: 'POST',
    headers: c.getRequestHeaders?.() || { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `novel-generation-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`, data }),
  });
  if (!response.ok) throw new Error(`Could not save generated image to SillyTavern media storage: HTTP ${response.status}`);
  const body = await response.json();
  return body.path || body.url || src;
}

function findChatTarget(target) {
  const chat = ctx().chat || [];
  if (!chat.length) return -1;
  if (target === 'latest') return chat.length - 1;
  const wantUser = target === 'user';
  for (let index = chat.length - 1; index >= 0; index--) {
    const message = chat[index];
    if (!message || message.is_system) continue;
    if (Boolean(message.is_user) === wantUser) return index;
  }
  return chat.length - 1;
}

async function insertImagesIntoChat(images, promptText = '') {
  const c = ctx();
  const messageId = findChatTarget(settings().autoInsertTarget);
  if (messageId < 0) throw new Error('There is no roleplay message to attach the generated image to yet.');
  const message = c.chat[messageId];
  message.extra ??= {};
  if (!Array.isArray(message.extra.media)) message.extra.media = [];
  for (let index = 0; index < images.length; index++) {
    const url = await uploadDataImage(images[index]);
    message.extra.media.push({ url, type: 'image', title: `Novel Generation${images.length > 1 ? ` ${index + 1}` : ''}`, source: 'generation', prompt: promptText });
  }
  message.extra.media_index = message.extra.media.length - 1;
  message.extra.inline_image = true;
  await c.saveChat?.();
  try { c.updateMessageBlock?.(messageId, message); } catch (error) { console.debug('[Novel Generation] updateMessageBlock fallback', error); }
  try {
    const block = globalThis.$?.(`.mes[mesid="${messageId}"]`);
    if (block?.length) c.appendMediaToMessage?.(message, block);
  } catch (error) {
    console.debug('[Novel Generation] appendMediaToMessage fallback', error);
  }
  c.scrollChatToBottom?.();
}

function generatedActions(src, index) {
  return `<div class="ng-generated-actions"><a class="menu_button" href="${attr(src)}" download="novel-generation-${Date.now()}-${index + 1}.png"><i class="fa-solid fa-download"></i> Save</a><button class="menu_button ng-use-source" data-src-index="${index}" type="button"><i class="fa-solid fa-image"></i> Use as source</button><button class="menu_button ng-use-inpaint" data-src-index="${index}" type="button"><i class="fa-solid fa-paintbrush"></i> Inpaint</button><button class="menu_button ng-use-vibe" data-src-index="${index}" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Vibe</button><button class="menu_button ng-use-precise" data-src-index="${index}" type="button"><i class="fa-solid fa-id-card-clip"></i> Precise</button></div>`;
}

function showImages(images) {
  const preview = document.getElementById('ng-preview');
  if (!preview) return;
  studio.generated = images;
  preview.innerHTML = `<div class="ng-generated-grid">${images.map((src, index) => `<figure class="ng-generated-card"><img src="${attr(src)}"><figcaption>${generatedActions(src, index)}</figcaption></figure>`).join('')}</div>`;
  bindGeneratedActions(preview, images);
}

function bindGeneratedActions(root, images) {
  root.querySelectorAll('.ng-use-source').forEach(button => button.addEventListener('click', async () => {
    const ref = await refFromSrc(images[+button.dataset.srcIndex], 'generated-source.png');
    if (ref) setStudioSource(ref);
    openStudioSection('edit');
  }));
  root.querySelectorAll('.ng-use-inpaint').forEach(button => button.addEventListener('click', async () => {
    const ref = await refFromSrc(images[+button.dataset.srcIndex], 'generated-inpaint.png');
    if (!ref) return;
    setStudioSource(ref);
    studio.editMode = 'inpaint';
    const select = document.getElementById('ng-edit-mode');
    if (select) select.value = 'inpaint';
    openStudioSection('edit');
    refreshMaskEditor();
  }));
  root.querySelectorAll('.ng-use-vibe').forEach(button => button.addEventListener('click', async () => {
    if (studio.precise.length) return toast('warning', 'Remove Precise Reference before using Vibe Transfer.');
    const ref = await refFromSrc(images[+button.dataset.srcIndex], 'generated-vibe.png');
    if (!ref) return;
    studio.vibes.push({ ...ref, strength: 0.6, information: 1 });
    normalizeVibes(false);
    renderRefs('vibe');
    openStudioSection('vibe');
  }));
  root.querySelectorAll('.ng-use-precise').forEach(button => button.addEventListener('click', async () => {
    if (studio.vibes.length) return toast('warning', 'Remove Vibe Transfer before using Precise Reference.');
    const ref = await refFromSrc(images[+button.dataset.srcIndex], 'generated-precise.png');
    if (!ref) return;
    studio.precise.push({ ...ref, type: 'character', strength: 1, fidelity: 1 });
    renderRefs('precise');
    openStudioSection('precise');
  }));
}
