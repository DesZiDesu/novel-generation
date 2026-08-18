// Novel Generation v0.4.0 runtime loader.
// Core v0.3/v0.3.1 parts remain ordered classic scripts for Safari/iOS startup
// safety. v0.4.0 is a single feature layer loaded after the stable core mounts.
const NG_V040_PARTS = [
  'v030-01.js', 'v030-02.js', 'v030-03.js', 'v030-04.js',
  'v030-05.js', 'v030-06.js', 'v030-07.js',
  'v031-09.js', 'v031-10.js',
  'v030-08.js',
  'v040-11.js',
];

async function loadNovelGenerationV040() {
  if (globalThis.__novelGenerationV040Ready || globalThis.__novelGenerationV040Loading) return;
  globalThis.__novelGenerationV040Loading = true;
  try {
    for (const part of NG_V040_PARTS) {
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
    globalThis.__novelGenerationV040Ready = true;
  } finally {
    globalThis.__novelGenerationV040Loading = false;
  }
}

void loadNovelGenerationV040().catch(error => {
  console.error('[Novel Generation] v0.4.0 runtime failed to load safely:', error);
});
