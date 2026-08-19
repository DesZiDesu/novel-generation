// Novel Generation v0.5.5 runtime loader.
// Versioned runtime parts live under runtime/parts/ to keep the repository root clean.
const NG_V055_PARTS = [
  'runtime/parts/v030-01.js', 'runtime/parts/v030-02.js', 'runtime/parts/v030-03.js', 'runtime/parts/v030-04.js',
  'runtime/parts/v030-05.js', 'runtime/parts/v030-06.js', 'runtime/parts/v030-07.js',
  'runtime/parts/v031-09.js', 'runtime/parts/v031-10.js',
  'runtime/parts/v030-08.js',
  'runtime/parts/v040-11.js',
  'runtime/parts/v051-12.js',
  'runtime/parts/v052-13.js',
  'runtime/parts/v053-14.js',
  'runtime/parts/v055-15.js',
];

async function loadNovelGenerationV055() {
  if (globalThis.__novelGenerationV055Ready || globalThis.__novelGenerationV055Loading) return;
  globalThis.__novelGenerationV055Loading = true;
  try {
    for (const part of NG_V055_PARTS) {
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
    globalThis.__novelGenerationV055Ready = true;
  } finally {
    globalThis.__novelGenerationV055Loading = false;
  }
}

void loadNovelGenerationV055().catch(error => {
  console.error('[Novel Generation] v0.5.5 runtime failed to load safely:', error);
});
