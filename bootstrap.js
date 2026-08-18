// Startup-safe loader for Novel Generation.
// Important: do not await the feature module here. SillyTavern loads extension
// entry points during its own startup sequence, so a slow or broken feature
// module must never be able to keep the application preloader alive.

void import('./index.js').catch((error) => {
  console.error('[Novel Generation] Feature module failed to load safely:', error);
});
