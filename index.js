// Novel Generation consolidated runtime loader.
const NG_RUNTIME_FILE = 'runtime/novel-generation.js';
async function loadNovelGenerationRuntime() {
  if (globalThis.__novelGenerationRuntimeReady || globalThis.__novelGenerationRuntimeLoading) return;
  globalThis.__novelGenerationRuntimeLoading = true;
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('./' + NG_RUNTIME_FILE, import.meta.url).href;
      script.async = false;
      script.dataset.novelGenerationPart = NG_RUNTIME_FILE;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load ' + NG_RUNTIME_FILE));
      (document.head || document.documentElement).appendChild(script);
    });
    globalThis.__novelGenerationRuntimeReady = true;
  } finally {
    globalThis.__novelGenerationRuntimeLoading = false;
  }
}
void loadNovelGenerationRuntime().catch(error => {
  console.error('[Novel Generation] consolidated runtime failed to load safely:', error);
});
