import { cn } from './Panel';

interface ToggleProps {
  label?: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  className?: string;
}

/**
 * Custom toggle switch.
 */
export const Toggle: React.FC<ToggleProps> = ({ label, enabled, onChange, className }) => {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      {label && <span className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</span>}
      <button
        onClick={() => onChange(!enabled)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-1 focus:ring-accent-blue",
          enabled ? "bg-accent-blue" : "bg-bg-elevated"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
            enabled ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
    </div>
  );
};
