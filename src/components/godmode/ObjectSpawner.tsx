/**
 * Overlay for spawning objects into the world.
 */

import { useCallback, useEffect, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useUIStore } from '../../store/uiStore';
import { OBJECT_PRESETS } from '../../constants/objectPresets';
import { Panel } from '../ui/Panel';
import * as Icons from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import { synthiaToast } from '../ui/Toast';
import { STRINGS } from '../../constants/strings';
import { ModelPreview } from './ModelPreview';
import {
  listUploadedModels,
  saveUploadedModel,
  type StoredUploadedModel,
} from '../../utils/uploadedModelsStore';

type Preset = typeof OBJECT_PRESETS[0];
type Category = 'Primitives' | 'Terrain' | 'Interactive' | 'Custom';

export const ObjectSpawner: React.FC = () => {
  const { objectSpawnerOpen, setObjectSpawnerOpen } = useUIStore();
  const [activeCategory, setActiveCategory] = useState<Category>('Primitives');
  const [previewScene, setPreviewScene] = useState<THREE.Object3D | null>(null);
  const [previewDimensions, setPreviewDimensions] = useState<string | null>(null);
  const [pendingModel, setPendingModel] = useState<{
    name: string;
    scene: THREE.Group;
    arrayBuffer: ArrayBuffer;
    isTerrain: boolean;
  } | null>(null);
  const [isTerrain, setIsTerrain] = useState(false);
  const [savedModels, setSavedModels] = useState<StoredUploadedModel[]>([]);

  const loadSavedModels = useCallback(async () => {
    const models = await listUploadedModels();
    setSavedModels(models);
  }, []);

  useEffect(() => {
    if (objectSpawnerOpen) {
      loadSavedModels();
    }
  }, [objectSpawnerOpen, loadSavedModels]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setObjectSpawnerOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setObjectSpawnerOpen]);

  const categories: Category[] = ['Primitives', 'Terrain', 'Interactive', 'Custom'];
  const filteredPresets = OBJECT_PRESETS.filter((p) => p.category === activeCategory);

  const handleSpawn = (preset: Preset) => {
    window.dispatchEvent(new CustomEvent('synthia:spawn', { detail: { presetId: preset.id } }));
    synthiaToast.success(`${preset.name} spawned near the agent`);
  };

  const showSizeWarning = (scene: THREE.Object3D) => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const minDim = Math.min(size.x, size.y, size.z);
    if (maxDim > 20 || minDim < 0.01) {
      synthiaToast.warning('This model is very large/small — you may want to adjust its scale after spawning');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const loader = new GLTFLoader();
      loader.parse(
        arrayBuffer,
        '',
        (gltf) => {
          const scene = gltf.scene as THREE.Group;
          const box = new THREE.Box3().setFromObject(scene);
          const size = box.getSize(new THREE.Vector3());
          setPreviewScene(scene);
          setPreviewDimensions(
            `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} units`
          );
          setPendingModel({
            name: file.name.replace(/\.(glb|gltf)$/i, ''),
            scene,
            arrayBuffer,
            isTerrain,
          });
          showSizeWarning(scene);
        },
        (err) => {
          synthiaToast.error(`Failed to load model: ${err.message}`);
        }
      );
    } catch {
      synthiaToast.error('Could not read uploaded file');
    }
    e.target.value = '';
  };

  const commitUpload = async () => {
    if (!pendingModel) return;
    const id = crypto.randomUUID();
    await saveUploadedModel({
      id,
      name: pendingModel.name,
      arrayBuffer: pendingModel.arrayBuffer,
      uploadedAt: Date.now(),
      isTerrain: pendingModel.isTerrain,
    });
    await loadSavedModels();
    synthiaToast.success(`"${pendingModel.name}" saved to My Uploaded Models`);
  };

  const spawnPending = async (saveFirst: boolean) => {
    if (!pendingModel) return;
    if (saveFirst) await commitUpload();

    window.dispatchEvent(
      new CustomEvent('synthia:spawnCustom', {
        detail: {
          name: pendingModel.name,
          scene: pendingModel.scene.clone(true),
          isTerrain: pendingModel.isTerrain,
        },
      })
    );
    synthiaToast.success(`${pendingModel.name} spawned`);
    setPendingModel(null);
    setPreviewScene(null);
    setPreviewDimensions(null);
  };

  const spawnSavedModel = async (model: StoredUploadedModel) => {
    const loader = new GLTFLoader();
    loader.parse(
      model.arrayBuffer,
      '',
      (gltf) => {
        window.dispatchEvent(
          new CustomEvent('synthia:spawnCustom', {
            detail: {
              name: model.name,
              scene: gltf.scene.clone(true) as THREE.Group,
              isTerrain: model.isTerrain,
            },
          })
        );
        synthiaToast.success(`${model.name} spawned`);
      },
      () => synthiaToast.error('Failed to load saved model')
    );
  };

  if (!objectSpawnerOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-[520px] max-h-[80vh] flex flex-col"
      >
        <Panel className="flex-1 flex flex-col border-border-subtle shadow-2xl">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-widest text-text-secondary">
              {STRINGS.GOD_MODE.OBJECT_SPAWNER_TITLE}
            </h2>
            <button onClick={() => setObjectSpawnerOpen(false)} className="text-text-tertiary hover:text-text-primary">
              <Icons.X size={20} />
            </button>
          </div>

          <div className="flex px-4 border-b border-border bg-bg-elevated/20">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-3 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-all ${
                  activeCategory === cat
                    ? 'border-accent-blue text-text-primary'
                    : 'border-transparent text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {activeCategory === 'Custom' ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <label className="flex flex-col items-center justify-center gap-2 p-6 border border-dashed border-border rounded-btn cursor-pointer hover:border-accent-blue transition-colors">
                <Icons.UploadSimple size={28} className="text-text-tertiary" />
                <span className="text-[10px] font-bold uppercase text-text-secondary">Upload Model (.glb / .gltf)</span>
                <input type="file" accept=".glb,.gltf" onChange={handleFileUpload} className="hidden" />
              </label>

              {pendingModel && (
                <div className="space-y-3 p-3 border border-border rounded-btn bg-bg-elevated/20">
                  <div className="text-[10px] font-bold uppercase text-text-secondary">{pendingModel.name}</div>
                  <ModelPreview scene={previewScene} />
                  {previewDimensions && (
                    <div className="text-[9px] font-mono text-text-tertiary">Dimensions: {previewDimensions}</div>
                  )}
                  <label className="flex items-center gap-2 text-[10px] text-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isTerrain}
                      onChange={(e) => {
                        setIsTerrain(e.target.checked);
                        setPendingModel((prev) => (prev ? { ...prev, isTerrain: e.target.checked } : null));
                      }}
                      className="accent-accent-blue"
                    />
                    This is world terrain
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => spawnPending(false)}
                      className="flex-1 py-2 text-[10px] font-bold uppercase border border-accent-blue rounded-btn text-accent-blue hover:bg-accent-blue/10"
                    >
                      Spawn Now
                    </button>
                    <button
                      onClick={() => spawnPending(true)}
                      className="flex-1 py-2 text-[10px] font-bold uppercase bg-accent-blue rounded-btn text-white hover:bg-accent-blue/90"
                    >
                      Save & Spawn
                    </button>
                  </div>
                </div>
              )}

              {savedModels.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] font-bold uppercase text-text-tertiary">My Uploaded Models</div>
                  {savedModels.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => spawnSavedModel(model)}
                      className="w-full flex items-center gap-3 p-2 border border-border rounded-btn hover:border-accent-blue text-left"
                    >
                      <Icons.FileCloud size={20} className="text-text-tertiary shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="text-[10px] text-text-primary truncate">{model.name}</span>
                        <span className="text-[9px] text-text-tertiary">
                          {model.isTerrain ? 'Terrain' : 'Object'} · {new Date(model.uploadedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-3 gap-3">
              {filteredPresets.map((preset) => {
                const IconComponent = (Icons as unknown as Record<string, Icons.Icon>)[preset.icon] || Icons.Cube;
                return (
                  <button
                    key={preset.id}
                    onClick={() => handleSpawn(preset)}
                    className="group flex flex-col items-center justify-center p-4 border border-border bg-bg-panel rounded-btn hover:border-accent-blue hover:bg-bg-hover transition-all"
                  >
                    <IconComponent size={32} weight="light" className="text-text-tertiary group-hover:text-accent-blue mb-2 transition-colors" />
                    <span className="text-[10px] font-medium text-text-secondary group-hover:text-text-primary">{preset.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Panel>
      </motion.div>
    </div>
  );
};
