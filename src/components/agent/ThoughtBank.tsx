/**
 * Scrolling stream of agent thoughts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from '../ui/Badge';
import { Syringe, ArrowDown } from '@phosphor-icons/react';
import { STRINGS } from '../../constants/strings';

function isNearBottom(el: HTMLElement, threshold = 80): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

export const ThoughtBank: React.FC = () => {
  const { thoughts, currentThought } = useAgentStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const displayedLengthRef = useRef(0);
  const [displayedText, setDisplayedText] = useState('');
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const near = isNearBottom(scrollRef.current);
    pinnedRef.current = near;
    setShowJump(!near);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    pinnedRef.current = true;
    setShowJump(false);
  }, []);

  useEffect(() => {
    if (currentThought.length <= displayedLengthRef.current) {
      displayedLengthRef.current = 0;
      setDisplayedText('');
    }

    const target = currentThought;
    const interval = setInterval(() => {
      if (displayedLengthRef.current < target.length) {
        displayedLengthRef.current++;
        setDisplayedText(target.slice(0, displayedLengthRef.current));
      } else {
        clearInterval(interval);
      }
    }, 15);

    return () => clearInterval(interval);
  }, [currentThought]);

  useEffect(() => {
    if (!scrollRef.current || !pinnedRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thoughts, displayedText]);

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        <AnimatePresence initial={false}>
          {displayedText && (
            <div className="group mb-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-mono text-text-tertiary">
                  [LIVE]
                </span>
              </div>
              <p className="text-[13px] font-serif leading-relaxed text-text-primary">
                {displayedText}
                <motion.span
                  animate={{ opacity: [0, 1, 0] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                  className="inline-block w-1 h-3 ml-0.5 bg-accent-blue"
                />
              </p>
            </div>
          )}

          {thoughts.map((thought) => (
            <motion.div
              key={thought.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
              className="group"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-mono text-text-tertiary">
                  [{new Date(thought.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]
                </span>
                {thought.isInjected && (
                  <Syringe size={12} className="text-accent-purple" weight="bold" />
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <p className="text-[13px] font-serif leading-relaxed text-text-primary">
                  {thought.text}
                </p>

                {thought.outcome && (
                  <Badge variant="outline" className="w-fit border-border-subtle bg-bg-elevated/50">
                    {thought.outcome}
                  </Badge>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {thoughts.length === 0 && !displayedText && (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-20">
            <p className="text-xs font-serif italic text-text-tertiary">{STRINGS.AGENT.VOID_SILENT}</p>
          </div>
        )}
      </div>

      {/* Jump-to-latest button */}
      <button
        onClick={scrollToBottom}
        aria-label="Jump to latest thought"
        style={{
          opacity: showJump ? 1 : 0,
          pointerEvents: showJump ? 'auto' : 'none',
          transform: showJump ? 'translateY(0) scale(1)' : 'translateY(6px) scale(0.9)',
          transition: 'opacity 0.2s ease, transform 0.2s ease',
        }}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-bg-elevated border border-border shadow-lg text-[11px] font-medium text-text-secondary hover:text-text-primary hover:border-accent-blue/60 hover:bg-bg-elevated/90 z-10"
      >
        <ArrowDown size={12} weight="bold" />
        Latest
      </button>
    </div>
  );
};
