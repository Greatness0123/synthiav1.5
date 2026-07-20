/**
 * Controls for agent directives and goals.
 */

import { useAgentStore } from '../../store/agentStore';
import { useCoordinator } from '../../world/hooks/useCoordinator';
import { Toggle } from '../ui/Toggle';
import { Button } from '../ui/Button';
import { STRINGS } from '../../constants/strings';
import { motion, AnimatePresence } from 'framer-motion';

export const DirectivePanel: React.FC = () => {
  const { directiveMode, setDirectiveMode, currentGoal, setCurrentGoal } = useAgentStore();
  const { sendMessage } = useCoordinator();

  const handleToggle = (enabled: boolean) => {
    const mode = enabled ? 'training' : 'free_will';
    setDirectiveMode(mode);
    sendMessage('set_directive', { mode, goal: currentGoal, agentId: 'agent_a' });
  };

  const handleSetGoal = () => {
    sendMessage('set_directive', { mode: 'training', goal: currentGoal, agentId: 'agent_a' });
  };

  const handleClearGoal = () => {
    setCurrentGoal(null);
    sendMessage('set_directive', { mode: 'free_will', goal: null, agentId: 'agent_a' });
  };

  return (
    <div className="p-4 border-t border-border">
      <h3 className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest mb-4">
        {STRINGS.GOD_MODE.DIRECTIVE}
      </h3>

      <div className="space-y-4">
        <Toggle
          label={STRINGS.GOD_MODE.TRAINING_MODE_LABEL}
          enabled={directiveMode === 'training'}
          onChange={handleToggle}
        />

        <AnimatePresence>
          {directiveMode === 'training' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden space-y-3"
            >
              <textarea
                value={currentGoal || ''}
                onChange={(e) => setCurrentGoal(e.target.value)}
                placeholder="Define training objective..."
                className="w-full h-20 p-2 bg-bg-elevated border border-border rounded-btn text-xs text-text-primary resize-none focus:outline-none focus:ring-1 focus:ring-accent-blue"
              />
              <div className="flex gap-2">
                <Button variant="primary" size="sm" className="flex-1 text-[10px]" onClick={handleSetGoal}>
                  {STRINGS.GOD_MODE.SET_GOAL}
                </Button>
                <Button variant="secondary" size="sm" className="flex-1 text-[10px]" onClick={handleClearGoal}>
                  {STRINGS.GOD_MODE.CLEAR_GOAL}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="text-[10px] font-mono text-text-tertiary">
          STATUS: <span className={directiveMode === 'training' ? 'text-accent-amber' : 'text-accent-green'}>
            {directiveMode === 'training' ? `${STRINGS.GOD_MODE.TRAINING}: ${currentGoal || 'PENDING'}` : STRINGS.GOD_MODE.FREE_WILL}
          </span>
        </div>
      </div>
    </div>
  );
};
