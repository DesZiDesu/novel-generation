// Novel Generation consolidated runtime loader.
const NG_RUNTIME_VERSION = '0.6.7';
const NG_RUNTIME_FILES = [
  'runtime/novel-generation.js',
  'runtime/image-analysis.js',
];

async function loadNovelGenerationRuntime() {
  if (globalThis.__novelGenerationRuntimeReady || globalThis.__novelGenerationRuntimeLoading) return;
  globalThis.__novelGenerationRuntimeLoading = NG_RUNTIME_VERSION;
  try {
    for (const file of NG_RUNTIME_FILES) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const url = new URL('./' + file, import.meta.url);
        url.searchParams.set('ng-version', NG_RUNTIME_VERSION);
        script.src = url.href;
        script.async = false;
        script.dataset.novelGenerationPart = file;
        script.dataset.novelGenerationVersion = NG_RUNTIME_VERSION;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load ' + file));
        (document.head || document.documentElement).appendChild(script);
      });
    }
    globalThis.__novelGenerationRuntimeReady = NG_RUNTIME_VERSION;
  } finally {
    globalThis.__novelGenerationRuntimeLoading = false;
  }
}

void loadNovelGenerationRuntime().catch(error => {
  console.error('[Novel Generation] consolidated runtime failed to load safely:', error);
});
