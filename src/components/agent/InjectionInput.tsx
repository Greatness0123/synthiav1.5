/**
 * Input for injecting thoughts into the agent's stream.
 */

import { useState } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { useCoordinator } from '../../world/hooks/useCoordinator';
import { STRINGS } from '../../constants/strings';
import { Syringe, ArrowRight } from '@phosphor-icons/react';
import { synthiaToast } from '../ui/Toast';

export const InjectionInput: React.FC = () => {
  const [value, setValue] = useState('');
  const { injectionQueue } = useAgentStore();
  const { sendMessage } = useCoordinator();

  const handleInject = () => {
    if (!value.trim()) return;

    sendMessage('inject_thought', { text: value, agentId: 'agent_a' });

    synthiaToast.info(STRINGS.TOASTS.THOUGHT_INJECTED);
    setValue('');
  };

  return (
    <div className="p-4 border-t border-border bg-bg-panel shrink-0">
      {injectionQueue.length > 0 && (
        <div className="mb-2 flex justify-end">
          <span className="text-[9px] font-bold uppercase tracking-tighter text-accent-purple bg-accent-purple/10 px-1.5 py-0.5 rounded-full border border-accent-purple/20">
            {injectionQueue.length} queued
          </span>
        </div>
      )}
      <div className="relative flex items-center">
        <div className="absolute left-3 text-accent-purple">
          <Syringe size={16} weight="regular" />
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleInject()}
          placeholder={STRINGS.AGENT.INJECTION_PLACEHOLDER}
          className="w-full h-10 pl-10 pr-10 bg-bg-elevated border border-border rounded-btn text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent-blue transition-all"
        />
        <button
          onClick={handleInject}
          disabled={!value.trim()}
          className="absolute right-2 p-1.5 text-text-tertiary hover:text-accent-blue disabled:opacity-0 transition-all"
        >
          <ArrowRight size={18} weight="bold" />
        </button>
      </div>
    </div>
  );
};
