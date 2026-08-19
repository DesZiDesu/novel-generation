// Novel Generation v0.5.3 — weighted NovelAI prompt visualization.
// Loaded after v0.5.2 so all previous generation, gallery, size and mobile features remain intact.

var NG_V053_RELEASE = '0.5.3';

function ngV053EscapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ngV053WeightStyle(weight) {
  var amount = Math.min(6, Math.abs(Number(weight) || 0));
  var power = amount <= 0 ? 0 : Math.min(1, Math.log2(1 + amount) / Math.log2(7));
  var blur = (3 + power * 9).toFixed(1) + 'px';
  var glowAlpha = (0.16 + power * 0.28).toFixed(3);
  var backgroundAlpha = (0.02 + power * 0.08).toFixed(3);
  var edgeAlpha = (0.08 + power * 0.16).toFixed(3);
  var positive = Number(weight) >= 0;
  return {
    cls: positive ? 'is-positive' : 'is-negative',
    style: positive
      ? '--ng-weight-blur:' + blur + ';--ng-weight-glow:rgba(255,187,84,' + glowAlpha + ');--ng-weight-bg:rgba(255,166,61,' + backgroundAlpha + ');--ng-weight-edge:rgba(255,198,112,' + edgeAlpha + ');'
      : '--ng-weight-blur:' + blur + ';--ng-weight-glow:rgba(93,185,255,' + glowAlpha + ');--ng-weight-bg:rgba(67,149,255,' + backgroundAlpha + ');--ng-weight-edge:rgba(123,205,255,' + edgeAlpha + ');'
  };
}

function ngV053HighlightWeightedPrompt(value) {
  var text = String(value ?? '');
  var pattern = /(-?(?:\d+(?:\.\d+)?|\.\d+))::([^\n]*?)::/g;
  var html = '';
  var cursor = 0;
  var match;

  while ((match = pattern.exec(text))) {
    html += ngV053EscapeHtml(text.slice(cursor, match.index));
    var weight = Number(match[1]);
    var visual = ngV053WeightStyle(weight);
    html += '<span class="ng-weight-token ' + visual.cls + '" style="' + visual.style + '">'
      + '<span class="ng-weight-number">' + ngV053EscapeHtml(match[1]) + '</span>'
      + '<span class="ng-weight-delimiter">::</span>'
      + '<span class="ng-weight-tag">' + ngV053EscapeHtml(match[2]) + '</span>'
      + '<span class="ng-weight-delimiter">::</span>'
      + '</span>';
    cursor = pattern.lastIndex;
  }

  html += ngV053EscapeHtml(text.slice(cursor));
  return html + '\n';
}

function ngV053CopyEditorMetrics(textarea, mirror) {
  if (!textarea || !mirror) return;
  var computed = getComputedStyle(textarea);
  mirror.style.fontFamily = computed.fontFamily;
  mirror.style.fontSize = computed.fontSize;
  mirror.style.fontWeight = computed.fontWeight;
  mirror.style.fontStyle = computed.fontStyle;
  mirror.style.letterSpacing = computed.letterSpacing;
  mirror.style.lineHeight = computed.lineHeight;
  mirror.style.textAlign = computed.textAlign;
  mirror.style.textIndent = computed.textIndent;
  mirror.style.textTransform = computed.textTransform;
  mirror.style.tabSize = computed.tabSize || '8';
  mirror.style.paddingTop = computed.paddingTop;
  mirror.style.paddingRight = computed.paddingRight;
  mirror.style.paddingBottom = computed.paddingBottom;
  mirror.style.paddingLeft = computed.paddingLeft;
  mirror.style.borderTopWidth = computed.borderTopWidth;
  mirror.style.borderRightWidth = computed.borderRightWidth;
  mirror.style.borderBottomWidth = computed.borderBottomWidth;
  mirror.style.borderLeftWidth = computed.borderLeftWidth;
  mirror.style.borderStyle = 'solid';
  mirror.style.borderColor = 'transparent';
  mirror.style.borderRadius = computed.borderRadius;
  mirror.style.backgroundColor = computed.backgroundColor;
  mirror.style.backgroundImage = computed.backgroundImage;
  mirror.style.backgroundPosition = computed.backgroundPosition;
  mirror.style.backgroundSize = computed.backgroundSize;
}

function ngV053SyncEditor(textarea) {
  var state = textarea?._ngV053WeightEditor;
  if (!state) return;
  state.text.innerHTML = ngV053HighlightWeightedPrompt(textarea.value);
  state.text.style.transform = 'translate(' + (-textarea.scrollLeft) + 'px,' + (-textarea.scrollTop) + 'px)';
}

function ngV053AttachWeightedEditor(textarea) {
  if (!textarea || textarea._ngV053WeightEditor || !textarea.parentNode) return;

  var wrapper = document.createElement('div');
  wrapper.className = 'ng-weight-editor';
  var mirror = document.createElement('div');
  mirror.className = 'ng-weight-mirror';
  mirror.setAttribute('aria-hidden', 'true');
  var text = document.createElement('div');
  text.className = 'ng-weight-mirror-text';
  mirror.appendChild(text);

  textarea.parentNode.insertBefore(wrapper, textarea);
  wrapper.appendChild(mirror);
  wrapper.appendChild(textarea);
  textarea.classList.add('ng-weight-textarea');

  textarea._ngV053WeightEditor = { wrapper: wrapper, mirror: mirror, text: text };
  ngV053CopyEditorMetrics(textarea, mirror);
  ngV053SyncEditor(textarea);

  textarea.addEventListener('input', function () { ngV053SyncEditor(textarea); });
  textarea.addEventListener('scroll', function () { ngV053SyncEditor(textarea); }, { passive: true });
  textarea.addEventListener('focus', function () {
    ngV053CopyEditorMetrics(textarea, mirror);
    ngV053SyncEditor(textarea);
  });

  if (textarea.id === 'ng-prompt') {
    var hint = document.createElement('small');
    hint.className = 'ng-weight-hint';
    hint.innerHTML = '<span class="ng-weight-hint-positive">1::tag:: positive emphasis</span><span class="ng-weight-hint-negative">-1::tag:: negative emphasis</span><span>Glow increases with magnitude and is capped for readability.</span>';
    wrapper.insertAdjacentElement('afterend', hint);
  }
}

function ngV053RefreshWeightedEditors() {
  document.querySelectorAll('#ng-studio-overlay textarea.text_pole').forEach(ngV053AttachWeightedEditor);
  document.querySelectorAll('#ng-studio-overlay textarea.ng-weight-textarea').forEach(ngV053SyncEditor);
}

function ngV053SetVersionLabels() {
  document.querySelectorAll('#ng-settings .ng-version').forEach(function (node) {
    node.textContent = 'v' + NG_V053_RELEASE;
  });
  document.querySelectorAll('#ng-studio-overlay .ng-studio-title small').forEach(function (node) {
    var current = String(node.textContent || '').replace(/^v\d+(?:\.\d+){1,2}\s*[·-]?\s*/i, '').trim();
    if (!current || /^v\d/i.test(current)) current = studio?.mode ? String(studio.mode) : '';
    node.textContent = 'v' + NG_V053_RELEASE + (current ? ' · ' + current : '');
  });
}

var ngV053BaseOpenStudio = openStudio;
openStudio = function (mode, focus) {
  ngV053BaseOpenStudio(mode, focus);
  setTimeout(function () {
    ngV053SetVersionLabels();
    ngV053RefreshWeightedEditors();
    var overlay = document.getElementById('ng-studio-overlay');
    if (overlay && !overlay.dataset.ngWeightRefreshBound) {
      overlay.dataset.ngWeightRefreshBound = '1';
      overlay.addEventListener('click', function () {
        setTimeout(ngV053RefreshWeightedEditors, 0);
      });
    }
  }, 0);
};

if (typeof renderCharacters === 'function') {
  var ngV053BaseRenderCharacters = renderCharacters;
  renderCharacters = function () {
    var result = ngV053BaseRenderCharacters.apply(this, arguments);
    setTimeout(ngV053RefreshWeightedEditors, 0);
    return result;
  };
}

ngV053SetVersionLabels();
ngV053RefreshWeightedEditors();
