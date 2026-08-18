await import('./index.js');

function polishNovelGenerationUi() {
  const toggle = document.getElementById('ng-drawer-toggle');
  if (toggle && toggle.dataset.ngPropagationGuard !== '1') {
    toggle.dataset.ngPropagationGuard = '1';
    const stopAtDrawer = event => event.stopPropagation();
    toggle.addEventListener('click', stopAtDrawer, true);
    toggle.addEventListener('keydown', stopAtDrawer, true);
  }

  document.querySelectorAll('#ng-settings .ng-version').forEach(el => {
    el.textContent = 'v0.2.1';
  });

  document.querySelectorAll('[data-ng-size="landscape"] .ng-size-choice span strong, [data-ng-size="landscape"] span strong').forEach(el => {
    el.textContent = 'Horizontal';
  });
}

polishNovelGenerationUi();
new MutationObserver(polishNovelGenerationUi).observe(document.documentElement, { childList: true, subtree: true });
