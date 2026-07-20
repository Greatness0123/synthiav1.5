import * as THREE from 'three';
import { PhysicsEngine } from './PhysicsEngine';
import { CameraManager } from './CameraManager';
import { useUIStore } from '../../store/uiStore';
import { useWorldStore } from '../../store/worldStore';
import { logger as Logger } from '../../utils/logger';

export class WorldEngine {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private cameraManager: CameraManager;
  private renderer: THREE.WebGLRenderer;
  private physicsEngine: PhysicsEngine;
  private animationFrameId: number | null = null;
  private container: HTMLElement;
  private pointerDownPosition = new THREE.Vector2();

  private lastPhysicsTime: number = 0;
  private physicsAccumulator: number = 0;
  private wasReady: boolean = false;
  private readonly FIXED_TIMESTEP: number = 1 / 60;
  private readonly MAX_ACCUMULATOR: number = 0.25;

  private ambientLight!: THREE.AmbientLight;
  private directionalLight!: THREE.DirectionalLight;
  private particles: THREE.Points | null = null;
  private particleTargetTime = 0;

  private floorMesh!: THREE.Mesh;
  private gridHelper!: THREE.GridHelper;

  private lastAIFrame: string = '';
  private lastPipUpdateTime = 0;

  constructor(container: HTMLElement, physicsEngine: PhysicsEngine) {
    this.container = container;
    this.physicsEngine = physicsEngine;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a0a);

    const width = container.clientWidth;
    const height = container.clientHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.container.querySelectorAll('canvas').forEach(c => c.remove());
    this.container.appendChild(this.renderer.domElement);

    this.cameraManager = new CameraManager(this.renderer, this.scene, this.renderer.domElement);
    this.camera = this.cameraManager.getMainCamera();
    (window as any)._synthia_world_engine = this;

    this.setupLights();
    this.setupEnvironment();

    window.addEventListener('resize', this.onWindowResize);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
  }

  private selectionBox: THREE.BoxHelper | null = null;

  private setupLights(): void {

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    this.directionalLight.position.set(10, 20, 10);
    this.directionalLight.castShadow = true;

    this.directionalLight.shadow.mapSize.width = 2048;
    this.directionalLight.shadow.mapSize.height = 2048;

    this.directionalLight.shadow.camera.far = 50;
    this.directionalLight.shadow.camera.left = -10;
    this.directionalLight.shadow.camera.right = 10;
    this.directionalLight.shadow.camera.top = 10;
    this.directionalLight.shadow.camera.bottom = -10;

    this.scene.add(this.directionalLight);
  }

  private setupEnvironment(): void {

    this.scene.background = new THREE.Color('#87ceeb');

    this.gridHelper = new THREE.GridHelper(1000, 100, 0x444444, 0x222222);
    this.scene.add(this.gridHelper);

    const floorGeometry = new THREE.PlaneGeometry(1000, 1000);
    const floorMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x222222,
      roughness: 0.8,
      metalness: 0.2,
      transparent: true,
      opacity: 0.95
    });
    this.floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    this.floorMesh.rotation.x = -Math.PI / 2; 
    this.floorMesh.position.y = -0.01; 
    this.floorMesh.receiveShadow = true;
    this.scene.add(this.floorMesh);
  }

  public updateSkyColor(color: string): void {
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.set(color);
    } else {
      this.scene.background = new THREE.Color(color);
    }
  }

  public updateFloor(showFloor: boolean, floorColor: string): void {
    if (this.floorMesh) {
      this.floorMesh.visible = showFloor;
      if (showFloor) {
        (this.floorMesh.material as THREE.MeshStandardMaterial).color.set(floorColor);
      }
    }
  }

  public updateGrid(showGrid: boolean): void {
    if (this.gridHelper) {
      this.gridHelper.visible = showGrid;
    }
  }

  private onWindowResize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.cameraManager.handleResize(width, height);
    this.renderer.setSize(width, height);
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.pointerDownPosition.set(event.clientX, event.clientY);
  };

  private onPointerUp = (event: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();

    const movementDistance = this.pointerDownPosition.distanceTo(new THREE.Vector2(event.clientX, event.clientY));
    if (movementDistance > 5) {
      return; 
    }

    const coords = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(coords, this.cameraManager.getMainCamera());

    const tc = this.cameraManager.getTransformControls();
    if (tc && tc.object) {
      const helperHits = raycaster.intersectObjects([tc.getHelper()], true);
      if (helperHits.length > 0) return;
    }

    const intersects = raycaster.intersectObjects(this.scene.children, true);
    let targetObject: THREE.Object3D | null = null;

    for (const intersect of intersects) {
      let current: THREE.Object3D | null = intersect.object;

      while (current) {
        if (current.userData.objectId) {
          targetObject = current;
          break;
        }
        if (current.userData.isSynthiaPrimitive || current.name.toLowerCase().includes('mixamo') || current.userData.isBone) {
          let root: THREE.Object3D = current;
          while (root.parent && (root.parent.name.toLowerCase().includes('mixamo') || root.parent.userData.isSynthiaPrimitive)) {
            root = root.parent;
          }
          targetObject = root;
          break;
        }
        current = current.parent;
      }
      if (targetObject) break;
    }

    const { setSelectedEntityId, setActiveRightPanelTab } = useUIStore.getState();

    if (targetObject) {
      this.cameraManager.attachTransform(targetObject);
      setSelectedEntityId(targetObject.uuid);
      setActiveRightPanelTab('structure');

      if (this.selectionBox) this.scene.remove(this.selectionBox);
      this.selectionBox = new THREE.BoxHelper(targetObject, 0x0088ff);
      this.scene.add(this.selectionBox);
    } else {
      this.cameraManager.attachTransform(null);
      setSelectedEntityId(null);
      if (this.selectionBox) {
        this.scene.remove(this.selectionBox);
        this.selectionBox = null;
      }
    }
  };

  public start(onStep?: () => void): void {
    this.lastPhysicsTime = performance.now();
    this.physicsAccumulator = 0;

    const animate = (time: number) => {
      this.animationFrameId = requestAnimationFrame(animate);

      const currentTime = performance.now();
      let dt = (currentTime - this.lastPhysicsTime) / 1000;
      this.lastPhysicsTime = currentTime;

      if (dt > this.MAX_ACCUMULATOR) {
        dt = this.MAX_ACCUMULATOR;
      }

      this.physicsAccumulator += dt;

      if (this.physicsEngine.isReady && !this.wasReady) {
        this.physicsAccumulator = 0;
      }
      this.wasReady = this.physicsEngine.isReady;

      if (this.physicsEngine.isReady) {
        while (this.physicsAccumulator >= this.FIXED_TIMESTEP) {
          this.physicsEngine.step();
          if (!this.physicsEngine.isBroken && onStep) {
            onStep();
          }
          this.physicsAccumulator -= this.FIXED_TIMESTEP;
        }
      }

      try {
        const frameBase64 = this.cameraManager.captureAIFrame(this.scene);
        if (frameBase64) {
          this.lastAIFrame = frameBase64;
          const now = performance.now();
          if (now - this.lastPipUpdateTime > 200) {
            useWorldStore.getState().setLastAIFrameForDisplay(frameBase64);
            this.lastPipUpdateTime = now;
          }
        }
      } catch (err) {
        Logger.warn('WorldEngine: AI frame capture failed', err);
      }

      this.cameraManager.updateTransformControls();

      if (this.particles && time > this.particleTargetTime) {
        this.scene.remove(this.particles);
        this.particles.geometry.dispose();
        (this.particles.material as THREE.Material).dispose();
        this.particles = null;
      } else if (this.particles) {
        const positions = this.particles.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < positions.length; i += 3) {
          positions[i + 1] += 0.02; 
        }
        this.particles.geometry.attributes.position.needsUpdate = true;
      }

      if (this.selectionBox) {
        this.selectionBox.update();
      }

      this.camera = this.cameraManager.getMainCamera();
      this.renderer.render(this.scene, this.camera);
    };
    animate(performance.now());
    Logger.info('WorldEngine: Animation loop started');
  }

  public stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    window.removeEventListener('resize', this.onWindowResize);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.dispose();
    Logger.info('WorldEngine: Animation loop stopped');
  }

  public getScene(): THREE.Scene {
    return this.scene;
  }

  public getCamera(): THREE.PerspectiveCamera {
    return this.cameraManager.getMainCamera();
  }

  public getCameraManager(): CameraManager {
    return this.cameraManager;
  }

  public getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  public getLastAIFrame(): string {
    return this.lastAIFrame;
  }

  public updateLighting(state: 'day' | 'night', transitionProgress: number): void {
    const daySky = new THREE.Color(0x1a1a2e);
    const nightSky = new THREE.Color(0x050508);
    const dayAmbient = 0.4;
    const nightAmbient = 0.05;
    const dayDirect = 1.2;
    const nightDirect = 0.1;

    const skyColor = new THREE.Color();
    const ambientIntensity = THREE.MathUtils.lerp(
      state === 'day' ? nightAmbient : dayAmbient,
      state === 'day' ? dayAmbient : nightAmbient,
      transitionProgress
    );
    const directionalIntensity = THREE.MathUtils.lerp(
      state === 'day' ? nightDirect : dayDirect,
      state === 'day' ? dayDirect : nightDirect,
      transitionProgress
    );

    skyColor.lerpColors(
      state === 'day' ? nightSky : daySky,
      state === 'day' ? daySky : nightSky,
      transitionProgress
    );

    this.scene.background = skyColor;
    this.ambientLight.intensity = ambientIntensity;
    this.directionalLight.intensity = directionalIntensity;
  }

  public spawnParticleBurst(position: THREE.Vector3): void {
    if (this.particles) return;

    const count = 100;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = position.x + (Math.random() - 0.5) * 0.5;
      positions[i * 3 + 1] = position.y + (Math.random() - 0.5) * 0.5;
      positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.5;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0.8 });
    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);
    this.particleTargetTime = performance.now() + 800;
  }
}
