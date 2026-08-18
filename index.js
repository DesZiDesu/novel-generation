// Novel Generation v0.5.1 runtime loader.
// Restores the proven v0.4 UI/runtime and adds v0.5.1 features as an additive
// layer instead of replacing the established drawer, wand menu, or Studio.
const NG_V051_PARTS = [
  'v030-01.js', 'v030-02.js', 'v030-03.js', 'v030-04.js',
  'v030-05.js', 'v030-06.js', 'v030-07.js',
  'v031-09.js', 'v031-10.js',
  'v030-08.js',
  'v040-11.js',
  'v051-12.js',
];

async function loadNovelGenerationV051() {
  if (globalThis.__novelGenerationV051Ready || globalThis.__novelGenerationV051Loading) return;
  globalThis.__novelGenerationV051Loading = true;
  try {
    for (const part of NG_V051_PARTS) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL(`./${part}`, import.meta.url).href;
        script.async = false;
        script.dataset.novelGenerationPart = part;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${part}`));
        (document.head || document.documentElement).appendChild(script);
      });
    }
    globalThis.__novelGenerationV051Ready = true;
  } finally {
    globalThis.__novelGenerationV051Loading = false;
  }
}

void loadNovelGenerationV051().catch(error => {
  console.error('[Novel Generation] v0.5.1 runtime failed to load safely:', error);
});
