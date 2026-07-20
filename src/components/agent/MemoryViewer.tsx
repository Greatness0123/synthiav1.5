/**
 * Collapsible panel for viewing agent memories.
 */

import { useState, useMemo } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { useUIStore } from '../../store/uiStore';
import { CaretDown, CaretUp, Database, Bookmark, Export } from '@phosphor-icons/react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { STRINGS } from '../../constants/strings';

export const MemoryViewer: React.FC = () => {
  const { memories } = useAgentStore();
  const { setExportModalOpen } = useUIStore();
  const [isExpanded, setIsExpanded] = useState(false);

  const tierBreakdown = useMemo(() => {
    return {
      t1: memories.filter(m => m.tier === 1).length,
      t2: memories.filter(m => m.tier === 2).length,
      t3: memories.filter(m => m.tier === 3).length,
    };
  }, [memories]);

  const getRewardColor = (reward: number) => {
    if (reward >= 0.8) return 'text-accent-green';
    if (reward >= 0.3) return 'text-accent-amber';
    return 'text-accent-red';
  };

  return (
    <div className="border-t border-border shrink-0">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full h-10 px-4 flex items-center justify-between hover:bg-bg-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <Database size={16} className="text-accent-teal" />
          <span className="text-xs font-medium uppercase tracking-wider text-text-secondary">{STRINGS.AGENT.MEMORIES_LABEL}</span>
          <div className="text-[10px] text-text-tertiary font-mono ml-2">
            T1: {tierBreakdown.t1} · T2: {tierBreakdown.t2} · T3: {tierBreakdown.t3}
          </div>
        </div>
        {isExpanded ? <CaretDown size={16} /> : <CaretUp size={16} />}
      </button>

      {isExpanded && (
        <div className="h-[400px] overflow-y-auto p-4 bg-bg-elevated/30 space-y-3 flex flex-col">
          <div className="flex-1 space-y-3">
            {memories.slice(-10).reverse().map((memory) => (
              <div key={memory.id} className="p-3 border border-border-subtle bg-bg-panel rounded-btn space-y-2 relative group">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="tertiary" className="text-[9px]">HB {memory.heartbeat}</Badge>
                    {memory.tier === 1 && (
                      <Bookmark size={12} weight="fill" className="text-accent-teal" />
                    )}
                  </div>
                  <span className={`text-[10px] font-mono font-bold ${getRewardColor(memory.rewardSignal)}`}>
                    {memory.rewardSignal > 0 ? '+' : ''}{memory.rewardSignal.toFixed(1)}
                  </span>
                </div>
                <p className="text-[11px] text-text-secondary leading-normal italic">
                  {memory.summary}
                </p>
              </div>
            ))}
          </div>

          <Button
            variant="secondary"
            size="sm"
            className="w-full mt-4 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest"
            onClick={() => setExportModalOpen(true)}
          >
            <Export size={14} />
            {STRINGS.GOD_MODE.EXPORT_BUTTON}
          </Button>
          {memories.length === 0 && (
            <div className="h-full flex items-center justify-center text-center opacity-20">
              <p className="text-[10px] uppercase tracking-widest text-text-tertiary">{STRINGS.AGENT.NO_MEMORIES}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
