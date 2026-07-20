/**
 * Custom logger that respects dev/prod environments.
 */

// Use bracket notation to safely access env property during testing/builds without TS errors
const isDev = typeof import.meta !== 'undefined' && (import.meta as any)['env'] ? (import.meta as any)['env'].DEV : true;

export const logger = {
  log: (...args: unknown[]) => {
    if (isDev) console.log('[SYNTHIA]', ...args);
  },
  warn: (...args: unknown[]) => {
    if (isDev) console.warn('[SYNTHIA]', ...args);
  },
  error: (...args: unknown[]) => {
    if (isDev) console.error('[SYNTHIA]', ...args);
  },
  info: (...args: unknown[]) => {
    if (isDev) console.info('[SYNTHIA]', ...args);
  }
};
