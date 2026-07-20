/**
 * Controls for global physics properties.
 */

import { useWorldStore } from '../../store/worldStore';
import { Slider } from '../ui/Slider';
import { Panel } from '../ui/Panel';
import { STRINGS } from '../../constants/strings';

export const PhysicsControls: React.FC = () => {
  const { 
    gravity, setGravity, 
    globalFriction, setGlobalFriction,
    showFloor, setShowFloor,
    floorColor, setFloorColor,
    skyColor, setSkyColor,
    showGrid, setShowGrid
  } = useWorldStore();

  return (
    <Panel className="p-4 border-none bg-transparent">
      <h3 className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest mb-4">
        {STRINGS.GOD_MODE.PHYSICS}
      </h3>
      <div className="space-y-6">
        <Slider
          label={STRINGS.GOD_MODE.GRAVITY}
          min={-20}
          max={0}
          step={0.1}
          value={gravity}
          onChange={(e) => setGravity(parseFloat(e.target.value))}
        />
        <Slider
          label={STRINGS.GOD_MODE.FRICTION}
          min={0}
          max={1}
          step={0.01}
          value={globalFriction}
          onChange={(e) => setGlobalFriction(parseFloat(e.target.value))}
        />
      </div>

      <h3 className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest mb-4 mt-8">
        Environment
      </h3>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-[10px] uppercase tracking-wider text-text-tertiary">Sky Color</label>
          <input
            type="color"
            value={skyColor}
            onChange={(e) => setSkyColor(e.target.value)}
            className="w-6 h-6 rounded border-none cursor-pointer bg-transparent p-0"
          />
        </div>
        
        <div className="flex items-center justify-between">
          <label className="text-[10px] uppercase tracking-wider text-text-tertiary">Show Floor</label>
          <button
            onClick={() => setShowFloor(!showFloor)}
            className={`w-8 h-4 rounded-full transition-colors relative ${showFloor ? 'bg-accent-blue' : 'bg-bg-elevated'}`}
          >
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${showFloor ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>
        {showFloor && (
          <div className="flex items-center justify-between">
            <label className="text-[10px] uppercase tracking-wider text-text-tertiary">Floor Color</label>
            <input 
              type="color" 
              value={floorColor} 
              onChange={(e) => setFloorColor(e.target.value)}
              className="w-8 h-6 rounded border border-border bg-transparent cursor-pointer"
            />
          </div>
        )}
        <div className="flex items-center justify-between">
          <label className="text-[10px] uppercase tracking-wider text-text-tertiary">Show Grid</label>
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`w-8 h-4 rounded-full transition-colors relative ${showGrid ? 'bg-accent-blue' : 'bg-bg-elevated'}`}
          >
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${showGrid ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>
      </div>
    </Panel>
  );
};
