await import('./index.js');

function guardNovelGenerationDrawer() {
  const toggle = document.getElementById('ng-drawer-toggle');
  if (!toggle || toggle.dataset.ngPropagationGuard === '1') return;
  toggle.dataset.ngPropagationGuard = '1';
  const stopAtDrawer = event => event.stopPropagation();
  toggle.addEventListener('click', stopAtDrawer, true);
  toggle.addEventListener('keydown', stopAtDrawer, true);
}

guardNovelGenerationDrawer();
new MutationObserver(guardNovelGenerationDrawer).observe(document.documentElement, { childList: true, subtree: true });
