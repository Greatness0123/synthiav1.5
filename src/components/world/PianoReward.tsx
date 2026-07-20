/**
 * Floating reward indicator for piano notes.
 */

import React from 'react';
import { motion } from 'framer-motion';

interface PianoRewardProps {
  reward: number;
  x: number;
  y: number;
}

export const PianoReward: React.FC<PianoRewardProps> = ({ reward, x, y }) => {
  const isPositive = reward > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: y }}
      animate={{ opacity: 1, y: y - 40 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
      className={`absolute pointer-events-none text-sm font-mono font-bold ${
        isPositive ? 'text-accent-green' : 'text-accent-red'
      }`}
      style={{ left: x, top: y }}
    >
      {isPositive ? `+${reward.toFixed(1)}` : reward.toFixed(1)}
    </motion.div>
  );
};
