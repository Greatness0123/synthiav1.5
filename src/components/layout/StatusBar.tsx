import { useConnectionStore } from '../../store/connectionStore';
import { useAgentStore } from '../../store/agentStore';
import { STRINGS } from '../../constants/strings';
import { cn } from '../ui/Panel';

const Metric = ({ label, value, colorClass = "text-text-secondary" }: { label: string, value: string | number, colorClass?: string }) => (
  <div className="flex items-center gap-1.5 px-2.5 h-full border-r border-white/10 last:border-r-0">
    <span className="text-[9px] text-text-tertiary uppercase">{label}</span>
    <span className={cn("text-[10px] font-mono", colorClass)}>{value}</span>
  </div>
);

/**
 * Floating glassmorphic metrics pill at bottom-center of viewport.
 */
export const StatusBar: React.FC = () => {
  const { status, rtt, inferenceTime, frameSize, fps, cycleMs } = useConnectionStore();
  const { heartbeat, lightState } = useAgentStore();

  const getStatusColor = () => {
    switch (status) {
      case 'connected': return 'bg-accent-green';
      case 'connecting': return 'bg-accent-amber';
      case 'error': return 'bg-accent-red';
      default: return 'bg-text-tertiary';
    }
  };

  const getMetricColor = (val: number) => {
    if (val > 4000) return 'text-accent-red';
    if (val > 2000) return 'text-accent-amber';
    return 'text-text-secondary';
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 glassmorphism rounded-full flex items-center h-9 px-1 z-50">
      <div className="flex items-center gap-1.5 px-2.5 border-r border-white/10 h-full">
        <div className={cn("w-1.5 h-1.5 rounded-full", getStatusColor())} />
        <span className="text-[9px] font-mono text-text-secondary uppercase">{status}</span>
      </div>

      <Metric
        label={STRINGS.STATUS.RTT}
        value={rtt != null && rtt > 0 ? `${rtt}ms` : '—'}
        colorClass={getMetricColor(rtt || 0)}
      />
      <Metric
        label={STRINGS.STATUS.INFERENCE}
        value={inferenceTime != null && inferenceTime > 0 ? `${(inferenceTime / 1000).toFixed(2)}s` : '—'}
        colorClass={getMetricColor(inferenceTime || 0)}
      />
      <Metric
        label={STRINGS.STATUS.FRAME}
        value={frameSize != null && frameSize > 0 ? `${(frameSize / 1024).toFixed(1)}KB` : '—'}
      />
      <Metric
        label={STRINGS.STATUS.CYCLE}
        value={cycleMs != null ? `${(cycleMs / 1000).toFixed(1)}s` : '—'}
      />
      <Metric label={STRINGS.STATUS.FPS} value={fps != null && fps > 0 ? Math.round(fps) : '—'} />
      <Metric label={STRINGS.STATUS.HEARTBEAT} value={heartbeat} />
      <Metric label={STRINGS.STATUS.LIGHT} value={lightState.toUpperCase()} />
    </div>
  );
};
