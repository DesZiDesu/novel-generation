// Startup-safe loader for Novel Generation v0.6.8.
// Version the feature-module URL so SillyTavern/iOS cannot reuse a stale
// extension runtime after GitHub reports that an update completed.
void import('./index.js?ng-version=0.6.8').catch((error) => {
  console.error('[Novel Generation] Feature module failed to load safely:', error);
});
