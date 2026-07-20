import { Toaster } from 'sonner';
import { useLogStore } from '../../store/logStore';

/**
 * Custom Toast Provider configuring Sonner (minimal, for overflow/fallback only).
 */
export const ToastProvider = () => {
  return (
    <Toaster
      position="bottom-right"
      theme="dark"
      visibleToasts={0}
      toastOptions={{
        className: "!bg-bg-elevated !border-border !text-text-primary !rounded-btn !shadow-none !p-3",
        closeButton: true,
        duration: 4000,
        classNames: {
          toast: 'synthia-toast',
          closeButton: 'synthia-toast-close'
        }
      }}
    />
  );
};

/**
 * Helper to strip detailed logs (like JSON or long stack traces) from the UI message.
 */
const getUiMessage = (msg: string) => {
  const parts = msg.split(' — ');
  return parts[0];
};

/**
 * Typed toast helper — stores all messages in the log panel.
 * No visual popups; everything goes to the Log tab.
 */
export const synthiaToast = {
  success: (msg: string) => {
    console.log(`%c[LOG ✅ SUCCESS] ${msg}`, 'color: #4ade80; font-weight: bold;');
    useLogStore.getState().addEntry(getUiMessage(msg), 'success');
  },
  warning: (msg: string) => {
    console.warn(`%c[LOG ⚠️ WARNING] ${msg}`, 'color: #fbbf24; font-weight: bold;');
    useLogStore.getState().addEntry(getUiMessage(msg), 'warning');
  },
  error: (msg: string) => {
    console.error(`[LOG ❌ ERROR] ${msg}`);
    useLogStore.getState().addEntry(getUiMessage(msg), 'error');
  },
  info: (msg: string) => {
    console.info(`%c[LOG ℹ️ INFO] ${msg}`, 'color: #60a5fa; font-weight: bold;');
    useLogStore.getState().addEntry(getUiMessage(msg), 'info');
  },
};
