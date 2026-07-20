/**
 * Header for the agent panel showing status and progression.
 */

import { useAgentStore } from '../../store/agentStore';
import { SKILL_RUNGS } from '../../constants/progressionLadder';
import { Badge } from '../ui/Badge';
import { Brain, ChartLineUp, Pulse } from '@phosphor-icons/react';
import { motion, useAnimation } from 'framer-motion';
import { useEffect } from 'react';
import { STRINGS } from '../../constants/strings';

export const AgentStatus: React.FC = () => {
  const { status, currentRung, heartbeat, masteredSkills } = useAgentStore();
  const rung = SKILL_RUNGS[currentRung];
  const controls = useAnimation();

  useEffect(() => {
    controls.start({
      boxShadow: [
        '0 0 0px 0px rgba(168, 85, 247, 0)',
        '0 0 15px 2px rgba(168, 85, 247, 0.4)',
        '0 0 0px 0px rgba(168, 85, 247, 0)'
      ],
      scale: [1, 1.02, 1],
      transition: { duration: 0.6 }
    });
  }, [currentRung, controls]);

  return (
    <motion.div
      animate={controls}
      className="p-3 border-b border-border space-y-2 shrink-0 bg-bg-panel"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={20} className="text-accent-purple" weight="light" />
          <h2 className="text-sm font-medium">{STRINGS.AGENT.NAME_LABEL}</h2>
        </div>
        <Badge variant={status === 'thinking' ? 'accent' : 'default'} className="animate-pulse">
          {status}
        </Badge>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-text-tertiary">
            <ChartLineUp size={14} />
            <span className="text-[10px] uppercase font-bold tracking-wider">{STRINGS.AGENT.RUNG_LABEL} {currentRung}</span>
          </div>
          <span className="text-[11px] font-medium text-text-secondary">{rung.name}</span>
        </div>
        <div className="w-full h-1 bg-bg-elevated rounded-full overflow-hidden">
          <div
            className="h-full bg-accent-purple transition-all duration-500"
            style={{ width: `${(currentRung / 9) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1 text-text-tertiary">
          <Pulse size={12} />
          <span className="text-[10px] font-mono">{heartbeat} HB</span>
        </div>
        <div className="flex items-center gap-1 text-text-tertiary">
          <Badge variant="outline" className="lowercase">{STRINGS.AGENT.SKILLS_LOWER(masteredSkills.length)}</Badge>
        </div>
      </div>
    </motion.div>
  );
};
