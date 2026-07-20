import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utility for merging tailwind classes.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Reusable panel wrapper with consistent borders and background.
 */
export const Panel: React.FC<PanelProps> = ({ children, className, ...props }) => {
  return (
    <div
      className={cn(
        "border border-border bg-bg-panel rounded-panel overflow-hidden",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};
