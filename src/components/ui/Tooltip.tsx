import { useState } from 'react';
import { cn } from './Panel';
import { AnimatePresence, motion } from 'framer-motion';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Hover tooltip with design system rules.
 */
export const Tooltip: React.FC<TooltipProps> = ({ content, children, className }) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div
      className={cn("relative inline-block", className)}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className="absolute z-50 px-2 py-1 text-[10px] bg-bg-elevated border border-border text-text-primary rounded-tooltip whitespace-nowrap pointer-events-none -top-8 left-1/2 -translate-x-1/2"
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
