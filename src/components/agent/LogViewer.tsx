import { useRef, useEffect, useCallback, useState } from 'react';
import { useLogStore, type LogLevel } from '../../store/logStore';
import { CheckCircle, Warning, XCircle, Info, Trash, ArrowDown } from '@phosphor-icons/react';

const LEVEL_CONFIG: Record<LogLevel, { Icon: React.FC<any>; color: string; bg: string }> = {
  success: { Icon: CheckCircle, color: 'text-accent-green', bg: 'bg-accent-green/10' },
  error:   { Icon: XCircle,   color: 'text-accent-red',   bg: 'bg-accent-red/10' },
  warning: { Icon: Warning,   color: 'text-accent-amber', bg: 'bg-accent-amber/10' },
  info:    { Icon: Info,      color: 'text-accent-blue',  bg: 'bg-accent-blue/10' },
};

const formatTime = (ts: number) => {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

function isNearBottom(el: HTMLElement, threshold = 80): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

export const LogViewer: React.FC = () => {
  const entries = useLogStore((s) => s.entries);
  const clear = useLogStore((s) => s.clear);
  const scrollRef = useRef<HTMLDivElement>(null);
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
    if (!scrollRef.current || !pinnedRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [entries.length]);

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
          {entries.length} entries
        </span>
        <button
          onClick={clear}
          className="text-text-tertiary hover:text-accent-red transition-colors p-1 rounded"
          title="Clear logs"
        >
          <Trash size={14} />
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-1"
      >
        {entries.length === 0 && (
          <div className="h-full flex items-center justify-center text-center opacity-20">
            <p className="text-[10px] uppercase tracking-widest text-text-tertiary">No log entries yet</p>
          </div>
        )}
        {[...entries].reverse().map((entry) => {
          const { Icon, color, bg } = LEVEL_CONFIG[entry.level];
          return (
            <div
              key={entry.id}
              className={`flex items-start gap-2 px-2 py-1.5 rounded text-[11px] leading-snug ${bg}`}
            >
              <Icon size={13} className={`${color} shrink-0 mt-0.5`} weight="regular" />
              <span className="text-text-tertiary font-mono text-[10px] shrink-0 mt-px">
                {formatTime(entry.timestamp)}
              </span>
              <span className="text-text-secondary break-all">{entry.message}</span>
            </div>
          );
        })}
      </div>

      {/* Jump-to-latest button */}
      <button
        onClick={scrollToBottom}
        aria-label="Jump to latest log"
        style={{
          opacity: showJump ? 1 : 0,
          pointerEvents: showJump ? 'auto' : 'none',
          transform: showJump ? 'translateY(0) scale(1)' : 'translateY(6px) scale(0.9)',
          transition: 'opacity 0.2s ease, transform 0.2s ease',
        }}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-bg-elevated border border-border shadow-lg text-[11px] font-medium text-text-secondary hover:text-text-primary hover:border-accent-blue/60 hover:bg-bg-elevated/90"
      >
        <ArrowDown size={12} weight="bold" />
        Latest
      </button>
    </div>
  );
};
