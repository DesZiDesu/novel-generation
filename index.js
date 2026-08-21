// Novel Generation consolidated runtime loader.
const NG_RUNTIME_FILES = [
  'runtime/novel-generation.js',
  'runtime/image-analysis.js',
];
async function loadNovelGenerationRuntime() {
  if (globalThis.__novelGenerationRuntimeReady || globalThis.__novelGenerationRuntimeLoading) return;
  globalThis.__novelGenerationRuntimeLoading = true;
  try {
    for (const file of NG_RUNTIME_FILES) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL('./' + file, import.meta.url).href;
        script.async = false;
        script.dataset.novelGenerationPart = file;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load ' + file));
        (document.head || document.documentElement).appendChild(script);
      });
    }
    globalThis.__novelGenerationRuntimeReady = true;
  } finally {
    globalThis.__novelGenerationRuntimeLoading = false;
  }
}
void loadNovelGenerationRuntime().catch(error => {
  console.error('[Novel Generation] consolidated runtime failed to load safely:', error);
});
