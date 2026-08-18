// Novel Generation v0.3 runtime loader.
// The implementation is split into ordered classic scripts so the feature module
// stays small and Safari/iOS can fail safely without blocking SillyTavern startup.
const NG_V030_PARTS = [
  'v030-01.js', 'v030-02.js', 'v030-03.js', 'v030-04.js',
  'v030-05.js', 'v030-06.js', 'v030-07.js', 'v030-08.js',
];

async function loadNovelGenerationV030() {
  if (globalThis.__novelGenerationV030Ready || globalThis.__novelGenerationV030Loading) return;
  globalThis.__novelGenerationV030Loading = true;
  try {
    for (const part of NG_V030_PARTS) {
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
    globalThis.__novelGenerationV030Ready = true;
  } finally {
    globalThis.__novelGenerationV030Loading = false;
  }
}

void loadNovelGenerationV030().catch(error => {
  console.error('[Novel Generation] v0.3 runtime failed to load safely:', error);
});
