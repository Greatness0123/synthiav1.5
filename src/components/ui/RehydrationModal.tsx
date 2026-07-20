/**
 * Startup modal showing rehydration summary from the AI agent.
 */

import React, { useEffect, useState } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { useConnectionStore } from '../../store/connectionStore';
import { motion } from 'framer-motion';

export const RehydrationModal: React.FC = () => {
  const { rehydrationSummary, hasRehydrated } = useAgentStore();
  const { status } = useConnectionStore();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (status === 'connected' && !hasRehydrated) {
      setIsVisible(true);
    }
  }, [status, hasRehydrated]);

  useEffect(() => {
    if (hasRehydrated) {
      // Fade out after a short delay
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [hasRehydrated]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-bg-primary/90 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 1.05 }}
        className="max-w-lg w-full p-8"
      >
        <div className="flex flex-col items-center text-center space-y-6">
          <motion.div
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-12 h-12 rounded-full border-2 border-accent-blue flex items-center justify-center"
          >
            <div className="w-2 h-2 bg-accent-blue rounded-full" />
          </motion.div>

          <h2 className="text-xl font-serif text-text-primary tracking-tight">
            SYNTHIA is waking up...
          </h2>

          <div className="w-full min-h-[100px] p-4 bg-bg-elevated/50 border border-border rounded-panel text-left">
            <p className="text-sm font-serif leading-relaxed text-text-secondary italic">
              {rehydrationSummary || "Consulting long-term memory archives..."}
              {!hasRehydrated && (
                <motion.span
                  animate={{ opacity: [0, 1, 0] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                  className="inline-block w-1 h-3 ml-1 bg-accent-blue"
                />
              )}
            </p>
          </div>

          {hasRehydrated && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-[10px] font-mono text-accent-green uppercase tracking-widest"
            >
              Rehydration Complete
            </motion.p>
          )}
        </div>
      </motion.div>
    </div>
  );
};
