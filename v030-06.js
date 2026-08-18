function hasAdvancedReferences(state) {
  return Boolean(state.vibes?.length || state.precise?.length);
}

function imageValue(ref) {
  return ref?.base64 || ref?.url || '';
}

function nativeReferenceFields(state) {
  const fields = {};
  if (state.vibes?.length) {
    fields.reference_image_multiple = state.vibes.map(imageValue);
    fields.reference_strength_multiple = state.vibes.map(ref => Number(ref.strength));
    fields.reference_information_extracted_multiple = state.vibes.map(ref => Number(ref.information));
    fields.normalize_reference_strength_multiple = Boolean(state.normalizeVibes);
  }
  if (state.precise?.length) {
    fields.director_reference_images = state.precise.map(imageValue);
    fields.director_reference_descriptions = state.precise.map(ref => ({ caption: { base_caption: ref.type || 'character', char_captions: [] }, legacy_uc: false }));
    fields.director_reference_strength_values = state.precise.map(ref => Number(ref.strength));
    fields.director_reference_secondary_strength_values = state.precise.map(ref => Math.max(0, Math.min(1, 1 - Number(ref.fidelity))));
    fields.director_reference_information_extracted = state.precise.map(() => 1);
  }
  return fields;
}

function genericReferenceFields(state) {
  const fields = {};
  if (state.vibes?.length) fields.vibe_transfer = state.vibes.map(ref => ({ image: imageValue(ref), strength: Number(ref.strength), information_extracted: Number(ref.information) }));
  if (state.precise?.length) fields.precise_reference = state.precise.map(ref => ({ image: imageValue(ref), type: ref.type || 'character', strength: Number(ref.strength), fidelity: Number(ref.fidelity) }));
  return fields;
}

function strictPayload(state) {
  const s = settings();
  return {
    model: s.model,
    prompt: state.prompt.trim(),
    n: Math.max(1, Math.min(4, +state.n || 1)),
    size: `${Math.round(state.width)}x${Math.round(state.height)}`,
    response_format: s.responseFormat,
  };
}

function coreExtendedFields(state) {
  const fields = {
    negative_prompt: state.negative?.trim() || undefined,
    width: Math.round(state.width),
    height: Math.round(state.height),
    steps: Math.round(state.steps),
    guidance: Number(state.guidance),
    scale: Number(state.guidance),
    cfg_scale: Number(state.guidance),
    sampler: state.sampler,
    scheduler: state.scheduler,
    noise_schedule: state.scheduler === 'native' ? undefined : state.scheduler,
    seed: Number(state.seed),
  };
  if (state.characters?.some(item => item.prompt?.trim())) fields.character_prompts = state.characters.filter(item => item.prompt?.trim()).map(item => ({ prompt: item.prompt.trim(), position: item.position || 'auto' }));
  if (state.source) {
    fields.action = state.editMode === 'inpaint' ? 'infill' : 'img2img';
    fields.image = imageValue(state.source);
    fields.strength = Number(state.strength);
    fields.noise = Number(state.noise);
    fields.add_original_image = true;
  }
  if (state.editMode === 'inpaint' && state.mask) fields.mask = imageValue(state.mask);
  return cleanObject(fields);
}

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

function requestCandidates(state) {
  const s = settings();
  const strict = strictPayload(state);
  if (s.compatibility === 'strict') {
    if (hasAdvancedReferences(state) || state.source) throw new Error('Strict OpenAI payload mode cannot carry Vibe, Precise Reference, img2img or inpaint fields. Switch Payload mode to Auto / NovelAI-aware.');
    return [{ name: 'strict-openai', payload: strict }];
  }

  const core = coreExtendedFields(state);
  const nativeRefs = nativeReferenceFields(state);
  const genericRefs = genericReferenceFields(state);
  const nativeFlat = cleanObject({ ...strict, ...core, ...nativeRefs });
  const naiParameters = cleanObject({
    ...strict,
    input: state.prompt.trim(),
    action: state.editMode === 'inpaint' && state.source ? 'infill' : state.source ? 'img2img' : 'generate',
    parameters: {
      width: Math.round(state.width),
      height: Math.round(state.height),
      scale: Number(state.guidance),
      steps: Math.round(state.steps),
      sampler: state.sampler,
      noise_schedule: state.scheduler === 'native' ? undefined : state.scheduler,
      seed: Number(state.seed),
      negative_prompt: state.negative?.trim() || undefined,
      image: state.source ? imageValue(state.source) : undefined,
      mask: state.editMode === 'inpaint' && state.mask ? imageValue(state.mask) : undefined,
      strength: state.source ? Number(state.strength) : undefined,
      noise: state.source ? Number(state.noise) : undefined,
      add_original_image: state.source ? true : undefined,
      ...nativeRefs,
    },
  });
  const generic = cleanObject({ ...strict, ...core, ...genericRefs });

  const list = [
    { name: 'nai-native-flat', payload: nativeFlat },
    { name: 'nai-native-parameters', payload: naiParameters },
    { name: 'proxy-generic-aliases', payload: generic },
  ];
  if (!hasAdvancedReferences(state) && !state.source) list.push({ name: 'strict-openai-fallback', payload: strict });
  return list;
}

function routeCandidates() {
  const mode = settings().routeMode;
  if (mode === 'images') return ['images'];
  if (mode === 'chat') return ['chat'];
  return ['images', 'chat'];
}

function chatPayloadFrom(payload, state) {
  return {
    model: payload.model,
    messages: [{ role: 'user', content: state.prompt.trim() }],
    modalities: ['text', 'image'],
    image_generation: payload,
  };
}

function debugAttempt(entry) {
  debugLog.unshift({ time: new Date().toISOString(), ...entry });
  debugLog.splice(40);
  renderDebug();
}

function safePayloadForDebug(payload) {
  const replacer = (_key, value) => typeof value === 'string' && value.length > 500 ? `${value.slice(0, 80)}…[${value.length} chars]` : value;
  return JSON.parse(JSON.stringify(payload, replacer));
}

function renderDebug() {
  const output = document.getElementById('ng-debug-output');
  if (!output) return;
  output.textContent = debugLog.length ? JSON.stringify(debugLog, null, 2) : 'No requests yet.';
}

async function postGeneration(route, candidate, state, signal) {
  const path = route === 'chat' ? '/v1/chat/completions' : '/v1/images/generations';
  const body = route === 'chat' ? chatPayloadFrom(candidate.payload, state) : candidate.payload;
  const url = endpoint(path);
  const started = performance.now();
  const response = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  debugAttempt({ route, schema: candidate.name, status: response.status, ms: Math.round(performance.now() - started), payload: safePayloadForDebug(body), response: safePayloadForDebug(data) });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}: ${raw.slice(0, 700) || response.statusText}`), { status: response.status });
  const images = extractImages(data);
  if (!images.length) throw Object.assign(new Error('Provider returned success but no image URL/base64 was found in the response.'), { status: 200 });
  return { images, data, schema: candidate.name, route };
}

async function generateState(state, label = 'Generating…') {
  const s = settings();
  if (!base()) throw new Error('Set Base URL in the Novel Generation drawer first.');
  if (!apiKey) throw new Error('Enter and test the API key first.');
  if (!s.model) throw new Error('Select a model first.');
  if (!state.prompt?.trim()) throw new Error('Enter a prompt first.');
  if (state.vibes?.length && state.precise?.length) throw new Error('NovelAI V4.5 does not allow Vibe Transfer and Precise Reference at the same time. Remove one reference type.');
  if (state.editMode === 'inpaint' && state.source && !state.mask) updateMaskFromCanvas();
  if (state.editMode === 'inpaint' && state.source && !state.mask) throw new Error('Paint an inpaint mask before generating.');

  const candidates = requestCandidates(state);
  const routes = routeCandidates();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, s.timeoutMs));
  const failures = [];
  try {
    for (const route of routes) {
      if (route === 'chat' && (hasAdvancedReferences(state) || state.source)) continue;
      for (const candidate of candidates) {
        try {
          return await postGeneration(route, candidate, state, controller.signal);
        } catch (error) {
          failures.push(`${route}/${candidate.name}: ${error.message}`);
          if (error.name === 'AbortError') throw error;
          if (error.status === 401 || error.status === 403) throw error;
          if (error.status === 200) continue;
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (hasAdvancedReferences(state)) throw new Error(`The proxy rejected or failed all Vibe/Precise schemas. Open Request Debug for the exact attempts. Last error: ${failures.at(-1) || 'unknown'}`);
  throw new Error(failures.at(-1) || label);
}
