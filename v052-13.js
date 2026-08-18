// Novel Generation v0.5.2 — mobile image viewer, reliable save actions,
// custom-size scaler/ratio tools, and responsive Studio refinements.
// Loaded after v0.5.1 so the restored classic UI and all previous features remain intact.

var NG_V052_RELEASE = '0.5.2';

function ngV052IsIOS() {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent || '')
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function ngV052EnsureSettings() {
  var s = typeof ngV051EnsureSettings === 'function' ? ngV051EnsureSettings() : settings();
  s.image.sizeSnap ??= true;
  s.image.sizeLock ??= true;
  return s;
}

function ngV052SetVersionLabels() {
  document.querySelectorAll('#ng-settings .ng-version').forEach(function (node) {
    node.textContent = 'v' + NG_V052_RELEASE;
  });
  document.querySelectorAll('#ng-studio-overlay .ng-studio-title small').forEach(function (node) {
    var modeText = String(node.textContent || '').replace(/^v\d+(?:\.\d+){1,2}\s*[·-]?\s*/i, '').trim();
    if (!modeText || /^v\d/i.test(modeText)) modeText = studio?.mode ? String(studio.mode) : '';
    node.textContent = 'v' + NG_V052_RELEASE + (modeText ? ' · ' + modeText : '');
  });
}

if (typeof ngV051SetVersionLabels === 'function') {
  ngV051SetVersionLabels = ngV052SetVersionLabels;
}

function ngV052Filename(index) {
  var suffix = Number(index || 0) + 1;
  return 'novel-generation-' + Date.now() + '-' + suffix + '.png';
}

async function ngV052BlobFromImage(src) {
  var normalized = norm(src);
  if (!normalized) throw new Error('Image source is empty.');
  var response = await fetch(normalized, { credentials: normalized.startsWith('/') ? 'same-origin' : 'omit' });
  if (!response.ok) throw new Error('Could not read image: HTTP ' + response.status);
  return await response.blob();
}

function ngV052Extension(type) {
  if (/jpe?g/i.test(type || '')) return 'jpg';
  if (/webp/i.test(type || '')) return 'webp';
  return 'png';
}

async function ngV052SaveImage(src, filename) {
  var blob;
  try {
    blob = await ngV052BlobFromImage(src);
  } catch (error) {
    toast('warning', 'Direct download is unavailable for this image. Open it here and press/hold the image to save it.');
    return false;
  }

  var ext = ngV052Extension(blob.type);
  var safeName = String(filename || ('novel-generation-' + Date.now() + '.' + ext))
    .replace(/\.(png|jpe?g|webp)$/i, '') + '.' + ext;
  var file = new File([blob], safeName, { type: blob.type || 'image/png' });

  // iOS Safari is much more reliable when handing an image file to the
  // native share sheet than when using an <a download> blob URL.
  if (ngV052IsIOS() && navigator.share && navigator.canShare) {
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Novel Generation image' });
        return true;
      }
    } catch (error) {
      if (error?.name === 'AbortError') return false;
      console.debug('[Novel Generation] iOS file share fallback', error);
    }
  }

  try {
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safeName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(function () {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 1500);
    return true;
  } catch (error) {
    toast('warning', 'Your browser blocked the download. Press/hold the image in the full viewer to save it.');
    return false;
  }
}

function ngV052CloseViewer() {
  var viewer = document.getElementById('ng-image-viewer');
  if (!viewer) return;
  var handler = viewer._ngEscapeHandler;
  if (handler) document.removeEventListener('keydown', handler);
  viewer.remove();
  document.body?.classList.remove('ng-image-viewer-open');
}

function ngV052OpenViewer(src, meta) {
  ngV052CloseViewer();
  var info = meta || {};
  var overlay = document.createElement('div');
  overlay.id = 'ng-image-viewer';
  overlay.className = 'ng-image-viewer';
  overlay.innerHTML = '<div class="ng-image-viewer-dialog" role="dialog" aria-modal="true">'
    + '<header><div><strong>Original image</strong><small>'
    + esc([info.model, info.width && info.height ? info.width + ' × ' + info.height : ''].filter(Boolean).join(' · '))
    + '</small></div><button class="menu_button ng-image-viewer-close" type="button" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></header>'
    + '<div class="ng-image-viewer-stage"><img src="' + attr(src) + '" alt="Generated image"></div>'
    + '<footer>'
    + '<button class="menu_button ng-image-viewer-save" type="button"><i class="fa-solid fa-download"></i> Save</button>'
    + (studio ? '<button class="menu_button ng-image-viewer-source" type="button"><i class="fa-solid fa-image"></i> Use as source</button>' : '')
    + '<small>On iPhone/iPad, Save uses the native share sheet when available. You can also press and hold the full image.</small>'
    + '</footer></div>';

  document.documentElement.appendChild(overlay);
  document.body?.classList.add('ng-image-viewer-open');

  overlay.addEventListener('pointerdown', function (event) {
    if (event.target === overlay) ngV052CloseViewer();
  });
  overlay.querySelector('.ng-image-viewer-close')?.addEventListener('click', ngV052CloseViewer);
  overlay.querySelector('.ng-image-viewer-save')?.addEventListener('click', async function () {
    await ngV052SaveImage(src, info.filename || ('novel-generation-' + Date.now() + '.png'));
  });
  overlay.querySelector('.ng-image-viewer-source')?.addEventListener('click', async function () {
    var ref = await refFromSrc(src, 'viewer-source.png');
    if (!ref) return;
    setStudioSource(ref);
    ngV052CloseViewer();
    openStudioSection('edit');
  });

  var escape = function (event) {
    if (event.key === 'Escape') ngV052CloseViewer();
  };
  overlay._ngEscapeHandler = escape;
  document.addEventListener('keydown', escape);
}

function generatedActions(src, index) {
  return '<div class="ng-generated-actions">'
    + '<button class="menu_button ng-view-image" data-src-index="' + index + '" type="button"><i class="fa-solid fa-expand"></i> View</button>'
    + '<button class="menu_button ng-save-image" data-src-index="' + index + '" type="button"><i class="fa-solid fa-download"></i> Save</button>'
    + '<button class="menu_button ng-use-source" data-src-index="' + index + '" type="button"><i class="fa-solid fa-image"></i> Use as source</button>'
    + '<button class="menu_button ng-use-inpaint" data-src-index="' + index + '" type="button"><i class="fa-solid fa-paintbrush"></i> Inpaint</button>'
    + '<button class="menu_button ng-use-vibe" data-src-index="' + index + '" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> Vibe</button>'
    + '<button class="menu_button ng-use-precise" data-src-index="' + index + '" type="button"><i class="fa-solid fa-id-card-clip"></i> Precise</button>'
    + '<button class="menu_button ng-send-chat" data-src-index="' + index + '" type="button"><i class="fa-solid fa-comment"></i> Send to chat</button>'
    + '</div>';
}

function showImages(images) {
  var preview = document.getElementById('ng-preview');
  if (!preview) return;
  studio.generated = images;
  preview.innerHTML = '<div class="ng-generated-grid">' + images.map(function (src, index) {
    return '<figure class="ng-generated-card"><button class="ng-image-tap-target" data-src-index="' + index + '" type="button" aria-label="View full image">'
      + '<img class="ng-viewable-image" src="' + attr(src) + '" alt="Generated image"></button><figcaption>'
      + generatedActions(src, index) + '</figcaption></figure>';
  }).join('') + '</div>';
  bindGeneratedActions(preview, images, images.map(function () {
    return { prompt: studio?.prompt || '', model: settings().model, width: studio?.width, height: studio?.height };
  }));
}

function renderGallery() {
  var grid = document.getElementById('ng-gallery-grid');
  if (!grid) return;
  if (!gallery.length) {
    grid.innerHTML = '<div class="ng-preview-empty"><i class="fa-regular fa-images"></i><strong>No images yet</strong><span>Successful generations appear here.</span></div>';
    return;
  }
  var images = gallery.map(function (item) { return item.src; });
  grid.innerHTML = gallery.map(function (item, index) {
    return '<article class="ng-gallery-item">'
      + '<button class="ng-image-tap-target ng-gallery-image-button" data-src-index="' + index + '" type="button" aria-label="View full image">'
      + '<img class="ng-viewable-image" src="' + attr(item.src) + '" alt="Gallery image"></button>'
      + '<div><strong>' + esc(item.model) + '</strong><small>' + item.width + ' × ' + item.height + '</small></div>'
      + generatedActions(item.src, index) + '</article>';
  }).join('');
  bindGeneratedActions(grid, images, gallery);
}

function bindGeneratedActions(root, images, metadata) {
  var data = Array.isArray(metadata) ? metadata : [];

  function getIndex(node) {
    return Math.max(0, Number(node.dataset.srcIndex) || 0);
  }
  function metaFor(index) {
    return data[index] || {};
  }

  root.querySelectorAll('.ng-view-image, .ng-image-tap-target').forEach(function (button) {
    button.addEventListener('click', function () {
      var index = getIndex(button);
      ngV052OpenViewer(images[index], { ...metaFor(index), filename: ngV052Filename(index) });
    });
  });

  root.querySelectorAll('.ng-save-image').forEach(function (button) {
    button.addEventListener('click', async function () {
      var index = getIndex(button);
      await ngV052SaveImage(images[index], ngV052Filename(index));
    });
  });

  root.querySelectorAll('.ng-use-source').forEach(function (button) {
    button.addEventListener('click', async function () {
      var index = getIndex(button);
      var ref = await refFromSrc(images[index], 'generated-source.png');
      if (ref) setStudioSource(ref);
      openStudioSection('edit');
    });
  });

  root.querySelectorAll('.ng-use-inpaint').forEach(function (button) {
    button.addEventListener('click', async function () {
      var index = getIndex(button);
      var ref = await refFromSrc(images[index], 'generated-inpaint.png');
      if (!ref) return;
      setStudioSource(ref);
      studio.editMode = 'inpaint';
      var select = document.getElementById('ng-edit-mode');
      if (select) select.value = 'inpaint';
      openStudioSection('edit');
      refreshMaskEditor();
    });
  });

  root.querySelectorAll('.ng-use-vibe').forEach(function (button) {
    button.addEventListener('click', async function () {
      if (studio.precise.length) return toast('warning', 'Remove Precise Reference before using Vibe Transfer.');
      var index = getIndex(button);
      var ref = await refFromSrc(images[index], 'generated-vibe.png');
      if (!ref) return;
      studio.vibes.push({ ...ref, strength: 0.6, information: 1 });
      normalizeVibes(false);
      renderRefs('vibe');
      openStudioSection('vibe');
    });
  });

  root.querySelectorAll('.ng-use-precise').forEach(function (button) {
    button.addEventListener('click', async function () {
      if (studio.vibes.length) return toast('warning', 'Remove Vibe Transfer before using Precise Reference.');
      var index = getIndex(button);
      var ref = await refFromSrc(images[index], 'generated-precise.png');
      if (!ref) return;
      studio.precise.push({ ...ref, type: 'character', strength: 1, fidelity: 1 });
      renderRefs('precise');
      openStudioSection('precise');
    });
  });

  root.querySelectorAll('.ng-send-chat').forEach(function (button) {
    button.addEventListener('click', async function () {
      var index = getIndex(button);
      try {
        await insertImagesIntoChat([images[index]], metaFor(index).prompt || studio?.prompt || '');
        toast('success', 'Image inserted into chat.');
      } catch (error) {
        toast('error', error.message);
      }
    });
  });
}

function ngV052Snap(value) {
  var number = Math.max(64, Number(value) || 64);
  return Math.max(64, Math.round(number / 64) * 64);
}

function ngV052Gcd(a, b) {
  a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));
  while (b) { var temp = b; b = a % b; a = temp; }
  return a || 1;
}

function ngV052SizeText(width, height) {
  var w = Math.max(1, Math.round(width || 1));
  var h = Math.max(1, Math.round(height || 1));
  var gcd = ngV052Gcd(w, h);
  var mp = (w * h / 1000000).toFixed(2);
  return w + ' × ' + h + ' · ' + (w / gcd) + ':' + (h / gcd) + ' · ' + mp + ' MP';
}

function ngV052SyncSizeInputs(prefix, target, width, height) {
  var w = document.getElementById(prefix + '-width');
  var h = document.getElementById(prefix + '-height');
  target.preset = 'custom';
  target.width = width;
  target.height = height;
  if (w) { w.value = width; w.dispatchEvent(new Event('input', { bubbles: true })); }
  if (h) { h.value = height; h.dispatchEvent(new Event('input', { bubbles: true })); }
  if (prefix === 'ng') save();
}

function ngV052AttachSizeTools(prefix, targetGetter) {
  var custom = document.querySelector('[data-ng-custom="' + prefix + '"]');
  if (!custom || custom.querySelector('.ng-v052-size-tools')) return;
  var target = targetGetter();
  if (!target) return;

  var s = ngV052EnsureSettings();
  var ratio = Math.max(0.01, Number(target.width || 832) / Math.max(1, Number(target.height || 1216)));

  var tools = document.createElement('div');
  tools.className = 'ng-v052-size-tools';
  tools.dataset.ngRatio = String(ratio);
  tools.innerHTML = '<div class="ng-v052-size-toolbar">'
    + '<label class="checkbox_label"><input class="ng-v052-lock" type="checkbox" ' + (s.image.sizeLock ? 'checked' : '') + '><span>Keep ratio</span></label>'
    + '<label class="checkbox_label"><input class="ng-v052-snap" type="checkbox" ' + (s.image.sizeSnap ? 'checked' : '') + '><span>Snap to 64</span></label>'
    + '<button class="menu_button ng-v052-swap" type="button"><i class="fa-solid fa-repeat"></i> Swap</button>'
    + '</div>'
    + '<label class="ng-v052-scale-row"><span>Size scaler <output>100%</output></span><input class="ng-v052-scale" type="range" min="50" max="200" step="5" value="100"></label>'
    + '<div class="ng-v052-size-info"></div>';
  custom.appendChild(tools);

  var widthInput = document.getElementById(prefix + '-width');
  var heightInput = document.getElementById(prefix + '-height');
  var lock = tools.querySelector('.ng-v052-lock');
  var snap = tools.querySelector('.ng-v052-snap');
  var swap = tools.querySelector('.ng-v052-swap');
  var scale = tools.querySelector('.ng-v052-scale');
  var output = tools.querySelector('.ng-v052-scale-row output');
  var info = tools.querySelector('.ng-v052-size-info');

  function currentTarget() { return targetGetter(); }
  function currentRatio() { return Math.max(0.01, Number(tools.dataset.ngRatio) || ratio); }
  function shouldSnap() { return Boolean(snap?.checked); }
  function updateInfo() {
    var live = currentTarget();
    if (info && live) info.textContent = ngV052SizeText(live.width, live.height);
  }
  function finalize(changed) {
    var live = currentTarget();
    if (!live || !widthInput || !heightInput) return;
    var w = Number(widthInput.value) || Number(live.width) || 832;
    var h = Number(heightInput.value) || Number(live.height) || 1216;
    var r = currentRatio();

    if (changed === 'width') {
      if (shouldSnap()) w = ngV052Snap(w);
      if (lock?.checked) h = shouldSnap() ? ngV052Snap(w / r) : Math.max(64, Math.round(w / r));
      else if (shouldSnap()) h = ngV052Snap(h);
    } else {
      if (shouldSnap()) h = ngV052Snap(h);
      if (lock?.checked) w = shouldSnap() ? ngV052Snap(h * r) : Math.max(64, Math.round(h * r));
      else if (shouldSnap()) w = ngV052Snap(w);
    }

    ngV052SyncSizeInputs(prefix, live, w, h);
    if (!lock?.checked) tools.dataset.ngRatio = String(Math.max(0.01, w / Math.max(1, h)));
    tools.dataset.baseWidth = String(w);
    tools.dataset.baseHeight = String(h);
    updateInfo();
  }

  widthInput?.addEventListener('change', function () { finalize('width'); });
  heightInput?.addEventListener('change', function () { finalize('height'); });

  lock?.addEventListener('change', function () {
    s.image.sizeLock = lock.checked;
    var live = currentTarget();
    if (live) tools.dataset.ngRatio = String(Math.max(0.01, live.width / Math.max(1, live.height)));
    save();
  });
  snap?.addEventListener('change', function () {
    s.image.sizeSnap = snap.checked;
    save();
    finalize('width');
  });

  swap?.addEventListener('click', function () {
    var live = currentTarget();
    if (!live) return;
    var w = Number(live.height) || 1216;
    var h = Number(live.width) || 832;
    if (shouldSnap()) { w = ngV052Snap(w); h = ngV052Snap(h); }
    tools.dataset.ngRatio = String(Math.max(0.01, w / Math.max(1, h)));
    ngV052SyncSizeInputs(prefix, live, w, h);
    tools.dataset.baseWidth = String(w);
    tools.dataset.baseHeight = String(h);
    updateInfo();
  });

  function captureBase() {
    var live = currentTarget();
    if (!live) return;
    tools.dataset.baseWidth = String(Number(live.width) || 832);
    tools.dataset.baseHeight = String(Number(live.height) || 1216);
  }
  scale?.addEventListener('pointerdown', captureBase);
  scale?.addEventListener('touchstart', captureBase, { passive: true });
  scale?.addEventListener('focus', function () {
    if (!tools.dataset.baseWidth) captureBase();
  });
  scale?.addEventListener('input', function () {
    var live = currentTarget();
    if (!live) return;
    var factor = Math.max(0.5, Math.min(2, Number(scale.value || 100) / 100));
    var baseW = Number(tools.dataset.baseWidth) || Number(live.width) || 832;
    var baseH = Number(tools.dataset.baseHeight) || Number(live.height) || 1216;
    var w = baseW * factor;
    var h = baseH * factor;
    if (shouldSnap()) { w = ngV052Snap(w); h = ngV052Snap(h); }
    else { w = Math.max(64, Math.round(w)); h = Math.max(64, Math.round(h)); }
    if (output) output.textContent = Math.round(factor * 100) + '%';
    ngV052SyncSizeInputs(prefix, live, w, h);
    updateInfo();
  });
  scale?.addEventListener('change', function () {
    var live = currentTarget();
    if (live) {
      tools.dataset.baseWidth = String(live.width);
      tools.dataset.baseHeight = String(live.height);
      tools.dataset.ngRatio = String(Math.max(0.01, live.width / Math.max(1, live.height)));
    }
    if (scale) scale.value = '100';
    if (output) output.textContent = '100%';
  });

  tools.dataset.baseWidth = String(Number(target.width) || 832);
  tools.dataset.baseHeight = String(Number(target.height) || 1216);
  updateInfo();
}

function ngV052PatchSizes() {
  ngV052AttachSizeTools('ng', function () { return ngV052EnsureSettings().image; });
  ngV052AttachSizeTools('ng-studio', function () { return studio; });
}

var ngV052BaseOpenStudio = openStudio;
openStudio = function (mode, focus) {
  ngV052BaseOpenStudio(mode, focus);
  setTimeout(function () {
    ngV052SetVersionLabels();
    ngV052PatchSizes();
  }, 0);
};

ngV052EnsureSettings();
ngV052SetVersionLabels();
ngV052PatchSizes();

var ngV052Attempts = 0;
var ngV052Timer = setInterval(function () {
  ngV052Attempts += 1;
  ngV052SetVersionLabels();
  ngV052PatchSizes();
  if ((document.getElementById('ng-settings') && document.getElementById('ng-wand-image')) || ngV052Attempts >= 50) {
    clearInterval(ngV052Timer);
  }
}, 250);
