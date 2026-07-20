# Generative VLM Control of Three.js Physical Characters
**Author:** Jules, Systems Architect  
**Accountability Mark:** `by_jules` design series

---

## 1. Introduction

Controlling a 3D physical character in a WebGL/Three.js environment using a generative Vision-Language Model (VLM) like Qwen2.5-VL or Gemini requires a robust, low-latency control loop. This report details the design of a pipeline that allows the VLM to analyze visual inputs and direct the character's movements in real time without causing frame-rate drops.

---

## 2. Real-Time Frame Capture & Canvas Compression

To allow a VLM to "see" the 3D simulation, we must capture, downscale, compress, and transmit the WebGL canvas viewport. Doing this directly on the main thread can block rendering, causing frame-rate drops.

### 2.1. The Offscreen Canvas Sampling Pipeline

To keep the rendering thread running smoothly at 60+ FPS, frame capture and image encoding should be decoupled from the main WebGL renderer. We use an offscreen render target to draw the AI's perspective camera separately, and encode the pixels asynchronously.

```
+-----------------------------------+
|  Main WebGL Renderer (Main Thread) |
+-----------------+-----------------+
                  |
                  ▼ (Offscreen Render Target)
+-----------------------------------+
|  448x448 WebGL Render Target      |
+-----------------+-----------------+
                  |
                  ▼ (gl.readPixels / Raw ArrayBuffer Transfer)
+-----------------------------------+
|  Web Worker Pixel Buffer          |
+-----------------+-----------------+
                  |
                  ▼ (OffscreenCanvas WebP Compression)
+-----------------------------------+
|  Base64 WebP String Buffer        |
+-----------------+-----------------+
                  |
                  ▼ (Dispatched over WebSocket)
       To Coordinator Brain
```

### 2.2. Production-Grade Capturing Code

Below is the optimized TypeScript implementation for `CameraManager` or `WorldEngine` to capture, resize, and convert the canvas viewport using an `OffscreenCanvas` transfer to avoid main-thread allocation overhead.

```typescript
export class AsyncFrameCapturer {
  private renderTarget: THREE.WebGLRenderTarget;
  private pixelBuffer: Uint8Array;
  private offscreenCanvas: OffscreenCanvas | null = null;
  private offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;
  private isProcessing: boolean = false;

  constructor(private renderer: THREE.WebGLRenderer, size: number = 448) {
    this.renderTarget = new THREE.WebGLRenderTarget(size, size, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });
    this.pixelBuffer = new Uint8Array(size * size * 4);

    if (typeof OffscreenCanvas !== 'undefined') {
      this.offscreenCanvas = new OffscreenCanvas(size, size);
      this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    }
  }

  /**
   * Captures the frame of the perception camera asynchronously.
   * Returns a promise resolving to a base64-encoded WebP string.
   */
  public async captureFrameAsync(scene: THREE.Scene, camera: THREE.PerspectiveCamera): Promise<string | null> {
    if (this.isProcessing) return null; // Skip if previous frame is still encoding
    this.isProcessing = true;

    const previousTarget = this.renderer.getRenderTarget();
    
    // 1. Render scene to offscreen target
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(scene, camera);
    
    // 2. Read pixels out of GPU to CPU RAM
    this.renderer.readRenderTargetPixels(
      this.renderTarget,
      0, 0,
      this.renderTarget.width,
      this.renderTarget.height,
      this.pixelBuffer
    );
    
    // Restore main viewport target instantly
    this.renderer.setRenderTarget(previousTarget);

    if (!this.offscreenCanvas || !this.offscreenCtx) {
      this.isProcessing = false;
      return null;
    }

    const size = this.renderTarget.width;
    const bytesPerRow = size * 4;

    // Flip pixels vertically (corrects OpenGL's bottom-up format)
    const flippedBuffer = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      const srcOffset = y * bytesPerRow;
      const destOffset = (size - 1 - y) * bytesPerRow;
      flippedBuffer.set(this.pixelBuffer.subarray(srcOffset, srcOffset + bytesPerRow), destOffset);
    }

    // Draw flipped buffer to offscreen canvas
    const imageData = new ImageData(flippedBuffer, size, size);
    this.offscreenCtx.putImageData(imageData, 0, 0);

    try {
      // Compress to WebP (native GPU/browser-accelerated compression)
      const blob = await this.offscreenCanvas.convertToBlob({
        type: 'image/webp',
        quality: 0.7 // Sweet-spot for Qwen2.5-VL feature extraction vs network size
      });

      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = reader.result as string;
          // Split off "data:image/webp;base64," prefix
          resolve(base64data.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.error('Failed to compress offscreen frame', err);
      return null;
    } finally {
      this.isProcessing = false;
    }
  }
}
```

---

## 3. Proprioceptive Memory & Token Latency Control

Large Multi-Modal Models are sensitive to context window bloat. Sending full 3D skeletal joint matrices (e.g., 80 joints $\times$ 16 floats per matrix $\approx$ 1,280 floats) on every heartbeat will rapidly hit token limits and degrade inference latency.

### 3.1. rolling temporal window & Joint Reduction Strategies
To maintain historical context without bloating token usage:
1. **Bone Key Reduction:** Rather than sending all 80 bones, send only the **15 key control bones** (head, neck, spine, hips, knees, ankles, shoulders, elbows, wrists).
2. **Matrix Compression:** Do not send full $4\times4$ projection matrices. Send only the Euler angles in degrees (representing joint flexion) and the 3D translation of the pelvis.
3. **Temporal Windowing:** Maintain a rolling temporal window capped at the **last 3 heartbeats**.
4. **Delta Compression:** Instead of absolute joint states, transmit joint velocities or deltas between frames to significantly reduce string lengths.

```
+-------------------------------------------------------------+
| Rolling Joint State History (Token Compression)              |
|                                                             |
| T-2 (2 cycles ago): [Hips: 0.0, Spine: -5, Knee: -45]      |
| T-1 (1 cycle ago):  [Hips: 0.1, Spine: -6, Knee: -47]      |
| T-0 (Current Frame): [Hips: 0.2, Spine: -7, Knee: -49]      |
+-------------------------------------------------------------+
```

### 3.2. Payload Serialization Structure

The optimized joint payload structure below uses compressed string formats to save context tokens:

```json
{
  "proprioception": {
    "joints_subset": ["hips", "spine", "neck", "r_shoulder", "r_elbow", "r_knee", "l_shoulder", "l_elbow", "l_knee"],
    "current_pose": [0.02, -0.05, 0.95, -5, -45, 12, -30, -50, 8],
    "rolling_history": [
      { "hb": 104, "pose": [0.02, -0.05, 0.95, -5, -42, 10, -28, -48, 7] },
      { "hb": 103, "pose": [0.01, -0.04, 0.95, -4, -38, 8, -25, -45, 6] }
    ]
  }
}
```

---

## 4. Resolving Coordinate Flips and Action Map Conversions

A common issue with VLM control of 3D characters is **limb-flipping**. When the model outputs a high-level action like *"lower hands to waist"*, joint target calculations can hallucinate obtuse angles (e.g., rotating an elbow $+90^\circ$, which breaks the arm backwards).

### 4.1. Declarative Semantic-to-Joint Converters

Instead of letting the model output raw joint rotations directly for complex tasks, the VLM should output high-level **Semantic Action Cards** or **Motor Program Keys**. The coordinator then converts these high-level descriptive intents into structured joint limits, anatomical bounds, or predefined motor programs.

```
[VLM Intends: "Reach hand to waist"]
                │
                ▼ (Action Card Parser)
"reach_waist" semantic event
                │
                ▼ (Programmatic Coordinate Resolver)
Right Shoulder Euler Pitch -> 45°
Right Elbow Flex -> -60°
Right Wrist -> -10°
Spine Pitch -> 10° (leaning forward slightly to assist)
                │
                ▼ (Anatomical Bounds Checking)
Clamped to rig limits
                │
                ▼ (PD Motor Actuation)
Applied smoothly over 300ms
```

### 4.2. Dual-Path Execution Pipeline

To balance expressiveness with safety, the control pipeline supports two distinct path modes:

1. **Path A: Semantic Program Dispatch (Dynamic Library)**
   For standard locomotion (walking, crouching, standing up), the VLM selects from a library of verified, stable motor programs (`stand_upright`, `step_forward`, `get_up_from_back`). This ensures the character remains stable and behaves realistically.
   
2. **Path B: Direct Joint Overrides (with Safe Limit Transforms)**
   For custom gestures or fine-grained interactions (waving, pressing buttons, playing piano), the VLM specifies joint angle changes directly. These values pass through a strict kinematic safety filter that enforces anatomical limits and prevents limb-flipping.

### 4.3. High-Level Action Map Configurator

To translate semantic intents into safe joint targets, the system uses a semantic-to-kinematic action map:

```typescript
export interface SemanticActionConfig {
  jointTargets: Record<string, number | [number, number, number]>;
  durationMs: number;
  activeGaitPhase: boolean;
}

export const SEMANTIC_ACTION_MAP: Record<string, SemanticActionConfig> = {
  "wave_right_hand": {
    jointTargets: {
      "mixamorigrightarm": [0, 0, -110],       // Swung high in the air
      "mixamorigrightforearm": [-20, 0, 0],   // Elbow slightly flexed
      "mixamorigrighthand": [30, 0, 0],       // Hand angled forward
    },
    durationMs: 800,
    activeGaitPhase: false
  },
  "crouch_protective": {
    jointTargets: {
      "mixamorigspine": [12, 0, 0],           // Lean forward
      "mixamorigrightupleg": [70, 0, 0],      // Hip flexed
      "mixamorigleftupleg": [70, 0, 0],
      "mixamorigrightleg": [-110, 0, 0],      // Knee bent
      "mixamorigleftleg": [-110, 0, 0],
    },
    durationMs: 1200,
    activeGaitPhase: false
  },
  "rest_standing": {
    jointTargets: {
      "mixamorigrightarm": [0, 0, 75],        // Arms relaxed downward
      "mixamorigleftarm": [0, 0, -75],
      "mixamorigrightforearm": [0, 0, 0],     // Elbows straight
      "mixamorigleftforearm": [0, 0, 0],
    },
    durationMs: 500,
    activeGaitPhase: false
  }
};
```

---

## 5. Optimal Prompting Strategies for Local VLMs

Local VLMs like Qwen2.5-VL-7B require clear instructions and formatting constraints to ensure they generate valid JSON actions and reasoning.

### 5.1. Structured Output Enforcement

To prevent the model from generating conversational text after the JSON payload, use a two-step prompting strategy:
1. **In-Context Examples:** Provide concrete examples of valid and invalid outputs directly in the system prompt.
2. **Stop Token Formatting:** End the prompt with `---ACTION---` and configure the model's stop tokens to truncate generation immediately after the closing JSON bracket `}`.

### 5.2. System Prompt Architecture

An effective system prompt should include three core sections:
1. **Physical Grounding Context:** Explicitly describe the character's physical state, current posture, and spatial relationships to nearby objects.
2. **Safety and Anatomical Constraints:** Detail the joint limits and the physical consequences of moving limbs beyond safe bounds.
3. **Strict JSON Schema Contract:** Provide a strict JSON template that the model must follow, and define how to structure thoughts, actions, and custom motor programs.
