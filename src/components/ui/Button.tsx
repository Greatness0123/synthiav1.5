import { cn } from './Panel';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Custom buttons following design system rules.
 */
export const Button: React.FC<ButtonProps> = ({
  children,
  className,
  variant = 'secondary',
  size = 'md',
  ...props
}) => {
  const variantClasses = {
    primary: "bg-text-primary text-bg-primary border-transparent hover:opacity-90",
    secondary: "bg-transparent border border-border text-text-primary hover:bg-bg-hover",
    ghost: "bg-transparent border-transparent text-text-secondary hover:text-text-primary hover:bg-bg-hover",
  };

  const sizes = {
    sm: "px-2 py-1 text-xs",
    md: "px-3 py-1.5 text-sm",
    lg: "px-4 py-2 text-base",
  };

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-btn font-medium transition-all focus:outline-none focus:ring-1 focus:ring-accent-blue disabled:opacity-50 disabled:pointer-events-none",
        variantClasses[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};
