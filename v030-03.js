function initWand() {
  const menu = document.getElementById('extensionsMenu');
  if (!menu) return false;
  if (document.getElementById('ng-wand-image')) return true;

  const quick = makeWandRow('ng-wand-image', 'fa-image', 'Novel Image Gen');
  quick.insertAdjacentHTML('beforeend', '<i class="fa-solid fa-chevron-down ng-wand-chevron"></i>');
  menu.appendChild(quick);

  const items = [
    ['portrait', 'fa-user', 'Portrait'],
    ['selfie', 'fa-face-smile', 'Selfie'],
    ['user', 'fa-user', 'User'],
    ['last', 'fa-message', 'Last Message'],
    ['manga', 'fa-table-cells-large', 'Manga Panel'],
    ['free', 'fa-pen-nib', 'Free / Scene'],
  ];

  const rows = [];
  let anchor = quick;
  for (const [mode, icon, label] of items) {
    const row = makeWandRow(`ng-wand-${mode}`, icon, label, 'ng-wand-subitem');
    row.hidden = true;
    anchor.insertAdjacentElement('afterend', row);
    anchor = row;
    rows.push(row);
    bindPress(row, async () => {
      rows.forEach(item => { item.hidden = true; });
      quick.classList.remove('is-open');
      if (mode === 'free') {
        const promptText = window.prompt('Describe the image you want to generate:');
        if (!promptText?.trim()) return;
        await quickGenerate(mode, promptText.trim());
      } else {
        await quickGenerate(mode);
      }
    });
  }

  bindPress(quick, () => {
    const next = !rows[0].hidden;
    rows.forEach(row => { row.hidden = next; });
    quick.classList.toggle('is-open', !next);
  });

  const studioRow = makeWandRow('ng-wand-studio', 'fa-wand-magic-sparkles', 'Novel Gen');
  anchor.insertAdjacentElement('afterend', studioRow);
  bindPress(studioRow, () => openStudio('free', 'prompt'));
  return true;
}

function stripMarkup(text) {
  const temp = document.createElement('div');
  temp.innerHTML = String(text || '');
  return (temp.textContent || '').replace(/\s+/g, ' ').trim();
}

function lastMessage() {
  try { return stripMarkup(ctx().chat?.at(-1)?.mes || ''); } catch { return ''; }
}

function characterData() {
  try {
    const c = ctx();
    const character = c.characters?.[c.characterId];
    return {
      name: String(c.name2 || character?.name || '').trim(),
      description: stripMarkup(character?.description || character?.data?.description || '').slice(0, 1800),
    };
  } catch {
    return { name: '', description: '' };
  }
}

function personaName() {
  try { return String(ctx().name1 || 'the user').trim(); } catch { return 'the user'; }
}

function modePrompt(mode) {
  const s = settings();
  const char = characterData();
  const scene = s.roleplay.lastMessage ? lastMessage() : '';
  const charContext = s.roleplay.character && char.description ? ` Character appearance: ${char.description}.` : '';
  const userContext = s.roleplay.persona ? ` User/persona: ${personaName()}.` : '';

  if (mode === 'portrait') return `portrait of ${char.name || 'the active character'}, solo, detailed character illustration.${charContext}`;
  if (mode === 'selfie') return `${char.name || 'the active character'} taking a selfie, candid close framing, natural pose.${charContext}${scene ? ` Current scene: ${scene}` : ''}`;
  if (mode === 'user') return `portrait of ${personaName()}, detailed character illustration.${userContext}${scene ? ` Current scene context: ${scene}` : ''}`;
  if (mode === 'last') return `${scene || 'current roleplay scene'}.${charContext}${userContext}`;
  if (mode === 'manga') return `manga panel, dynamic composition, cinematic storytelling. Scene: ${scene || 'current roleplay scene'}.${charContext}${userContext}`;
  return '';
}

function newStudio(mode = 'free', focus = 'prompt') {
  const defaults = settings().image;
  return {
    mode,
    focus,
    prompt: modePrompt(mode),
    negative: '',
    preset: defaults.preset,
    width: defaults.width,
    height: defaults.height,
    steps: defaults.steps,
    guidance: defaults.guidance,
    sampler: defaults.sampler,
    scheduler: defaults.scheduler,
    seed: defaults.seed,
    n: defaults.n,
    characters: [],
    vibes: [],
    precise: [],
    normalizeVibes: true,
    source: null,
    mask: null,
    editMode: 'img2img',
    strength: 0.6,
    noise: 0.1,
    maskTool: 'brush',
    brushSize: 48,
    generated: [],
  };
}
