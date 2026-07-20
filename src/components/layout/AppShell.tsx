/**
 * Root layout wrapper defining the application structure.
 */

import { ToastProvider } from '../ui/Toast';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  return (
    <div className="h-screen w-screen bg-bg-primary text-text-primary overflow-hidden font-sans relative">
      {/* Main Viewport - Full Screen */}
      <main className="absolute inset-0 z-0">
        {children}
      </main>

      <ToastProvider />
    </div>
  );
};
