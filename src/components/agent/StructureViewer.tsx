
import React, { useEffect, useState, useRef } from 'react';
import { useUIStore } from '../../store/uiStore';
import { Cube, Bone, Info } from '@phosphor-icons/react';
import * as THREE from 'three';

export const StructureViewer: React.FC = () => {
  const { selectedEntityId } = useUIStore();
  const [entityData, setEntityData] = useState<any>(null);
  // Track whether the user is actively typing in the name input
  const isRenamingRef = useRef(false);

  useEffect(() => {
    if (!selectedEntityId) {
      setEntityData(null);
      return;
    }

    const interval = setInterval(() => {
      const worldEngine = (window as any)._synthia_world_engine;
      if (!worldEngine) return;

      const scene = worldEngine.getScene();
      let found: THREE.Object3D | null = null;
      scene.traverse((obj: THREE.Object3D) => {
        if (obj.uuid === selectedEntityId) {
          found = obj;
        }
      });

      if (found) {
        const isHumanoid = (found as THREE.Object3D).name.toLowerCase().includes('mixamo') ||
                    (found as THREE.Object3D).userData.isBone ||
                    (!!(found as THREE.Object3D).userData.isSynthiaPrimitive && !(found as THREE.Object3D).userData.objectId);

        const data: any = {
          // Only update name from scene if user is NOT actively renaming it
          name: isRenamingRef.current
            ? undefined  // will be merged below
            : ((found as THREE.Object3D).name || 'Unnamed Entity'),
          type: (found as THREE.Object3D).type,
          objectId: (found as THREE.Object3D).userData.objectId,
          position: (found as THREE.Object3D).position.clone(),
          rotation: (found as THREE.Object3D).rotation.clone(),
          isHumanoid,
          bones: []
        };

        if (isHumanoid) {
          const bones: any[] = [];
          (found as THREE.Object3D).traverse((child) => {
            if ((child as any).isBone || child.name.toLowerCase().includes('mixamo')) {
              bones.push({
                name: child.name,
                rotation: [
                  THREE.MathUtils.radToDeg(child.rotation.x).toFixed(1),
                  THREE.MathUtils.radToDeg(child.rotation.y).toFixed(1),
                  THREE.MathUtils.radToDeg(child.rotation.z).toFixed(1)
                ]
              });
            }
          });
          data.bones = bones;
        } else {
          data.physics = (found as THREE.Object3D).userData.physics || {
            mass: 1.0,
            friction: 0.5,
            restitution: 0.3
          };
        }

        // Merge: preserve the user's in-progress name if they are typing
        setEntityData((prev: any) => ({
          ...data,
          name: isRenamingRef.current && prev ? prev.name : data.name,
        }));
      }
    }, 100);

    return () => clearInterval(interval);
  }, [selectedEntityId]);


  if (!selectedEntityId || !entityData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-tertiary p-8 text-center">
        <Cube size={48} weight="thin" className="mb-4 opacity-20" />
        <p className="text-xs font-mono uppercase tracking-widest">No Entity Selected</p>
        <p className="text-[10px] mt-2 leading-relaxed">Click an object in the world to view its structure and properties.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-border bg-bg-elevated/30">
        <div className="flex items-center gap-2 mb-1">
          {entityData.isHumanoid ? <Bone size={16} className="text-accent-blue" /> : <Cube size={16} className="text-accent-blue" />}
          <input
            type="text"
            className="text-xs font-bold bg-transparent border-b border-transparent focus:border-accent-blue outline-none uppercase tracking-tight flex-1"
            value={entityData.name ?? ''}
            onChange={(e) => setEntityData({ ...entityData, name: e.target.value })}
            onFocus={() => { isRenamingRef.current = true; }}
            onBlur={(e) => {
              isRenamingRef.current = false;
              if (entityData.objectId) {
                window.dispatchEvent(new CustomEvent('synthia:rename', { detail: { id: entityData.objectId, name: e.target.value } }));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
              if (e.key === 'Escape') {
                isRenamingRef.current = false;
                e.currentTarget.blur();
              }
            }}
            readOnly={entityData.isHumanoid}
            title={entityData.isHumanoid ? "Cannot rename humanoid" : "Click to rename"}
          />
        </div>
        <p className="text-[10px] text-text-tertiary font-mono">UUID: {selectedEntityId.split('-')[0]}...</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <section>
          <h4 className="text-[10px] font-bold text-text-secondary uppercase mb-2 flex items-center gap-1">
            <Info size={12} /> Transform
          </h4>
          <div className="grid grid-cols-3 gap-2">
            {['x', 'y', 'z'].map((axis) => (
              <div key={axis} className="bg-bg-elevated p-1.5 rounded border border-border/50 text-center">
                <div className="text-[8px] text-text-tertiary uppercase font-bold">{axis}</div>
                <div className="text-[10px] font-mono">{(entityData.position as any)[axis].toFixed(2)}</div>
              </div>
            ))}
          </div>
        </section>

        {entityData.isHumanoid ? (
          <section>
            <h4 className="text-[10px] font-bold text-text-secondary uppercase mb-2 flex items-center gap-1">
              <Bone size={12} /> Bone Hierarchy ({entityData.bones.length})
            </h4>
            <div className="space-y-1">
              {entityData.bones.map((bone: any, i: number) => (
                <div key={i} className="text-[9px] bg-bg-elevated/50 p-2 rounded border border-border/30 group hover:border-accent-blue/30 transition-colors">
                  <div className="font-bold text-text-primary mb-1 truncate">{bone.name.replace('mixamorig', '')}</div>
                  <div className="flex gap-2 text-text-tertiary font-mono">
                    <span>{bone.rotation[0]}°</span>
                    <span>{bone.rotation[1]}°</span>
                    <span>{bone.rotation[2]}°</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <>
            <section>
              <h4 className="text-[10px] font-bold text-text-secondary uppercase mb-2 flex items-center gap-1">
                <Cube size={12} /> Physics Properties
              </h4>
              <div className="space-y-2">
                {Object.entries(entityData.physics || {}).map(([key, value]: [string, any]) => (
                  <div key={key} className="flex justify-between items-center bg-bg-elevated/50 p-2 rounded border border-border/30">
                    <span className="text-[10px] text-text-tertiary uppercase font-bold">{key}</span>
                    <input
                      type="number"
                      step={key === 'mass' ? 0.1 : 0.05}
                      min={0}
                      className="text-[10px] font-mono bg-transparent text-right w-16 outline-none border-b border-transparent focus:border-accent-blue"
                      value={value}
                      onChange={(e) => {
                        const num = parseFloat(e.target.value);
                        if (!isNaN(num)) {
                          setEntityData((prev: any) => ({
                            ...prev,
                            physics: { ...prev.physics, [key]: num }
                          }));
                          if (entityData.objectId) {
                            window.dispatchEvent(new CustomEvent('synthia:updatePhysics', {
                              detail: { id: entityData.objectId, updates: { [key]: num } }
                            }));
                          }
                        }
                      }}
                    />
                  </div>
                ))}
              </div>
            </section>

            <section className="pt-4 mt-auto">
              <button
                onClick={() => {
                  if (entityData.objectId) {
                    window.dispatchEvent(new CustomEvent('synthia:deleteObject', {
                      detail: { id: entityData.objectId }
                    }));
                  }
                }}
                className="w-full py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 rounded text-[10px] font-bold uppercase tracking-widest transition-colors"
              >
                Delete Object
              </button>
            </section>
          </>
        )}
      </div>
    </div>
  );
};
