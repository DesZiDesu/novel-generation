// Novel Generation v0.5.2 runtime loader.
// Keeps the restored classic v0.4/v0.5.1 UI/runtime and loads v0.5.2 as a
// final additive layer for mobile image viewing/saving and custom-size tools.
const NG_V052_PARTS = [
  'v030-01.js', 'v030-02.js', 'v030-03.js', 'v030-04.js',
  'v030-05.js', 'v030-06.js', 'v030-07.js',
  'v031-09.js', 'v031-10.js',
  'v030-08.js',
  'v040-11.js',
  'v051-12.js',
  'v052-13.js',
];

async function loadNovelGenerationV052() {
  if (globalThis.__novelGenerationV052Ready || globalThis.__novelGenerationV052Loading) return;
  globalThis.__novelGenerationV052Loading = true;
  try {
    for (const part of NG_V052_PARTS) {
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
    globalThis.__novelGenerationV052Ready = true;
  } finally {
    globalThis.__novelGenerationV052Loading = false;
  }
}

void loadNovelGenerationV052().catch(error => {
  console.error('[Novel Generation] v0.5.2 runtime failed to load safely:', error);
});
