/**
 * Utility to debounce toast notifications.
 */

const toastDebounce = new Map<string, number>();

export function debouncedToast(key: string, fn: () => void, ms = 5000) {
  const last = toastDebounce.get(key) ?? 0;
  if (Date.now() - last > ms) {
    toastDebounce.set(key, Date.now());
    fn();
  }
}
