// Novel Generation v0.3.1 runtime loader.
// The implementation is split into ordered classic scripts so Safari/iOS can
// fail safely without blocking SillyTavern startup. Provider adapters are loaded
// before v030-08.js mounts/binds the UI, allowing v0.3.1 to replace the older
// compatibility handlers deterministically.
const NG_V031_PARTS = [
  'v030-01.js', 'v030-02.js', 'v030-03.js', 'v030-04.js',
  'v030-05.js', 'v030-06.js', 'v030-07.js',
  'v031-09.js', 'v031-10.js',
  'v030-08.js',
];

async function loadNovelGenerationV031() {
  if (globalThis.__novelGenerationV031Ready || globalThis.__novelGenerationV031Loading) return;
  globalThis.__novelGenerationV031Loading = true;
  try {
    for (const part of NG_V031_PARTS) {
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
    globalThis.__novelGenerationV031Ready = true;
  } finally {
    globalThis.__novelGenerationV031Loading = false;
  }
}

void loadNovelGenerationV031().catch(error => {
  console.error('[Novel Generation] v0.3.1 runtime failed to load safely:', error);
});
