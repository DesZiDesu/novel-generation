// Startup-safe loader for Novel Generation v0.7.5.
// Version the feature-module URL so SillyTavern/iOS cannot reuse a stale
// extension runtime after GitHub reports that an update completed.
void import('./index.js?ng-version=0.7.5').catch((error) => {
  console.error('[Novel Generation] Feature module failed to load safely:', error);
});
