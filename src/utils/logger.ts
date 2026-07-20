/**
 * Custom logger that respects dev/prod environments.
 */

const isDev = import.meta.env.DEV;

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
