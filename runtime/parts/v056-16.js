// Novel Generation v0.5.6 — Character Prompt routing fix.
var NG_V056_RELEASE = '0.5.6';

function ngV056HasCharacterPrompts(state) {
  return Boolean((state?.characters || []).some(function (item) { return String(item?.prompt || '').trim(); }));
}

// V4/V4.5 character captions use coordinates. The previous Auto mode placed every
// character at the same center point, which caused prompt bleed for multi-character
// scenes. Auto now spreads active characters across the canvas while keeping explicit
// Left / Center / Right choices authoritative.
naiCharacterCaptions = function (state) {
  var items = (state?.characters || []).filter(function (item) { return String(item?.prompt || '').trim(); });
  var total = items.length;
  return items.map(function (item, index) {
    var position = String(item.position || 'auto');
    var center;
    if (position === 'left') center = { x: 0.2, y: 0.5 };
    else if (position === 'center') center = { x: 0.5, y: 0.5 };
    else if (position === 'right') center = { x: 0.8, y: 0.5 };
    else center = { x: total <= 1 ? 0.5 : (index + 1) / (total + 1), y: 0.5 };
    return { char_caption: String(item.prompt || '').trim(), centers: [center] };
  });
};

// Character Prompts are native NovelAI V4/V4.5 structured prompt data. The old
// candidate order sent openai-extended-flat first; because many OpenAI-compatible
// proxies return HTTP 200 while silently ignoring unknown `character_prompts`, the
// extension stopped there and the separate character prompts never reached
// parameters.v4_prompt.caption.char_captions.
var ngV056BaseRequestCandidates = requestCandidates;
requestCandidates = function (state) {
  if (!ngV056HasCharacterPrompts(state)) return ngV056BaseRequestCandidates(state);

  if (settings().compatibility === 'strict') {
    throw new Error('Character Prompts require Payload mode Auto / NovelAI-aware. Strict OpenAI mode cannot carry NovelAI V4/V4.5 character captions.');
  }

  var candidates = ngV056BaseRequestCandidates(state);
  var nested = candidates.find(function (candidate) { return candidate.name === 'openai-with-nai-parameters'; });
  if (!nested?.payload?.parameters?.v4_prompt?.caption?.char_captions?.length) {
    throw new Error('Character Prompts could not be encoded into the NovelAI V4/V4.5 structured prompt payload.');
  }

  // Build a second native envelope from the already-processed nested candidate so
  // v0.5.1 Advanced provider body merges and current parameter wrappers stay intact.
  var nativePayload = cleanObject({
    model: nested.payload.model || settings().model,
    input: nested.payload.input || state.prompt.trim(),
    action: nested.payload.action || naiAction(state),
    parameters: clone(nested.payload.parameters),
  });

  // Do not fall back to the old flat/strict schemas here: a successful image from
  // those schemas can silently ignore Character Prompts, which is worse than an
  // explicit provider error and makes the feature appear broken.
  return [
    { name: 'openai-with-nai-parameters-character-prompts', payload: nested.payload },
    { name: 'nai-native-envelope-character-prompts', payload: nativePayload },
  ];
};

function ngV056SetVersionLabels() {
  document.querySelectorAll('#ng-settings .ng-version').forEach(function (node) { node.textContent = 'v' + NG_V056_RELEASE; });
  document.querySelectorAll('#ng-studio-overlay .ng-studio-title small').forEach(function (node) {
    var current = String(node.textContent || '').replace(/^v\d+(?:\.\d+){1,2}\s*[·-]?\s*/i, '').trim();
    if (!current || /^v\d/i.test(current)) current = studio?.mode ? String(studio.mode) : '';
    node.textContent = 'v' + NG_V056_RELEASE + (current ? ' · ' + current : '');
  });
}

if (typeof ngV055SetVersionLabels === 'function') ngV055SetVersionLabels = ngV056SetVersionLabels;
ngV056SetVersionLabels();
