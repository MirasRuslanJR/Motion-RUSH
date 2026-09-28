/** Hidden developer panel: add ?debug=1 to the URL. */
export const DEBUG = (() => {
  try {
    return new URLSearchParams(window.location.search).has('debug');
  } catch {
    return false;
  }
})();

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function isCameraApiAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}
