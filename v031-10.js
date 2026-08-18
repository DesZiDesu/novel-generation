// Novel Generation v0.3.1: native NovelAI advanced routing.
// Loaded before v030-08.js so these function declarations replace the v0.3
// compatibility shims before the UI binds its handlers.

function ngCanonicalNativeModel(model, action = 'generate') {
  const raw = String(model || 'nai-diffusion-4-5-full');
  const matched = raw.match(/nai-diffusion-[a-z0-9-]+/i)?.[0] || raw.replace(/^\[[^\]]+\]/, '');
  if (action === 'infill' && !/-inpainting$/i.test(matched)) return `${matched}-inpainting`;
  return matched;
}

function ngNativeReferenceFields(state) {
  const fields = {};
  if (state.vibes?.length) {
    fields.reference_image_multiple = state.vibes.map(ref => ref.encodedVibe || imageValue(ref));
    fields.reference_strength_multiple = state.vibes.map(ref => Number(ref.strength));
    fields.reference_information_extracted_multiple = state.vibes.map(ref => Number(ref.information));
  }
  if (state.precise?.length) {
    fields.director_reference_images = state.precise.map(imageValue);
    fields.director_reference_descriptions = state.precise.map(ref => ({
      caption: { base_caption: ref.type || 'character', char_captions: [] },
      legacy_uc: false,
    }));
    fields.director_reference_strength_values = state.precise.map(ref => Number(ref.strength));
    fields.director_reference_secondary_strength_values = state.precise.map(ref => Math.max(0, Math.min(1, 1 - Number(ref.fidelity))));
    fields.director_reference_information_extracted = state.precise.map(() => 1);
  }
  return fields;
}

// Override the older helper so all existing parameter builders automatically
// use encoded V4 vibe vectors when the provider exposes /ai/encode-vibe.
function nativeReferenceFields(state) {
  return ngNativeReferenceFields(state);
}

function ngBuildNativeParameters(state) {
  const params = naiParameters(state);
  Object.assign(params, ngNativeReferenceFields(state));
  return cleanObject(params);
}

function ngBuildNativeEnvelope(state) {
  const action = naiAction(state);
  return cleanObject({
    input: state.prompt.trim(),
    model: ngCanonicalNativeModel(settings().model, action),
    action,
    parameters: ngBuildNativeParameters(state),
  });
}

function ngBuildOpenAiWithNativeParameters(state) {
  return cleanObject({
    ...strictPayload(state),
    input: state.prompt.trim(),
    action: naiAction(state),
    parameters: ngBuildNativeParameters(state),
  });
}

// The pure native envelope is no longer sent through /v1/images/generations.
// The user's proxy explicitly rejects that shape because its wrapper requires a
// top-level `prompt`. Native envelopes are now reserved for a discovered
// /ai/generate-image route.
function requestCandidates(state) {
  const s = settings();
  const strict = strictPayload(state);
  if (s.compatibility === 'strict') {
    if (hasAdvancedReferences(state) || state.source) {
      throw new Error('Strict OpenAI payload mode cannot carry Vibe, Precise Reference, img2img or inpaint fields. Switch Payload mode to Auto / NovelAI-aware.');
    }
    return [{ name: 'strict-openai', payload: strict }];
  }

  const nativeWrapped = ngBuildOpenAiWithNativeParameters(state);
  const generic = cleanObject({
    ...strict,
    ...coreExtendedFields(state),
    ...genericReferenceFields(state),
  });

  if (hasAdvancedReferences(state) || state.source) {
    return [
      { name: 'openai-with-nai-parameters', payload: nativeWrapped },
      { name: 'proxy-generic-aliases', payload: generic },
    ];
  }

  const legacyFlat = cleanObject({ ...strict, ...coreExtendedFields(state) });
  return [
    { name: 'openai-extended-flat', payload: legacyFlat },
    { name: 'openai-with-nai-parameters', payload: nativeWrapped },
    { name: 'strict-openai-fallback', payload: strict },
  ];
}

function ngBytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunk)));
  }
  return btoa(binary);
}

function ngBlobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read image response.'));
    reader.readAsDataURL(blob);
  });
}

async function ngInflateRaw(bytes) {
  if (globalThis.pako?.inflateRaw) return new Uint8Array(globalThis.pako.inflateRaw(bytes));
  if (typeof DecompressionStream === 'function') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error('This Safari build cannot decompress the NovelAI ZIP response. Update iOS/Safari or use the OpenAI wrapper route.');
}

function ngFindZipEocd(view) {
  const minimum = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

async function ngExtractFirstImageFromZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const eocd = ngFindZipEocd(view);
  if (eocd < 0) throw new Error('NovelAI returned ZIP data but the central directory could not be found.');
  const entries = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  let fallback = null;
  const decoder = new TextDecoder();

  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > view.byteLength || view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const entry = { method, compressedSize, localOffset, name };
    if (!fallback) fallback = entry;
    if (/\.(png|jpe?g|webp)$/i.test(name)) {
      fallback = entry;
      break;
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  if (!fallback) throw new Error('NovelAI ZIP response contained no files.');
  const { method, compressedSize, localOffset, name } = fallback;
  if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('NovelAI ZIP local file header is invalid.');
  const localNameLength = view.getUint16(localOffset + 26, true);
  const localExtraLength = view.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
  let imageBytes;
  if (method === 0) imageBytes = compressed;
  else if (method === 8) imageBytes = await ngInflateRaw(compressed);
  else throw new Error(`Unsupported ZIP compression method ${method}.`);

  const mime = /\.jpe?g$/i.test(name) ? 'image/jpeg' : /\.webp$/i.test(name) ? 'image/webp' : 'image/png';
  return ngBlobToDataUrl(new Blob([imageBytes], { type: mime }));
}

async function ngNativeResponseImages(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json') || contentType.includes('text/json')) {
    const data = await response.json();
    return { images: extractImages(data), debug: safePayloadForDebug(data) };
  }
  if (contentType.startsWith('image/')) {
    const blob = await response.blob();
    return { images: [await ngBlobToDataUrl(blob)], debug: { content_type: contentType, bytes: blob.size } };
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (isZip) return { images: [await ngExtractFirstImageFromZip(buffer)], debug: { content_type: contentType || 'application/zip', bytes: bytes.length } };
  if (isPng || isJpeg) {
    const mime = isPng ? 'image/png' : 'image/jpeg';
    return { images: [await ngBlobToDataUrl(new Blob([bytes], { type: mime }))], debug: { content_type: mime, bytes: bytes.length } };
  }

  const text = new TextDecoder().decode(bytes);
  try {
    const data = JSON.parse(text);
    return { images: extractImages(data), debug: safePayloadForDebug(data) };
  } catch {
    throw new Error(`Unrecognized native image response (${contentType || 'unknown content type'}, ${bytes.length} bytes).`);
  }
}

async function ngEncodeVibeReference(ref, signal) {
  if (!ref?.base64 && !ref?.url) throw new Error('Vibe reference image data is missing.');
  const information = Number(ref.information ?? 1);
  if (ref.encodedVibe && ref.encodedVibeInformation === information) return ref.encodedVibe;
  const url = ngProviderCaps.encodeVibeUrl;
  if (!url) throw new Error('The provider did not expose an /ai/encode-vibe route.');
  const payload = {
    image: imageValue(ref),
    model: ngCanonicalNativeModel(settings().model, 'generate').replace(/-inpainting$/i, ''),
    information_extracted: information,
  };
  const started = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const raw = await response.text();
    debugAttempt({ route: 'native-encode-vibe', schema: 'nai-encode-vibe', status: response.status, ms: Math.round(performance.now() - started), payload: safePayloadForDebug(payload), response: raw.slice(0, 700) });
    throw Object.assign(new Error(`Vibe encoding failed: HTTP ${response.status}: ${raw.slice(0, 500) || response.statusText}`), { status: response.status });
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  let encoded = '';
  let responseDebug = {};
  if (contentType.includes('application/json')) {
    const data = await response.json();
    encoded = data?.encoded_vibe || data?.encoded || data?.vibe || data?.base64 || data?.data?.[0]?.b64_json || data?.data?.[0]?.base64 || '';
    responseDebug = safePayloadForDebug(data);
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    encoded = ngBytesToBase64(bytes);
    responseDebug = { content_type: contentType || 'application/octet-stream', bytes: bytes.length };
  }
  if (!encoded) throw new Error('The vibe encoder returned success but no encoded vibe data was found.');
  ref.encodedVibe = encoded;
  ref.encodedVibeInformation = information;
  debugAttempt({ route: 'native-encode-vibe', schema: 'nai-encode-vibe', status: response.status, ms: Math.round(performance.now() - started), payload: { model: payload.model, information_extracted: information, image: `[${String(payload.image).length} chars]` }, response: responseDebug });
  return encoded;
}

async function ngPrepareVibes(state, signal) {
  if (!state.vibes?.length) return;
  if (ngProviderCaps.encodeVibe !== 'supported' || !ngProviderCaps.encodeVibeUrl) return;
  for (const ref of state.vibes) await ngEncodeVibeReference(ref, signal);
}

async function ngPostNativeGeneration(state, signal) {
  const url = ngProviderCaps.nativeGenerateUrl;
  if (!url) throw new Error('The provider did not expose an /ai/generate-image route.');
  const payload = ngBuildNativeEnvelope(state);
  const started = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const raw = await response.text();
    debugAttempt({ route: 'native', schema: 'nai-native-route', status: response.status, ms: Math.round(performance.now() - started), payload: safePayloadForDebug(payload), response: raw.slice(0, 900) });
    throw Object.assign(new Error(`Native NovelAI route failed: HTTP ${response.status}: ${raw.slice(0, 700) || response.statusText}`), { status: response.status });
  }
  const parsed = await ngNativeResponseImages(response);
  debugAttempt({ route: 'native', schema: 'nai-native-route', status: response.status, ms: Math.round(performance.now() - started), payload: safePayloadForDebug(payload), response: parsed.debug, reference_consumption: hasAdvancedReferences(state) ? 'native-route' : 'not-applicable' });
  if (!parsed.images.length) throw Object.assign(new Error('Native NovelAI route returned success but no image could be decoded.'), { status: 200 });
  return { images: parsed.images, data: parsed.debug, schema: 'nai-native-route', route: 'native', referenceVerified: hasAdvancedReferences(state) };
}

// OpenAI-wrapper success no longer fails because `usage.image_tokens` is zero.
// That usage object belongs to the compatibility wrapper and is not a reliable
// signal that NovelAI consumed or ignored Director/Vibe reference fields.
async function postGeneration(route, candidate, state, signal) {
  const path = route === 'chat' ? '/v1/chat/completions' : '/v1/images/generations';
  const body = route === 'chat' ? chatPayloadFrom(candidate.payload, state) : candidate.payload;
  const url = endpoint(path);
  const started = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal,
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  const elapsed = Math.round(performance.now() - started);
  debugAttempt({
    route,
    schema: candidate.name,
    status: response.status,
    ms: elapsed,
    payload: safePayloadForDebug(body),
    response: safePayloadForDebug(data),
    reference_consumption: hasAdvancedReferences(state) ? 'unverified-wrapper' : 'not-applicable',
  });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}: ${raw.slice(0, 700) || response.statusText}`), { status: response.status });
  const images = extractImages(data);
  if (!images.length) throw Object.assign(new Error('Provider returned success but no image URL/base64 was found in the response.'), { status: 200 });
  return { images, data, schema: candidate.name, route, referenceVerified: false };
}

async function generateState(state, label = 'Generating…') {
  const s = settings();
  if (!base()) throw new Error('Set Base URL in the Novel Generation drawer first.');
  if (!apiKey) throw new Error('Enter and test the API key first.');
  if (!s.model) throw new Error('Select a model first.');
  if (!state.prompt?.trim()) throw new Error('Enter a prompt first.');
  if (state.vibes?.length && state.precise?.length) throw new Error('NovelAI V4.5 does not allow Vibe Transfer and Precise Reference at the same time. Remove one reference type.');
  if (state.precise?.length && !/4[-_. ]?5/i.test(String(s.model))) throw new Error('Precise Reference requires a NovelAI V4.5 model.');
  if (state.editMode === 'inpaint' && state.source && !state.mask) updateMaskFromCanvas();
  if (state.editMode === 'inpaint' && state.source && !state.mask) throw new Error('Paint an inpaint mask before generating.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, s.timeoutMs));
  const failures = [];
  try {
    if (!ngProviderCaps.checked) {
      try { await ngProbeAdvancedCapabilities(); } catch (error) { console.debug('[Novel Generation] capability probe before generation failed', error); }
    }

    if (state.vibes?.length && ngProviderCaps.encodeVibe === 'supported') {
      try {
        await ngPrepareVibes(state, controller.signal);
      } catch (error) {
        failures.push(`native/encode-vibe: ${error.message}`);
        // Vibe can still be attempted through the OpenAI wrapper if the proxy
        // has its own internal encoder, so do not stop here unless auth failed.
        if (error.status === 401 || error.status === 403) throw error;
      }
    }

    if ((hasAdvancedReferences(state) || state.source) && ngProviderCaps.nativeGenerate === 'supported' && ngProviderCaps.nativeGenerateUrl) {
      try {
        return await ngPostNativeGeneration(state, controller.signal);
      } catch (error) {
        failures.push(`native/nai-native-route: ${error.message}`);
        if (error.name === 'AbortError') throw error;
        if (error.status === 401 || error.status === 403) throw error;
      }
    }

    const candidates = requestCandidates(state);
    const routes = routeCandidates();
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

  if (hasAdvancedReferences(state)) {
    throw new Error(`Advanced reference generation failed. Open Request Debug and send the newest attempts. Last error: ${failures.at(-1) || 'unknown'}`);
  }
  throw new Error(failures.at(-1) || label);
}
