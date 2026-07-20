import { cn } from './Panel';

interface SliderProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  value: number;
}

/**
 * Custom range slider with design system styling.
 */
export const Slider: React.FC<SliderProps> = ({ label, className, ...props }) => {
  return (
    <div className={cn("flex flex-col gap-1 w-full", className)}>
      {label && (
        <div className="flex justify-between items-center">
          <span className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</span>
          <span className="text-[10px] font-mono text-text-secondary">{props.value}</span>
        </div>
      )}
      <input
        type="range"
        className="w-full h-1 bg-bg-elevated rounded-full appearance-none cursor-pointer accent-accent-blue"
        {...props}
      />
    </div>
  );
};
