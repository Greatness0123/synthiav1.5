/**
 * Manages Three.js cameras, modes, and head camera rendering.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { logger as Logger } from '../../utils/logger';

export type CameraMode = 'third_person' | 'first_person' | 'model_input';

export class CameraManager {
  private thirdPersonCamera: THREE.PerspectiveCamera;
  /** Chase / 3rd-person follow cam — positioned behind & above the head */
  private chaseCam: THREE.PerspectiveCamera;
  /** True first-person eye cam — locked to the head bone, used for AI perception AND the 'model_input' display view */
  private aiPerceptionCamera: THREE.PerspectiveCamera;
  private renderTarget: THREE.WebGLRenderTarget;
  private aiRenderTarget: THREE.WebGLRenderTarget;
  private mode: CameraMode = 'third_person';
  private controls: OrbitControls;
  private transformControls: TransformControls;
  private renderer: THREE.WebGLRenderer;

  // Chase cam fixed origin — never moves from this position
  private chaseCamOrigin: THREE.Vector3 = new THREE.Vector3(0, 5, -6);

  // Dedicated AI frame capture (448×448 for Qwen2.5-VL native tile size)
  private static readonly AI_VIEW_SIZE = 448;

  public onDragEnd?: (object: THREE.Object3D) => void;
  public onDragChanged?: (dragging: boolean, object: THREE.Object3D | null) => void;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, canvas: HTMLCanvasElement) {
    this.renderer = renderer;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    this.thirdPersonCamera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    this.thirdPersonCamera.position.set(5, 2, 5);

    // Chase cam: FIXED second-person spectator camera — always faces the AI
    // Does NOT follow — stays at this position permanently.
    // Every frame we update lookAt to track the capsule.
    this.chaseCam = new THREE.PerspectiveCamera(90, width / height, 0.01, 100);
    this.chaseCam.position.set(0, 5, -6);
    this.chaseCam.lookAt(0, 1.5, 0);
    // Store the fixed origin so we don't lose it if anyone overwrites position
    this.chaseCamOrigin = new THREE.Vector3(0, 5, -6);

    // AI eye cam: locked exactly to head bone every frame
    this.aiPerceptionCamera = new THREE.PerspectiveCamera(110, 480 / 270, 0.01, 200);
    // Default position so the PiP shows something before the humanoid loads
    this.aiPerceptionCamera.position.set(0, 1.8, 0.5);
    this.aiPerceptionCamera.lookAt(0, 1.0, 10);

    // PiP display render target (480×270 for UI preview)
    this.renderTarget = new THREE.WebGLRenderTarget(480, 270);

    // Dedicated AI perception render target (448×448 for model input)
    const size = CameraManager.AI_VIEW_SIZE;
    this.aiRenderTarget = new THREE.WebGLRenderTarget(size, size, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });

    this.controls = new OrbitControls(this.thirdPersonCamera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 1, 0);

    this.transformControls = new TransformControls(this.thirdPersonCamera, canvas);
    scene.add(this.transformControls.getHelper());

    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
      const obj = this.transformControls.object;
      if (this.onDragChanged) {
        this.onDragChanged(!!event.value, obj ?? null);
      }
      if (!event.value && obj && this.onDragEnd) {
        this.onDragEnd(obj);
      }
    });
  }

  public update(headMatrix?: THREE.Matrix4, targetPos?: THREE.Vector3, _capsuleQuat?: THREE.Quaternion, capsulePos?: THREE.Vector3): void {
    const isValidVector = (v: THREE.Vector3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

    // ── AI Perception Camera (First-Person) ──────────────────────────
    // The AI perceives the world through this camera. It is locked to the
    // head bone transform so the AI controls its gaze by rotating its head
    // (mixamorighead joint overrides).
    //
    // IMPORTANT: The AI does NOT directly control the camera position or
    // orientation. The camera FOLLOWS the head bone. The only way the AI
    // changes its first-person view is by rotating the head bone.
    // ──────────────────────────────────────────────────────────────────
    if (headMatrix) {
      const headPos = new THREE.Vector3();
      const headQuat = new THREE.Quaternion();
      const headScale = new THREE.Vector3();
      headMatrix.decompose(headPos, headQuat, headScale);

      if (isValidVector(headPos)) {
        // AI Perception Camera: STRICTLY HEAD-LOCKED
        // Position matches the head bone, orientation matches the
        // head bone's world quaternion. No gaze offset is applied —
        // the AI controls its view by rotating the head bone.
        this.aiPerceptionCamera.position.copy(headPos);
        this.aiPerceptionCamera.quaternion.copy(headQuat);
        this.aiPerceptionCamera.up.set(0, 1, 0);
      }

      // ── Chase Cam: FIXED Second-Person Spectator ─────────────────────
      // This camera NEVER moves from its origin position. It simply rotates
      // to always lookAt the capsule's center. This provides a stable
      // second-person view of the AI's body regardless of movement.
      //
      // The chase cam is NOT a tracking/following camera. It is a fixed
      // spectator camera at chaseCamOrigin, always facing the AI.
      // ──────────────────────────────────────────────────────────────────
      let effectiveLookTarget = capsulePos;
      if (!effectiveLookTarget || !isValidVector(effectiveLookTarget)) {
        // Fallback to head position if capsule not available
        if (headMatrix) {
          const hPos = new THREE.Vector3();
          const hQuat = new THREE.Quaternion();
          const hScale = new THREE.Vector3();
          headMatrix.decompose(hPos, hQuat, hScale);
          effectiveLookTarget = hPos;
        }
      }

      if (effectiveLookTarget && isValidVector(effectiveLookTarget)) {
        // Set chase cam to its fixed origin position (never changes)
        this.chaseCam.position.copy(this.chaseCamOrigin);

        // Always look at the humanoid's center (capsule or head position)
        this.chaseCam.up.set(0, 1, 0);
        this.chaseCam.lookAt(effectiveLookTarget.x, effectiveLookTarget.y - 0.5, effectiveLookTarget.z);
      }

    } else if (targetPos) {
      // Fallback for non-humanoids: orbit the perception camera slightly above-behind the object
      this.aiPerceptionCamera.position.set(targetPos.x, targetPos.y + 0.8, targetPos.z + 1.5);
      this.aiPerceptionCamera.lookAt(targetPos);
    } else {
      // No head transform available yet — position AI camera at a reasonable default
      // so the PiP always shows *something* rather than a black void at origin
      if (this.aiPerceptionCamera.position.length() < 0.1) {
        this.aiPerceptionCamera.position.set(0, 1.8, 0.5);
        this.aiPerceptionCamera.lookAt(0, 1.0, 10);
      }
    }

    if (this.mode === 'third_person') {
      if (targetPos) {
        if (isFinite(targetPos.x) && isFinite(targetPos.y) && isFinite(targetPos.z)) {
          this.controls.target.lerp(targetPos, 0.1);
        }
      }
      this.controls.update();
    }
  }

  public renderHeadCamera(scene: THREE.Scene): void {
    const currentRenderTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(scene, this.aiPerceptionCamera);
    this.renderer.setRenderTarget(currentRenderTarget);
  }

  /**
   * Capture a 448×448 WebP frame from the AI perception camera into an offscreen buffer.
   * Returns base64-only string (no data URL prefix).
   * The image is flipped vertically to correct OpenGL bottom-up read.
   */
  public captureAIFrame(scene: THREE.Scene): string {
    const size = CameraManager.AI_VIEW_SIZE;
    const previousTarget = this.renderer.getRenderTarget();

    try {
      // Render head camera into dedicated AI render target
      this.renderer.setRenderTarget(this.aiRenderTarget);
      this.renderer.render(scene, this.aiPerceptionCamera);

      // Read pixels (bottom-up OpenGL convention)
      const pixelBuffer = new Uint8Array(size * size * 4);
      this.renderer.readRenderTargetPixels(this.aiRenderTarget, 0, 0, size, size, pixelBuffer);

      // Restore the previous render target IMMEDIATELY after pixel read.
      // Canvas operations below don't need the render target, and the main
      // renderer.render() call that follows MUST draw to the screen buffer.
      this.renderer.setRenderTarget(previousTarget);

      // Manually flip pixels vertically (OpenGL bottom-up → canvas top-down)
      const bytesPerRow = size * 4;
      const flippedBuffer = new Uint8ClampedArray(size * size * 4);
      for (let y = 0; y < size; y++) {
        const srcOffset = y * bytesPerRow;
        const destOffset = (size - 1 - y) * bytesPerRow;
        flippedBuffer.set(pixelBuffer.subarray(srcOffset, srcOffset + bytesPerRow), destOffset);
      }

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      const imageData = new ImageData(flippedBuffer, size, size);
      ctx.putImageData(imageData, 0, 0);

      // WebP at 0.7 quality — return base64 only, no prefix
      const dataURL = canvas.toDataURL('image/webp', 0.7);
      return dataURL.split(',')[1];
    } catch (err) {
      // Restore render target even on error to prevent GPU state corruption
      this.renderer.setRenderTarget(previousTarget);
      throw err;
    }
  }

  /**
   * Get the dedicated AI render target for PiP texture display.
   */
  public getAIRenderTarget(): THREE.WebGLRenderTarget {
    return this.aiRenderTarget;
  }

  public setMode(mode: CameraMode): void {
    this.mode = mode;
    this.controls.enabled = mode === 'third_person';
    this.transformControls.camera = this.getMainCamera();
    Logger.info(`CameraManager: Switched to ${mode}`);
  }

  public handleResize(width: number, height: number): void {
    const aspect = width / height;
    this.thirdPersonCamera.aspect = aspect;
    this.thirdPersonCamera.updateProjectionMatrix();
    this.chaseCam.aspect = aspect;
    this.chaseCam.updateProjectionMatrix();
  }

  public attachTransform(object: THREE.Object3D | null): void {
    if (object) {
      // Defensive check: only attach if the object is in the scene graph
      if (object.parent === null) {
        this.transformControls.detach();
        return;
      }
      this.transformControls.attach(object);
    } else {
      this.transformControls.detach();
    }
  }

  public getMainCamera(): THREE.PerspectiveCamera {
    switch (this.mode) {
      // 'first_person' = the AI's true eye view (aiPerceptionCamera, locked to head bone)
      case 'first_person': return this.aiPerceptionCamera;
      // 'model_input' = the chase/follow camera — behind and above the model
      case 'model_input': return this.chaseCam;
      default: return this.thirdPersonCamera;
    }
  }

  /** Returns the chase/follow camera (behind + above model). For debugging or a dedicated 2nd-person viewport. */
  public getChaseCam(): THREE.PerspectiveCamera {
    return this.chaseCam;
  }

  public getHeadCamera(): THREE.PerspectiveCamera {
    return this.aiPerceptionCamera;
  }

  public getCameraData(): Array<{ label: string; position: THREE.Vector3; quaternion: THREE.Quaternion; color: number }> {
    return [
      { label: 'EYE', position: this.aiPerceptionCamera.position, quaternion: this.aiPerceptionCamera.quaternion, color: 0xff4444 },
      { label: 'CHASE', position: this.chaseCam.position, quaternion: this.chaseCam.quaternion, color: 0x44aaff },
      { label: '3RD', position: this.thirdPersonCamera.position, quaternion: this.thirdPersonCamera.quaternion, color: 0x44ff88 },
    ];
  }

  public getRenderTarget(): THREE.WebGLRenderTarget {
    return this.renderTarget;
  }

  public updateTransformControls(): void {
    // three.js r168+ handles TransformControls matrix updates automatically
    // during scene.updateMatrixWorld() — no manual call needed.
  }

  public getTransformControls(): TransformControls {
    return this.transformControls;
  }
}
