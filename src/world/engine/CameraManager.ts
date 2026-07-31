import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { logger as Logger } from '../../utils/logger';

export type CameraMode = 'third_person' | 'first_person' | 'model_input';

export class CameraManager {
  private thirdPersonCamera: THREE.PerspectiveCamera;

  private chaseCam: THREE.PerspectiveCamera;

  private aiPerceptionCamera: THREE.PerspectiveCamera;
  private renderTarget: THREE.WebGLRenderTarget;
  private aiRenderTarget: THREE.WebGLRenderTarget;
  private mode: CameraMode = 'third_person';
  private controls: OrbitControls;
  private transformControls: TransformControls;
  private renderer: THREE.WebGLRenderer;

  private chaseCamOrigin: THREE.Vector3 = new THREE.Vector3(0, 5, -6);

  private static readonly AI_VIEW_SIZE = 448;

  private lastViewedAgentId: string = '';
  private needsChaseSnap: boolean = true;

  public onDragEnd?: (object: THREE.Object3D) => void;
  public onDragChanged?: (dragging: boolean, object: THREE.Object3D | null) => void;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, canvas: HTMLCanvasElement) {
    this.renderer = renderer;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    this.thirdPersonCamera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    this.thirdPersonCamera.position.set(5, 2, 5);

    this.chaseCam = new THREE.PerspectiveCamera(90, width / height, 0.01, 100);
    this.chaseCam.position.set(0, 5, -6);
    this.chaseCam.lookAt(0, 1.5, 0);

    this.chaseCamOrigin = new THREE.Vector3(0, 5, -6);

    this.aiPerceptionCamera = new THREE.PerspectiveCamera(110, 480 / 270, 0.01, 200);

    this.aiPerceptionCamera.position.set(0, 1.8, 0.5);
    this.aiPerceptionCamera.lookAt(0, 1.0, 10);

    this.renderTarget = new THREE.WebGLRenderTarget(480, 270);

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

  public setViewingAgent(agentId: string, position?: THREE.Vector3): void {
    const isNewAgent = this.lastViewedAgentId !== agentId;
    this.lastViewedAgentId = agentId;

    if (isNewAgent) {
      this.needsChaseSnap = true;
    }

    if (position && (isNewAgent || this.mode === 'third_person')) {
      if (Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)) {
        // Snap the orbit controls target to the agent position once
        this.controls.target.copy(position);

        // Position third person camera to keep viewing the agent nicely
        const offset = new THREE.Vector3(5, 2, 5);
        this.thirdPersonCamera.position.copy(position).add(offset);
        this.controls.update();
      }
    }
  }

  public update(headMatrix?: THREE.Matrix4, targetPos?: THREE.Vector3, capsuleQuat?: THREE.Quaternion, capsulePos?: THREE.Vector3): void {
    const isValidVector = (v: THREE.Vector3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

    // Decompose headMatrix and copy to aiPerceptionCamera always if present, so AI offscreen vision is correct
    if (headMatrix) {
      const headPos = new THREE.Vector3();
      const headQuat = new THREE.Quaternion();
      const headScale = new THREE.Vector3();
      headMatrix.decompose(headPos, headQuat, headScale);

      if (isValidVector(headPos)) {
        this.aiPerceptionCamera.position.copy(headPos);
        this.aiPerceptionCamera.quaternion.copy(headQuat);
        this.aiPerceptionCamera.up.set(0, 1, 0);
      }
    } else if (targetPos) {
      this.aiPerceptionCamera.position.set(targetPos.x, targetPos.y + 0.8, targetPos.z + 1.5);
      this.aiPerceptionCamera.lookAt(targetPos);
    } else {
      if (this.aiPerceptionCamera.position.length() < 0.1) {
        this.aiPerceptionCamera.position.set(0, 1.8, 0.5);
        this.aiPerceptionCamera.lookAt(0, 1.0, 10);
      }
    }

    // 2nd person follow/tracking camera logic: locked tracking behind the agent's horizontal yaw heading
    if (this.mode === 'model_input') {
      let effectivePos = capsulePos;
      if (!effectivePos || !isValidVector(effectivePos)) {
        if (headMatrix) {
          const hPos = new THREE.Vector3();
          const hQuat = new THREE.Quaternion();
          const hScale = new THREE.Vector3();
          headMatrix.decompose(hPos, hQuat, hScale);
          effectivePos = hPos;
        }
      }

      if (effectivePos && isValidVector(effectivePos)) {
        let yawQuat = new THREE.Quaternion();
        if (capsuleQuat) {
          const euler = new THREE.Euler().setFromQuaternion(capsuleQuat, 'YXZ');
          yawQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), euler.y);
        } else if (headMatrix) {
          const hPos = new THREE.Vector3();
          const hQuat = new THREE.Quaternion();
          const hScale = new THREE.Vector3();
          headMatrix.decompose(hPos, hQuat, hScale);
          const euler = new THREE.Euler().setFromQuaternion(hQuat, 'YXZ');
          yawQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), euler.y);
        }

        const localOffset = new THREE.Vector3(0, 2.0, 3.5); // 2m up, 3.5m behind character facing direction
        const targetPosWorld = localOffset.clone().applyQuaternion(yawQuat).add(effectivePos);

        if (this.needsChaseSnap) {
          this.chaseCam.position.copy(targetPosWorld);
          this.needsChaseSnap = false;
        } else {
          this.chaseCam.position.lerp(targetPosWorld, 0.1);
        }

        this.chaseCam.up.set(0, 1, 0);
        const lookTarget = new THREE.Vector3(effectivePos.x, effectivePos.y + 0.5, effectivePos.z);
        this.chaseCam.lookAt(lookTarget);
      }
    }

    // 3rd person camera: completely unanchored free general orbital/axial controls
    if (this.mode === 'third_person') {
      this.controls.update();
    }
  }

  public renderHeadCamera(scene: THREE.Scene): void {
    const currentRenderTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(scene, this.aiPerceptionCamera);
    this.renderer.setRenderTarget(currentRenderTarget);
  }

  public captureAIFrame(scene: THREE.Scene): string {
    const size = CameraManager.AI_VIEW_SIZE;
    const previousTarget = this.renderer.getRenderTarget();

    try {

      this.renderer.setRenderTarget(this.aiRenderTarget);
      this.renderer.render(scene, this.aiPerceptionCamera);

      const pixelBuffer = new Uint8Array(size * size * 4);
      this.renderer.readRenderTargetPixels(this.aiRenderTarget, 0, 0, size, size, pixelBuffer);

      this.renderer.setRenderTarget(previousTarget);

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

      const dataURL = canvas.toDataURL('image/webp', 0.7);
      return dataURL.split(',')[1];
    } catch (err) {

      this.renderer.setRenderTarget(previousTarget);
      throw err;
    }
  }

  public getAIRenderTarget(): THREE.WebGLRenderTarget {
    return this.aiRenderTarget;
  }

  public setMode(mode: CameraMode): void {
    if (mode === 'model_input') {
      this.needsChaseSnap = true;
    }
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

      case 'first_person': return this.aiPerceptionCamera;

      case 'model_input': return this.chaseCam;
      default: return this.thirdPersonCamera;
    }
  }

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
