/**
 * Controls for the agent's physical body.
 */

import { useWorldStore } from '../../store/worldStore';
import { BODY_TYPE_CONFIGS } from '../../constants/bodyTypes';
import { Button } from '../ui/Button';
import { Slider } from '../ui/Slider';
import { STRINGS } from '../../constants/strings';
import type { BodyType } from '../../types/world';

export const BodyControls: React.FC = () => {
  const {
    bodyType,
    setBodyType,
    bodyMode,
    setBodyMode,
    simplifiedSkeleton,
    setSimplifiedSkeleton,
    showDebugJoints,
    setShowDebugJoints,
    showAICameraHelper,
    setShowAICameraHelper,
    showAIPiP,
    setShowAIPiP,
    showCapsuleDebug,
    setShowCapsuleDebug,
    movementSmoothing,
    setMovementSmoothing,
    useMultiBodyPD,
    setUseMultiBodyPD,
    useProcedural,
    setUseProcedural,
  } = useWorldStore();

  const handleResetPose = () => {
    window.dispatchEvent(new CustomEvent('synthia:resetPose'));
  };

  return (
    <div className="p-4 border-t border-border">
      <h3 className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest mb-4">
        {STRINGS.GOD_MODE.BODY}
      </h3>

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-2">
          {Object.values(BODY_TYPE_CONFIGS).map((config) => {
            const isDisabled = config.id !== 'humanoid';
            return (
              <button
                key={config.id}
                disabled={isDisabled}
                title={isDisabled ? "Coming in a future update" : undefined}
                onClick={() => setBodyType(config.id as BodyType)}
                className={`text-left px-3 py-2 rounded-btn text-xs border transition-all ${
                  bodyType === config.id
                    ? "border-accent-blue bg-accent-blue/5 text-text-primary"
                    : isDisabled
                      ? "border-border text-text-tertiary/40 cursor-not-allowed"
                      : "border-border text-text-tertiary hover:border-text-tertiary"
                }`}
              >
                {config.name}
              </button>
            );
          })}
        </div>

        <div className="flex gap-2 p-1 bg-bg-elevated rounded-btn">
          {(['rigid', 'ragdoll'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setBodyMode(mode)}
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase rounded-badge transition-all ${
                bodyMode === mode
                  ? "bg-bg-panel text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between py-1">
          <label className="text-[10px] uppercase tracking-wider text-text-tertiary">Full Skeleton (Experimental)</label>
          <button
            onClick={() => setSimplifiedSkeleton(!simplifiedSkeleton)}
            className={`w-8 h-4 rounded-full transition-colors relative ${!simplifiedSkeleton ? 'bg-accent-blue' : 'bg-bg-elevated'}`}
          >
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${!simplifiedSkeleton ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between py-1">
          <label className="text-[10px] uppercase tracking-wider text-text-tertiary">Joint Debug Markers</label>
          <button
            onClick={() => setShowDebugJoints(!showDebugJoints)}
            className={`w-8 h-4 rounded-full transition-colors relative ${showDebugJoints ? 'bg-accent-blue' : 'bg-bg-elevated'}`}
          >
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${showDebugJoints ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between py-1">
          <label className="text-[10px] uppercase tracking-wider text-text-tertiary">Show Capsule Collider</label>
          <button
            onClick={() => setShowCapsuleDebug(!showCapsuleDebug)}
            className={`w-8 h-4 rounded-full transition-colors relative ${showCapsuleDebug ? 'bg-accent-blue' : 'bg-bg-elevated'}`}
          >
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${showCapsuleDebug ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between py-1">
          <label className="text-[10px] uppercase tracking-wider text-text-tertiary">Show All Cameras</label>
          <button
            onClick={() => setShowAICameraHelper(!showAICameraHelper)}
            className={`w-8 h-4 rounded-full transition-colors relative ${showAICameraHelper ? 'bg-accent-blue' : 'bg-bg-elevated'}`}
          >
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${showAICameraHelper ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between py-1">
          <label className="text-[10px] uppercase tracking-wider text-text-tertiary">AI PiP View</label>
          <button
            onClick={() => setShowAIPiP(!showAIPiP)}
            className={`w-8 h-4 rounded-full transition-colors relative ${showAIPiP ? 'bg-accent-blue' : 'bg-bg-elevated'}`}
          >
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${showAIPiP ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between py-1">
          <label className="text-[10px] uppercase tracking-wider text-text-tertiary">Procedural Model</label>
          <button
            onClick={() => setUseProcedural(!useProcedural)}
            className={`w-8 h-4 rounded-full transition-colors relative ${useProcedural ? 'bg-accent-blue' : 'bg-bg-elevated'}`}
          >
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${useProcedural ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between py-1">
          <label className="text-[10px] uppercase tracking-wider text-text-tertiary">Multi-Body PD Motors</label>
          <button
            onClick={() => setUseMultiBodyPD(!useMultiBodyPD)}
            className={`w-8 h-4 rounded-full transition-colors relative ${useMultiBodyPD ? 'bg-accent-blue' : 'bg-bg-elevated'}`}
          >
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${useMultiBodyPD ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>

        <Slider
          label={STRINGS.GOD_MODE.MOVEMENT_SMOOTHING}
          min={0.05}
          max={1.0}
          step={0.01}
          value={movementSmoothing}
          onChange={(e) => setMovementSmoothing(parseFloat(e.target.value))}
        />

        <Button variant="secondary" size="sm" className="w-full text-[10px] uppercase tracking-widest" onClick={handleResetPose}>
          {STRINGS.GOD_MODE.RESET_POSE}
        </Button>
      </div>
    </div>
  );
};
