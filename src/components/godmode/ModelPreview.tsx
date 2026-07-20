/**
 * Mini Three.js preview for uploaded GLTF/GLB models.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface ModelPreviewProps {
  scene: THREE.Object3D | null;
  className?: string;
}

export const ModelPreview: React.FC<ModelPreviewProps> = ({ scene, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !scene) return;

    const width = container.clientWidth || 200;
    const height = container.clientHeight || 120;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const previewScene = new THREE.Scene();
    previewScene.background = new THREE.Color(0x111318);

    const clone = scene.clone(true);
    previewScene.add(clone);

    const box = new THREE.Box3().setFromObject(clone);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    clone.position.sub(center);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100);
    camera.position.set(maxDim * 1.8, maxDim * 1.2, maxDim * 2);
    camera.lookAt(0, 0, 0);

    previewScene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(2, 4, 3);
    previewScene.add(dir);

    let frameId = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      clone.rotation.y += 0.008;
      renderer.render(previewScene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      renderer.dispose();
      container.removeChild(renderer.domElement);
      previewScene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    };
  }, [scene]);

  return (
    <div
      ref={containerRef}
      className={className ?? 'w-full h-[120px] rounded-btn overflow-hidden border border-border bg-bg-elevated'}
    />
  );
};
