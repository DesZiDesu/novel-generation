// Novel Generation v0.3.1: provider capability discovery and connection UI.
const NG_V031_RELEASE = '0.3.1';
const ngProviderCaps = {
  checked: false,
  wrapper: 'unknown',
  nativeGenerate: 'unknown',
  nativeGenerateUrl: '',
  encodeVibe: 'unknown',
  encodeVibeUrl: '',
  checkedAt: '',
};

function ngCapabilityLabel(value) {
  if (value === 'supported') return 'Supported';
  if (value === 'blocked') return 'Route found, access blocked';
  if (value === 'missing') return 'Not exposed';
  if (value === 'testing') return 'Testing…';
  return 'Unknown';
}

function ngRenderCapabilities() {
  const statusNode = document.getElementById('ng-status');
  if (!statusNode) return false;
  let box = document.getElementById('ng-capabilities');
  if (!box) {
    box = document.createElement('div');
    box.id = 'ng-capabilities';
    box.className = 'ng-status';
    statusNode.insertAdjacentElement('afterend', box);
  }
  box.innerHTML = `<strong>Provider capabilities</strong><br>`
    + `OpenAI image wrapper: ${esc(ngCapabilityLabel(ngProviderCaps.wrapper))}<br>`
    + `NovelAI native generate: ${esc(ngCapabilityLabel(ngProviderCaps.nativeGenerate))}<br>`
    + `V4/V4.5 vibe encoder: ${esc(ngCapabilityLabel(ngProviderCaps.encodeVibe))}`
    + (ngProviderCaps.checkedAt ? `<br><small>Checked ${esc(new Date(ngProviderCaps.checkedAt).toLocaleTimeString())}</small>` : '');
  box.classList.toggle('is-ok', ngProviderCaps.wrapper === 'supported' && (ngProviderCaps.nativeGenerate === 'supported' || ngProviderCaps.encodeVibe === 'supported'));
  return true;
}

function ngInstallV031Ui() {
  document.querySelectorAll('#ng-settings .ng-version').forEach(node => { node.textContent = `v${NG_V031_RELEASE}`; });
  ngRenderCapabilities();
}

let ngV031UiAttempts = 0;
const ngV031UiTimer = setInterval(() => {
  ngV031UiAttempts += 1;
  ngInstallV031Ui();
  if (document.getElementById('ng-settings') || ngV031UiAttempts >= 40) clearInterval(ngV031UiTimer);
}, 250);

function ngProviderPathCandidates(path) {
  const current = base();
  if (!current) return [];
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const trimmed = current.replace(/\/+$/, '');
  const root = trimmed.replace(/\/v1$/i, '');
  const candidates = [
    `${root}${normalizedPath}`,
    `${trimmed}${normalizedPath}`,
  ];
  if (!/\/v1$/i.test(trimmed)) candidates.push(`${trimmed}/v1${normalizedPath}`);
  return [...new Set(candidates)];
}

async function ngProbeAdvancedEndpoint(path) {
  let sawNetworkFailure = false;
  for (const url of ngProviderPathCandidates(path)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: headers(),
        body: '{}',
        signal: controller.signal,
      });
      response.body?.cancel?.().catch?.(() => {});
      const statusCode = response.status;
      if (statusCode === 404) continue;
      if (statusCode === 401 || statusCode === 403) return { state: 'blocked', url, status: statusCode };
      if ([200, 400, 405, 415, 422].includes(statusCode)) return { state: 'supported', url, status: statusCode };
      if (statusCode >= 500) continue;
      return { state: 'supported', url, status: statusCode };
    } catch (error) {
      sawNetworkFailure = true;
      if (error?.name === 'AbortError') continue;
    } finally {
      clearTimeout(timer);
    }
  }
  return { state: sawNetworkFailure ? 'unknown' : 'missing', url: '', status: 0 };
}

async function ngProbeAdvancedCapabilities() {
  ngProviderCaps.nativeGenerate = 'testing';
  ngProviderCaps.encodeVibe = 'testing';
  ngRenderCapabilities();
  const [nativeGenerate, encodeVibe] = await Promise.all([
    ngProbeAdvancedEndpoint('/ai/generate-image'),
    ngProbeAdvancedEndpoint('/ai/encode-vibe'),
  ]);
  ngProviderCaps.nativeGenerate = nativeGenerate.state;
  ngProviderCaps.nativeGenerateUrl = nativeGenerate.url;
  ngProviderCaps.encodeVibe = encodeVibe.state;
  ngProviderCaps.encodeVibeUrl = encodeVibe.url;
  ngProviderCaps.checked = true;
  ngProviderCaps.checkedAt = new Date().toISOString();
  ngRenderCapabilities();
  debugAttempt({
    route: 'capability-probe',
    schema: 'provider-capabilities',
    status: 0,
    response: {
      native_generate: nativeGenerate,
      encode_vibe: encodeVibe,
    },
  });
  return ngProviderCaps;
}

// Overrides the v0.3 connection test before the settings UI is mounted.
async function connectAndLoadModels() {
  const s = settings();
  if (!base()) return toast('warning', 'Enter a Base URL first.');
  if (!apiKey) return toast('warning', 'Enter an API key first.');
  const button = document.getElementById('ng-connect');
  button?.setAttribute('disabled', 'disabled');
  status('Testing connection and loading models…', 'testing');
  ngProviderCaps.wrapper = 'testing';
  ngProviderCaps.nativeGenerate = 'unknown';
  ngProviderCaps.encodeVibe = 'unknown';
  ngRenderCapabilities();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, s.timeoutMs));
  try {
    const response = await fetch(endpoint('/v1/models'), { headers: headers(), signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await errText(response)}`);
    models = modelIds(await response.json());
    if (!models.length) throw new Error('Connected, but /v1/models returned no selectable model list.');
    const select = document.getElementById('ng-model');
    select.innerHTML = models.map(model => `<option value="${attr(model)}">${esc(model)}</option>`).join('');
    const preferred = models.includes(s.model) ? s.model : models.find(model => /nai.*4.?5.*full/i.test(model)) || models[0];
    s.model = preferred;
    select.value = preferred;
    select.disabled = false;
    save();
    ngProviderCaps.wrapper = 'supported';
    status(`Connected. ${models.length} model${models.length === 1 ? '' : 's'} available. Checking NovelAI advanced routes…`, 'testing');
    ngRenderCapabilities();
    await ngProbeAdvancedCapabilities();
    const advanced = ngProviderCaps.nativeGenerate === 'supported' || ngProviderCaps.encodeVibe === 'supported';
    status(advanced
      ? `Connected. ${models.length} model${models.length === 1 ? '' : 's'} available. Advanced NovelAI route(s) detected.`
      : `Connected. ${models.length} model${models.length === 1 ? '' : 's'} available. Advanced native routes were not confirmed.`, 'ok');
    toast('success', advanced ? 'Connected. Advanced NovelAI capability detected.' : 'Connected. Basic image generation is available.');
  } catch (error) {
    ngProviderCaps.wrapper = 'unknown';
    status(`Connection failed: ${error.message}`, 'error');
    ngRenderCapabilities();
    toast('error', `Connection failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
    button?.removeAttribute('disabled');
  }
}
