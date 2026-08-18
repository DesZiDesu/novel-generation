// Novel Generation v0.4.0: Prompt Assistant, chat-context generation, Danbooru artist browser.
const NG_V040_RELEASE = '0.4.0';
const NG_V040_DANBOORU = 'https://danbooru.donmai.us';
const ngV040ArtistCache = new Map();
let ngV040ArtistDebounce = null;

const NG_V040_TAGS = {
  quality: [
    'masterpiece', 'very aesthetic', 'best quality', 'amazing quality',
    'great quality', 'location', 'no text', 'absurdres',
  ],
  actions: [
    'source#hug', 'target#hug', 'mutual#hug',
    'source#kiss', 'target#kiss', 'mutual#kiss',
    'source#holding hands', 'target#holding hands', 'mutual#holding hands',
    'source#pointing at another', 'target#pointing at another',
  ],
  weighting: [
    '{tag}', '[tag]', '1.2::tag ::', '1.5::tag ::',
    '0.8::tag ::', '0.5::tag ::', '-1::tag ::',
  ],
  negative: [
    'lowres', 'artistic error', 'bad anatomy', 'bad hands', 'extra digits',
    'missing fingers', 'jpeg artifacts', 'watermark', 'logo', 'text',
    'multiple views', 'very displeasing', 'worst quality', 'bad quality',
  ],
  medium: [
    'traditional media', 'faux traditional media', 'mixed media',
    'watercolor (medium)', 'oil painting (medium)', 'ink (medium)',
    'colored pencil (medium)', 'anime screencap', 'pixel art',
    'painterly', 'sketch', 'lineart', 'no lineart',
    'anime coloring', 'pastel colors', 'muted color', 'monochrome',
    'greyscale', 'high contrast', 'backlighting', 'bloom', 'bokeh',
    'depth of field', 'lens flare', 'motion blur', 'soft focus',
  ],
  camera: [
    'portrait', 'close-up', 'upper body', 'cowboy shot', 'full body',
    'wide shot', 'pov', 'perspective', 'dutch angle', 'fisheye',
    'from above', 'from below', 'from behind', 'dynamic angle',
    'rim lighting', 'dramatic lighting', 'golden hour', 'volumetric lighting',
  ],
  character: [
    'solo', 'looking at viewer', 'looking away', 'smile', 'blush',
    'open mouth', 'windblown hair', 'school uniform', 'casual clothes',
    'dress', 'armor', 'swimsuit', 'alternate costume', 'official alternate costume',
  ],
  rating: [
    'rating:general', 'rating:sensitive', 'rating:questionable', 'rating:explicit',
  ],
};

const NG_V040_PRESETS = {
  portrait: ['portrait', 'solo', 'upper body', 'looking at viewer', 'detailed face', 'depth of field'],
  selfie: ['selfie', 'looking at viewer', 'close-up', 'arm extended', 'candid', 'natural lighting'],
  manga: ['manga', 'monochrome', 'screentone', 'dramatic composition', 'dynamic angle'],
  scenery: ['background dataset', 'scenery', 'wide shot', 'atmospheric perspective', 'detailed background'],
  romantic: ['romantic atmosphere', 'soft lighting', 'blush', 'warm colors', 'depth of field'],
  action: ['dynamic pose', 'action scene', 'motion blur', 'dramatic lighting', 'dynamic angle'],
};

function ngV040Prefs() {
  const s = settings();
  s.promptAssistant ??= {};
  const p = s.promptAssistant;
  if (!('quickPreview' in p)) p.quickPreview = true;
  if (!('contextMessages' in p)) p.contextMessages = 4;
  if (!('autoQuality' in p)) p.autoQuality = true;
  if (!('useArtistsQuick' in p)) p.useArtistsQuick = true;
  if (!Array.isArray(p.selectedArtists)) p.selectedArtists = [];
  if (!Array.isArray(p.presets)) p.presets = [];
  return p;
}

function ngV040NormalizeTag(tag) {
  return String(tag || '').trim().replace(/\s+/g, ' ');
}

function ngV040PromptParts(text) {
  return String(text || '')
    .split(',')
    .map(ngV040NormalizeTag)
    .filter(Boolean);
}

function ngV040AppendTags(text, tags) {
  const existing = ngV040PromptParts(text);
  const seen = new Set(existing.map(item => item.toLowerCase()));
  for (const raw of tags || []) {
    const tag = ngV040NormalizeTag(raw);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    existing.push(tag);
    seen.add(tag.toLowerCase());
  }
  return existing.join(', ');
}

function ngV040ModelQualityTags() {
  const model = String(settings().model || '').toLowerCase();
  if (/4[-_. ]?5/.test(model) && /curated/.test(model)) {
    return ['location', 'masterpiece', 'no text', '-0.8::feet ::', 'rating:general'];
  }
  if (/4[-_. ]?5/.test(model)) return ['location', 'very aesthetic', 'masterpiece', 'no text'];
  if (/4/.test(model) && /curated/.test(model)) return ['rating:general', 'amazing quality', 'very aesthetic', 'absurdres'];
  if (/4/.test(model)) return ['no text', 'best quality', 'very aesthetic', 'absurdres'];
  return ['best quality', 'amazing quality', 'very aesthetic'];
}

function ngV040RecentContext(limit = ngV040Prefs().contextMessages) {
  let chat = [];
  try { chat = Array.isArray(ctx().chat) ? ctx().chat : []; } catch { return ''; }
  const character = characterData();
  const user = personaName();
  return chat
    .filter(message => message && !message.is_system && message.mes)
    .slice(-Math.max(1, Math.min(10, Number(limit) || 4)))
    .map(message => {
      const speaker = message.is_user ? user : (character.name || 'Character');
      return `${speaker}: ${stripMarkup(message.mes).slice(0, 900)}`;
    })
    .filter(line => line.length > 2)
    .join('\n')
    .slice(0, 4200);
}

function ngV040ContextPrompt(mode) {
  const s = settings();
  const char = characterData();
  const scene = ngV040RecentContext();
  const appearance = s.roleplay.character && char.description
    ? `Character appearance: ${char.description.slice(0, 1600)}.`
    : '';
  const user = s.roleplay.persona ? personaName() : 'the user';

  if (mode === 'portrait') {
    return `portrait of ${char.name || 'the active character'}, solo, detailed character illustration. ${appearance} Current roleplay context: ${scene}`.trim();
  }
  if (mode === 'selfie') {
    return `${char.name || 'the active character'} taking a selfie, candid close framing, natural pose. ${appearance} Current roleplay scene: ${scene}`.trim();
  }
  if (mode === 'user') {
    return `portrait of ${user}, detailed character illustration. Current roleplay context: ${scene}`.trim();
  }
  if (mode === 'last') {
    return `Illustrate the current roleplay scene faithfully. Preserve the visible actions, expressions, clothing, environment, time of day, camera-relevant details, and character relationships described in the chat. ${appearance} Scene context:\n${scene}`.trim();
  }
  if (mode === 'manga') {
    return `manga panel, cinematic storytelling, dynamic composition. Preserve the current roleplay action and character details. ${appearance} Scene context:\n${scene}`.trim();
  }
  return scene ? `Scene context:\n${scene}` : '';
}

function ngV040ArtistPromptTags() {
  return ngV040Prefs().selectedArtists.map(item => {
    const name = String(item?.name || '').replace(/_/g, ' ').trim();
    if (!name) return '';
    const weight = Math.max(-3, Math.min(3, Number(item.weight ?? 1)));
    return Math.abs(weight - 1) < 0.001 ? name : `${weight}::${name} ::`;
  }).filter(Boolean);
}

function ngV040BuildQuickPrompt(mode, manualPrompt = '') {
  let prompt = manualPrompt?.trim() || ngV040ContextPrompt(mode);
  const prefs = ngV040Prefs();
  if (prefs.useArtistsQuick) prompt = ngV040AppendTags(prompt, ngV040ArtistPromptTags());
  if (prefs.autoQuality) prompt = ngV040AppendTags(prompt, ngV040ModelQualityTags());
  return prompt;
}

function ngV040SuggestTags(promptText) {
  const text = String(promptText || '').toLowerCase();
  const suggestions = new Set();
  const add = (...tags) => tags.forEach(tag => suggestions.add(tag));

  if (/(portrait|face|headshot|close[- ]?up)/.test(text)) add('upper body', 'looking at viewer', 'detailed face', 'depth of field');
  if (/(selfie)/.test(text)) add('selfie', 'looking at viewer', 'arm extended', 'candid');
  if (/(manga|comic|panel)/.test(text)) add('monochrome', 'screentone', 'dramatic composition', 'dynamic angle');
  if (/(fight|battle|combat|attack|sword|running|chase|action)/.test(text)) add('dynamic pose', 'motion blur', 'dramatic lighting', 'dynamic angle');
  if (/(night|midnight|dark street)/.test(text)) add('night', 'moonlight', 'rim lighting');
  if (/(rain|storm)/.test(text)) add('rain', 'wet', 'reflections', 'dramatic lighting');
  if (/(sunset|dusk)/.test(text)) add('sunset', 'golden hour', 'warm lighting');
  if (/(forest|woods)/.test(text)) add('forest', 'dappled sunlight', 'atmospheric perspective');
  if (/(beach|ocean|sea)/.test(text)) add('beach', 'ocean', 'sunlight', 'windblown hair');
  if (/(school|classroom)/.test(text)) add('school uniform', 'classroom', 'daylight');
  if (/(romance|romantic|kiss|date|love)/.test(text)) add('romantic atmosphere', 'soft lighting', 'blush', 'depth of field');
  if (/(city|street|urban)/.test(text)) add('cityscape', 'street', 'detailed background');
  if (/(indoors|room|bedroom|kitchen|office)/.test(text)) add('indoors', 'ambient lighting');
  if (/(outdoors|field|mountain|park)/.test(text)) add('outdoors', 'atmospheric perspective');
  if (/(wind|blowing)/.test(text)) add('wind', 'windblown hair', 'dynamic clothes');

  for (const tag of ngV040ModelQualityTags()) suggestions.add(tag);
  return [...suggestions].slice(0, 24);
}

function ngV040InsertText(target, value) {
  if (!studio) return;
  const key = target === 'negative' ? 'negative' : 'prompt';
  studio[key] = ngV040AppendTags(studio[key], [value]);
  const textarea = document.getElementById(key === 'negative' ? 'ng-negative' : 'ng-prompt');
  if (textarea) {
    textarea.value = studio[key];
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function ngV040ApplyPreset(name) {
  const tags = NG_V040_PRESETS[name];
  if (!tags) return;
  if (!studio) return;
  studio.prompt = ngV040AppendTags(studio.prompt, tags);
  const textarea = document.getElementById('ng-prompt');
  if (textarea) {
    textarea.value = studio.prompt;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function ngV040SavePreset() {
  if (!studio?.prompt?.trim()) return toast('warning', 'Write a prompt before saving a preset.');
  const name = window.prompt('Preset name:');
  if (!name?.trim()) return;
  const prefs = ngV040Prefs();
  const existing = prefs.presets.find(item => item.name.toLowerCase() === name.trim().toLowerCase());
  const snapshot = { name: name.trim(), prompt: studio.prompt, negative: studio.negative || '' };
  if (existing) Object.assign(existing, snapshot);
  else prefs.presets.push(snapshot);
  prefs.presets.splice(20);
  save();
  ngV040RenderCustomPresets();
}

function ngV040RenderCustomPresets() {
  const root = document.getElementById('ng-v040-custom-presets');
  if (!root) return;
  const presets = ngV040Prefs().presets;
  root.innerHTML = presets.length
    ? presets.map((item, index) => `<div class="ng-v040-preset-row"><button class="menu_button ng-v040-load-preset" data-index="${index}" type="button">${esc(item.name)}</button><button class="menu_button ng-v040-delete-preset" data-index="${index}" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button></div>`).join('')
    : '<small class="ng-help">No custom presets saved yet.</small>';
  root.querySelectorAll('.ng-v040-load-preset').forEach(button => button.addEventListener('click', () => {
    const item = ngV040Prefs().presets[+button.dataset.index];
    if (!item || !studio) return;
    studio.prompt = item.prompt || '';
    studio.negative = item.negative || '';
    const prompt = document.getElementById('ng-prompt');
    const negative = document.getElementById('ng-negative');
    if (prompt) prompt.value = studio.prompt;
    if (negative) negative.value = studio.negative;
  }));
  root.querySelectorAll('.ng-v040-delete-preset').forEach(button => button.addEventListener('click', () => {
    ngV040Prefs().presets.splice(+button.dataset.index, 1);
    save();
    ngV040RenderCustomPresets();
  }));
}

function ngV040TagButtons(tags, target = 'prompt') {
  return `<div class="ng-v040-tag-grid">${tags.map(tag => `<button class="menu_button ng-v040-tag" type="button" data-target="${target}" data-tag="${attr(tag)}">${esc(tag)}</button>`).join('')}</div>`;
}

function ngV040AssistantHtml() {
  const prefs = ngV040Prefs();
  return `<details id="ng-v040-assistant" class="ng-studio-section ng-v040-assistant" data-focus="assistant">
    <summary><i class="fa-solid fa-book-open"></i><span>NovelAI Cheatsheet & Prompt Assistant</span><i class="fa-solid fa-chevron-down"></i></summary>
    <div class="ng-studio-section-body">
      <div class="ng-v040-toolbar">
        <select id="ng-v040-insert-target" class="text_pole"><option value="prompt">Insert into Prompt</option><option value="negative">Insert into Undesired Content</option></select>
        <button id="ng-v040-suggest" class="menu_button" type="button"><i class="fa-solid fa-lightbulb"></i> Suggest Tags</button>
        <button id="ng-v040-context" class="menu_button" type="button"><i class="fa-solid fa-comments"></i> Add Chat Context</button>
        <button id="ng-v040-export-md" class="menu_button" type="button"><i class="fa-solid fa-file-arrow-down"></i> Save all as .md</button>
      </div>

      <details class="ng-v040-cheat" open><summary><i class="fa-solid fa-palette"></i> Artist / Style tags</summary>
        <p class="ng-muted">Search the Danbooru artist tag catalog. Results are loaded lazily; the full catalog is not downloaded at startup.</p>
        <div class="ng-v040-search-row"><input id="ng-v040-artist-search" class="text_pole" type="search" placeholder="Search Danbooru artist tags…"><button id="ng-v040-artist-clear" class="menu_button" type="button">Clear</button></div>
        <div id="ng-v040-artist-results" class="ng-v040-search-results"></div>
        <div class="ng-v040-subhead">Selected artists / style mix</div>
        <div id="ng-v040-selected-artists" class="ng-v040-selected-artists"></div>
        <button id="ng-v040-apply-artists" class="menu_button" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Apply style mix to prompt</button>
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-people-arrows"></i> source# / target# / mutual#</summary>
        <p class="ng-muted">Use action-role prefixes in multi-character prompts to indicate who performs, receives, or mutually performs an action.</p>${ngV040TagButtons(NG_V040_TAGS.actions)}
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-scale-balanced"></i> Density / tag weighting</summary>
        <p class="ng-muted">V4+ supports numerical emphasis. Curly braces strengthen; square brackets weaken. Edit the placeholder “tag” after insertion.</p>${ngV040TagButtons(NG_V040_TAGS.weighting)}
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-star"></i> Quality / Aesthetic / Special tags</summary>
        ${ngV040TagButtons(NG_V040_TAGS.quality)}
        <div class="ng-v040-subhead">Model-aware quality set</div>
        <button id="ng-v040-quality-model" class="menu_button" type="button">Apply recommended quality tags for selected model</button>
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-ban"></i> Undesired Content (negative)</summary>
        ${ngV040TagButtons(NG_V040_TAGS.negative, 'negative')}
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-brush"></i> Medium / Art style / Coloring / FX</summary>
        ${ngV040TagButtons(NG_V040_TAGS.medium)}
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-camera"></i> Camera / Frame / Lighting</summary>
        ${ngV040TagButtons(NG_V040_TAGS.camera)}
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-shirt"></i> Character / Costume variant tags</summary>
        ${ngV040TagButtons(NG_V040_TAGS.character)}
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-triangle-exclamation"></i> NSFW / rating tags (18+)</summary>
        <p class="ng-muted">Rating tags are provided as prompt controls. Use only where appropriate for your own generation workflow.</p>${ngV040TagButtons(NG_V040_TAGS.rating)}
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-sliders"></i> Recommended values + Anlas notes</summary>
        <div class="ng-v040-info-grid">
          <div><strong>Steps</strong><span>Start around 28 for normal V4/V4.5 work; more is not automatically better.</span></div>
          <div><strong>Guidance</strong><span>5–6 is a practical starting range for V3+; adjust by scene/style.</span></div>
          <div><strong>Seed</strong><span>Reuse a fixed seed when comparing prompt/tag changes.</span></div>
          <div><strong>Anlas</strong><span>Batching and larger generations can cost more. Provider/proxy billing may differ from NovelAI's own service.</span></div>
        </div>
      </details>

      <details class="ng-v040-cheat" open><summary><i class="fa-solid fa-lightbulb"></i> Suggestion Tags</summary>
        <div id="ng-v040-suggestions" class="ng-v040-tag-grid"><small class="ng-help">Press “Suggest Tags” to analyze the current prompt locally. No LLM/API quota is used.</small></div>
      </details>

      <details class="ng-v040-cheat"><summary><i class="fa-solid fa-bookmark"></i> Prompt presets</summary>
        <div class="ng-v040-tag-grid">${Object.keys(NG_V040_PRESETS).map(name => `<button class="menu_button ng-v040-builtin-preset" data-preset="${name}" type="button">${esc(name)}</button>`).join('')}</div>
        <div class="ng-actions"><button id="ng-v040-save-preset" class="menu_button" type="button"><i class="fa-solid fa-floppy-disk"></i> Save current preset</button></div>
        <div id="ng-v040-custom-presets"></div>
      </details>

      <label class="checkbox_label"><input id="ng-v040-auto-quality-studio" type="checkbox" ${prefs.autoQuality ? 'checked' : ''}><span>Use model-aware Quality Tags for Quick Generation</span></label>
    </div>
  </details>`;
}

async function ngV040SearchArtists(query) {
  const normalized = String(query || '').trim().replace(/\s+/g, '_').toLowerCase();
  if (normalized.length < 2) return [];
  if (ngV040ArtistCache.has(normalized)) return ngV040ArtistCache.get(normalized);
  const params = new URLSearchParams();
  params.set('search[name_or_alias_matches]', `${normalized}*`);
  params.set('search[category]', '1');
  params.set('search[order]', 'count');
  params.set('search[is_deprecated]', 'false');
  params.set('limit', '30');
  const response = await fetch(`${NG_V040_DANBOORU}/tags.json?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Danbooru HTTP ${response.status}`);
  const data = await response.json();
  const artists = (Array.isArray(data) ? data : [])
    .filter(item => Number(item.category) === 1 && !item.is_deprecated && item.name)
    .map(item => ({ name: item.name, postCount: Number(item.post_count) || 0 }))
    .slice(0, 30);
  ngV040ArtistCache.set(normalized, artists);
  return artists;
}

function ngV040RenderArtistResults(items, error = '') {
  const root = document.getElementById('ng-v040-artist-results');
  if (!root) return;
  if (error) {
    root.innerHTML = `<div class="ng-status is-error">${esc(error)}</div>`;
    return;
  }
  if (!items?.length) {
    root.innerHTML = '<small class="ng-help">No artist tags found.</small>';
    return;
  }
  root.innerHTML = items.map(item => `<button class="menu_button ng-v040-artist-result" type="button" data-name="${attr(item.name)}"><span>${esc(item.name.replace(/_/g, ' '))}</span><small>${item.postCount.toLocaleString()} posts</small></button>`).join('');
  root.querySelectorAll('.ng-v040-artist-result').forEach(button => button.addEventListener('click', () => {
    const prefs = ngV040Prefs();
    const name = button.dataset.name;
    if (!prefs.selectedArtists.some(item => item.name === name)) prefs.selectedArtists.push({ name, weight: 1 });
    save();
    ngV040RenderSelectedArtists();
  }));
}

function ngV040RenderSelectedArtists() {
  const root = document.getElementById('ng-v040-selected-artists');
  if (!root) return;
  const items = ngV040Prefs().selectedArtists;
  root.innerHTML = items.length ? items.map((item, index) => `<div class="ng-v040-artist-chip">
      <span>${esc(String(item.name).replace(/_/g, ' '))}</span>
      <label>Weight <input class="text_pole ng-v040-artist-weight" data-index="${index}" type="number" min="-3" max="3" step="0.1" value="${Number(item.weight ?? 1)}"></label>
      <button class="menu_button ng-v040-artist-remove" data-index="${index}" type="button" title="Remove"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('') : '<small class="ng-help">No artists selected. Select multiple artists to build a style mix.</small>';
  root.querySelectorAll('.ng-v040-artist-weight').forEach(input => input.addEventListener('change', () => {
    const item = ngV040Prefs().selectedArtists[+input.dataset.index];
    if (item) item.weight = Math.max(-3, Math.min(3, Number(input.value) || 1));
    save();
  }));
  root.querySelectorAll('.ng-v040-artist-remove').forEach(button => button.addEventListener('click', () => {
    ngV040Prefs().selectedArtists.splice(+button.dataset.index, 1);
    save();
    ngV040RenderSelectedArtists();
  }));
}

function ngV040RenderSuggestions() {
  const root = document.getElementById('ng-v040-suggestions');
  if (!root) return;
  const suggestions = ngV040SuggestTags(studio?.prompt || '');
  root.innerHTML = suggestions.length
    ? suggestions.map(tag => `<button class="menu_button ng-v040-suggestion" type="button" data-tag="${attr(tag)}">${esc(tag)}</button>`).join('')
    : '<small class="ng-help">No suggestions for the current prompt.</small>';
  root.querySelectorAll('.ng-v040-suggestion').forEach(button => button.addEventListener('click', () => {
    const target = document.getElementById('ng-v040-insert-target')?.value || 'prompt';
    ngV040InsertText(target, button.dataset.tag);
  }));
}

function ngV040CheatsheetMarkdown() {
  const artists = ngV040Prefs().selectedArtists.map(item => `- ${item.name.replace(/_/g, ' ')} (weight ${item.weight ?? 1})`).join('\n') || '- None selected';
  return `# NovelAI Cheatsheet — Novel Generation ${NG_V040_RELEASE}

## Artist / Style tags
Search Danbooru artist tags from the Prompt Assistant. Artist searches are lazy-loaded and can be mixed with individual weights.

Selected artists:
${artists}

## Multi-character action roles
- \`source#action\`: character performs the action.
- \`target#action\`: character receives the action.
- \`mutual#action\`: both characters mutually perform the action.

## Density / weighting
- \`{tag}\` strengthens and \`[tag]\` weakens.
- V4+ supports numerical emphasis such as \`1.5::tag ::\` and \`0.5::tag ::\`.
- V4.5 supports negative numerical emphasis for targeted removal/inversion.

## Quality / Aesthetic / Special
${NG_V040_TAGS.quality.map(tag => `- \`${tag}\``).join('\n')}

## Undesired Content
${NG_V040_TAGS.negative.map(tag => `- \`${tag}\``).join('\n')}

## Medium / Art style / Coloring / FX
${NG_V040_TAGS.medium.map(tag => `- \`${tag}\``).join('\n')}

## Camera / Frame / Lighting
${NG_V040_TAGS.camera.map(tag => `- \`${tag}\``).join('\n')}

## Character / Costume
${NG_V040_TAGS.character.map(tag => `- \`${tag}\``).join('\n')}

## Rating tags
${NG_V040_TAGS.rating.map(tag => `- \`${tag}\``).join('\n')}

## Recommended starting values
- Steps: around 28 for normal V4/V4.5 work.
- Guidance: around 5–6 is a practical V3+ starting point.
- Seed: reuse a fixed seed for A/B comparisons.
- Billing: proxy/provider billing can differ from NovelAI's own Anlas rules.

Generated from the built-in Prompt Assistant.
`;
}

function ngV040ExportMarkdown() {
  const blob = new Blob([ngV040CheatsheetMarkdown()], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `novelai-cheatsheet-${Date.now()}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ngV040BindAssistant() {
  const root = document.getElementById('ng-v040-assistant');
  if (!root || root.dataset.bound === '1') return;
  root.dataset.bound = '1';

  root.querySelectorAll('.ng-v040-tag').forEach(button => button.addEventListener('click', () => {
    const override = button.dataset.target;
    const target = override === 'negative' ? 'negative' : (document.getElementById('ng-v040-insert-target')?.value || 'prompt');
    ngV040InsertText(target, button.dataset.tag);
  }));
  root.querySelectorAll('.ng-v040-builtin-preset').forEach(button => button.addEventListener('click', () => ngV040ApplyPreset(button.dataset.preset)));

  document.getElementById('ng-v040-suggest')?.addEventListener('click', ngV040RenderSuggestions);
  document.getElementById('ng-v040-context')?.addEventListener('click', () => {
    if (!studio) return;
    const context = ngV040RecentContext();
    if (!context) return toast('warning', 'No recent roleplay context was found.');
    studio.prompt = `${studio.prompt.trim()}\n\nScene context:\n${context}`.trim();
    const prompt = document.getElementById('ng-prompt');
    if (prompt) {
      prompt.value = studio.prompt;
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  document.getElementById('ng-v040-export-md')?.addEventListener('click', ngV040ExportMarkdown);
  document.getElementById('ng-v040-quality-model')?.addEventListener('click', () => {
    if (!studio) return;
    studio.prompt = ngV040AppendTags(studio.prompt, ngV040ModelQualityTags());
    const prompt = document.getElementById('ng-prompt');
    if (prompt) {
      prompt.value = studio.prompt;
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  document.getElementById('ng-v040-apply-artists')?.addEventListener('click', () => {
    if (!studio) return;
    studio.prompt = ngV040AppendTags(studio.prompt, ngV040ArtistPromptTags());
    const prompt = document.getElementById('ng-prompt');
    if (prompt) {
      prompt.value = studio.prompt;
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  document.getElementById('ng-v040-save-preset')?.addEventListener('click', ngV040SavePreset);
  document.getElementById('ng-v040-auto-quality-studio')?.addEventListener('change', event => {
    ngV040Prefs().autoQuality = event.currentTarget.checked;
    save();
  });

  const artistSearch = document.getElementById('ng-v040-artist-search');
  artistSearch?.addEventListener('input', () => {
    clearTimeout(ngV040ArtistDebounce);
    const query = artistSearch.value;
    if (query.trim().length < 2) {
      ngV040RenderArtistResults([]);
      return;
    }
    const resultRoot = document.getElementById('ng-v040-artist-results');
    if (resultRoot) resultRoot.innerHTML = '<small class="ng-help">Searching Danbooru…</small>';
    ngV040ArtistDebounce = setTimeout(async () => {
      try { ngV040RenderArtistResults(await ngV040SearchArtists(query)); }
      catch (error) { ngV040RenderArtistResults([], `Artist search failed: ${error.message}`); }
    }, 350);
  });
  document.getElementById('ng-v040-artist-clear')?.addEventListener('click', () => {
    if (artistSearch) artistSearch.value = '';
    ngV040RenderArtistResults([]);
  });

  ngV040RenderSelectedArtists();
  ngV040RenderCustomPresets();
}

function ngV040EnhanceStudioUi() {
  const panel = document.getElementById('ng-generate-panel');
  if (!panel) return false;
  document.querySelectorAll('#ng-studio-overlay .ng-studio-title small').forEach(node => {
    if (!String(node.textContent).includes(`v${NG_V040_RELEASE}`)) node.title = `Novel Generation v${NG_V040_RELEASE}`;
  });
  if (!document.getElementById('ng-v040-assistant')) {
    const parameters = panel.querySelector('[data-focus="parameters"]');
    if (parameters) parameters.insertAdjacentHTML('beforebegin', ngV040AssistantHtml());
    else panel.insertAdjacentHTML('beforeend', ngV040AssistantHtml());
  }
  ngV040BindAssistant();
  return true;
}

function ngV040InstallDrawer() {
  const root = document.getElementById('ng-settings');
  if (!root) return false;
  root.querySelectorAll('.ng-version').forEach(node => { node.textContent = `v${NG_V040_RELEASE}`; });
  if (document.getElementById('ng-v040-drawer')) return true;
  const advanced = document.getElementById('ng-advanced');
  if (!advanced) return false;
  const prefs = ngV040Prefs();
  advanced.insertAdjacentHTML('beforebegin', `<details class="ng-section" id="ng-v040-drawer">
    <summary><span class="ng-section-icon"><i class="fa-solid fa-book-open"></i></span><span class="ng-section-copy"><strong>NovelAI Cheatsheet & Prompt Assistant</strong><small>Chat context, Quality Tags, suggestions and Danbooru artist styles</small></span><i class="fa-solid fa-chevron-down ng-section-chevron"></i></summary>
    <div class="ng-section-body">
      <label class="checkbox_label"><input id="ng-v040-quick-preview" type="checkbox" ${prefs.quickPreview ? 'checked' : ''}><span>Preview/edit Quick Generation prompt before sending</span></label>
      <label class="checkbox_label"><input id="ng-v040-auto-quality" type="checkbox" ${prefs.autoQuality ? 'checked' : ''}><span>Automatically add model-aware Quality Tags to Quick Generation</span></label>
      <label class="checkbox_label"><input id="ng-v040-quick-artists" type="checkbox" ${prefs.useArtistsQuick ? 'checked' : ''}><span>Use selected Danbooru artist style mix in Quick Generation</span></label>
      <label class="ng-field"><span class="ng-label">Recent chat messages to read</span><input id="ng-v040-context-count" class="text_pole" type="number" min="1" max="10" value="${Number(prefs.contextMessages) || 4}"><small class="ng-help">Quick Portrait/Selfie/User/Last Message/Manga modes can read this many recent roleplay messages.</small></label>
      <div class="ng-actions"><button id="ng-v040-open-assistant" class="menu_button" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Open Prompt Assistant</button><button id="ng-v040-drawer-export" class="menu_button" type="button"><i class="fa-solid fa-file-arrow-down"></i> Save cheatsheet .md</button></div>
    </div>
  </details>`);
  document.getElementById('ng-v040-quick-preview')?.addEventListener('change', event => { prefs.quickPreview = event.currentTarget.checked; save(); });
  document.getElementById('ng-v040-auto-quality')?.addEventListener('change', event => { prefs.autoQuality = event.currentTarget.checked; save(); });
  document.getElementById('ng-v040-quick-artists')?.addEventListener('change', event => { prefs.useArtistsQuick = event.currentTarget.checked; save(); });
  document.getElementById('ng-v040-context-count')?.addEventListener('change', event => {
    prefs.contextMessages = Math.max(1, Math.min(10, Number(event.currentTarget.value) || 4));
    event.currentTarget.value = prefs.contextMessages;
    save();
  });
  document.getElementById('ng-v040-open-assistant')?.addEventListener('click', () => {
    openStudio('last', 'prompt');
    setTimeout(() => {
      ngV040EnhanceStudioUi();
      openStudioSection('assistant');
    }, 20);
  });
  document.getElementById('ng-v040-drawer-export')?.addEventListener('click', ngV040ExportMarkdown);
  return true;
}

function ngV040QuickPreview(state, mode) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'ng-v040-preview-overlay';
    overlay.innerHTML = `<div class="ng-v040-preview-dialog" role="dialog" aria-modal="true">
      <header><div><strong>Quick Generation Preview</strong><small>${esc(mode)}</small></div><button class="menu_button ng-v040-preview-cancel" type="button"><i class="fa-solid fa-xmark"></i></button></header>
      <label class="ng-field"><span class="ng-label">Prompt</span><textarea class="text_pole ng-v040-preview-prompt" rows="10">${esc(state.prompt)}</textarea></label>
      <label class="ng-field"><span class="ng-label">Undesired Content</span><textarea class="text_pole ng-v040-preview-negative" rows="4">${esc(state.negative || '')}</textarea></label>
      <div class="ng-v040-preview-suggestions">${ngV040TagButtons(ngV040SuggestTags(state.prompt))}</div>
      <footer><button class="menu_button ng-v040-preview-cancel" type="button">Cancel</button><button class="menu_button ng-v040-preview-generate" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate & insert</button></footer>
    </div>`;
    document.documentElement.appendChild(overlay);
    const prompt = overlay.querySelector('.ng-v040-preview-prompt');
    const negative = overlay.querySelector('.ng-v040-preview-negative');
    overlay.querySelectorAll('.ng-v040-tag').forEach(button => button.addEventListener('click', () => {
      prompt.value = ngV040AppendTags(prompt.value, [button.dataset.tag]);
    }));
    const finish = value => { overlay.remove(); resolve(value); };
    overlay.querySelectorAll('.ng-v040-preview-cancel').forEach(button => button.addEventListener('click', () => finish(null)));
    overlay.querySelector('.ng-v040-preview-generate')?.addEventListener('click', () => {
      state.prompt = prompt.value.trim();
      state.negative = negative.value.trim();
      finish(state);
    });
  });
}

// Upgrade chat-driven quick prompts without adding another LLM/API call.
const ngV040BaseQuickGenerate = quickGenerate;
quickGenerate = async function(mode, manualPrompt = '') {
  const state = newStudio(mode, 'prompt');
  state.prompt = ngV040BuildQuickPrompt(mode, manualPrompt);
  state.n = settings().image.n;
  if (!state.prompt?.trim()) state.prompt = manualPrompt?.trim() || modePrompt(mode);
  if (ngV040Prefs().quickPreview) {
    const approved = await ngV040QuickPreview(state, mode);
    if (!approved) return;
  }
  toast('info', `Generating ${mode === 'last' ? 'the current roleplay scene' : mode}…`);
  try {
    const result = await generateState(state);
    rememberImages(result.images, state, { schema: result.schema, route: result.route, quick: true, chatContext: true });
    if (settings().roleplay.autoInsert) await insertImagesIntoChat(result.images, state.prompt);
    toast('success', settings().roleplay.autoInsert
      ? `Generated ${result.images.length} image${result.images.length === 1 ? '' : 's'} from chat context and inserted into chat.`
      : `Generated ${result.images.length} image${result.images.length === 1 ? '' : 's'} from chat context.`);
  } catch (error) {
    toast('error', error.message);
  }
};

// Future Studio opens receive the Prompt Assistant immediately.
const ngV040BaseOpenStudio = openStudio;
openStudio = function(mode = 'free', focus = 'prompt') {
  ngV040BaseOpenStudio(mode, focus);
  setTimeout(ngV040EnhanceStudioUi, 0);
};

// Add a direct Send-to-chat action to generated images and gallery entries.
const ngV040BaseGeneratedActions = generatedActions;
generatedActions = function(src, index) {
  const html = ngV040BaseGeneratedActions(src, index);
  return html.replace('</div>', `<button class="menu_button ng-v040-send-chat" data-src-index="${index}" type="button"><i class="fa-solid fa-comment"></i> Send to chat</button></div>`);
};

const ngV040BaseBindGeneratedActions = bindGeneratedActions;
bindGeneratedActions = function(root, images) {
  ngV040BaseBindGeneratedActions(root, images);
  root.querySelectorAll('.ng-v040-send-chat').forEach(button => button.addEventListener('click', async () => {
    try {
      const src = images[+button.dataset.srcIndex];
      if (!src) return;
      await insertImagesIntoChat([src], studio?.prompt || '');
      toast('success', 'Image inserted into the selected chat message.');
    } catch (error) {
      toast('error', error.message);
    }
  }));
};

ngV040Prefs();
let ngV040InstallAttempts = 0;
const ngV040InstallTimer = setInterval(() => {
  ngV040InstallAttempts += 1;
  const drawerReady = ngV040InstallDrawer();
  if (document.getElementById('ng-studio-overlay')) ngV040EnhanceStudioUi();
  if (drawerReady || ngV040InstallAttempts >= 40) clearInterval(ngV040InstallTimer);
}, 300);
