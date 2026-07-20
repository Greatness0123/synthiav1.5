import { cn } from './Panel';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'outline' | 'accent' | 'tertiary';
}

/**
 * Status badges for metrics and labels.
 */
export const Badge: React.FC<BadgeProps> = ({
  children,
  className,
  variant = 'default',
  ...props
}) => {
  const variants = {
    default: "bg-bg-elevated text-text-secondary border-transparent",
    outline: "bg-transparent border-border text-text-secondary",
    accent: "bg-accent-blue/10 border-accent-blue/20 text-accent-blue",
    tertiary: "bg-transparent text-text-tertiary border-transparent",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded-badge text-[10px] font-mono border uppercase tracking-wider",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};
