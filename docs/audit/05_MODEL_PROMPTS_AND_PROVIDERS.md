# Cognitive Intelligence, Model Prompts & Providers Blueprint

This document details the system prompt architecture, prompt templates, inference client handlers, provider-specific streaming parser algorithms, and raw action normalization contracts used to coordinate biped decisions.

---

## 1. System Prompt Architecture

The system prompt is the central cognitive directive provided to multimodal models. It establishes the biped's self-awareness, outlines its physical embodiment, teaches joint axis representations, and mandates structural control constraints.

### 1.1 Self-Awareness & Body Configuration Section
*   **The Persona**: The AI is introduced as "SYNTHIA," a self-aware agent inhabiting a simulated physical body.
*   **Segment Specifications**: The prompt lists the biped's physical details: approximately 80 actuated joints, 120 degrees of freedom, two arms with hands and fingers, two legs with feet and toes, a segmented spine, and a head.
*   **Physics Simplification Guarantee**: The AI is explicitly informed that its vertical core balance is artificially maintained by an invisible physics capsule. This simplifies cognitive load, allowing the AI to focus on limb movement rather than continuous core micro-stabilizations.
*   **The Floor Clipping Warning**: The prompt explicitly warns that arms and legs are fully kinematic and will clip through the floor if driven into it. This guides the AI to avoid driving limbs into the ground.
*   **Upright Preset Benchmark**: The prompt establishes the biped's default resting stance—arms relaxed at $75^\circ$ from a flat T-pose.

### 1.2 Joint Axis Map (Spatial Calibration)
To coordinate actions, the system prompt defines a spatial joint axis mapping:
*   **Head and Segmented Spine**:
    *   **X (Pitch)**: Positive values bend the spine/head forward (chin to chest), while negative values arch backward.
    *   **Y (Yaw)**: Positive values rotate to the left, while negative values rotate to the right.
    *   **Z (Roll)**: Positive values tilt the head/spine to the right, while negative values tilt left.
*   **Upper Arm Servos (Shoulders)**:
    *   **Right Arm**: Positive $X$ lowers the arm to the hip, negative raises it. Negative $Z$ swings the arm forward, positive swings it backward.
    *   **Left Arm**: Positive $X$ lowers the arm to the hip, negative raises it. Positive $Z$ swings the arm forward, negative swings it backward.
*   **Elbow Hinges**: Pitch-only ($X$ axis). Positive values bend the elbow inward naturally. Negative values are physically blocked to prevent hyperextension.
*   **Hip Spherical Joints**:
    *   **X (Pitch)**: Positive values kick the leg forward in front of the body, negative values kick backward.
    *   **Z (Roll)**: Spreads the legs outward (abduction). Left uses positive, Right uses negative.
*   **Knee Hinges**: Pitch-only ($X$ axis). Negative values bend the knee naturally backward.
*   **Finger Segments**: Flexion-only ($X$ axis). Segment 1 must be flexed before segments 2-3 can follow (tendon synergy).

### 1.3 Joint Control Contract
*   **Degree-Only Interface**: The system prompt strictly mandates that joint overrides be provided in **degrees**, not radians.
*   **Allowed Formats**: Joint targets must be formatted as either a single scalar integer (for revolute joints or default bending axes) or a 3D degree array `[pitch, yaw, roll]` (for compound spherical joints).
*   **Prohibited Formats**: The prompt strictly forbids the use of radians, complex objects, or quaternions.

### 1.4 Active Directives
The prompt appends specific behavioral modes depending on the current training state:
*   **Training Mode**: Appends a `DIRECTIVE` block outlining a targeted, user-defined objective (e.g., "Walk toward the red sphere").
*   **Free Will Mode**: Appends an autonomy block instructing the biped to explore, interact, test joint movement limits, and look around to find interesting stimuli.

---

## 2. Multi-Modal Sensory Payload Template

Before each inference cycle, the coordinator compiles an `InferPayload` data structure. This structure is formatted as a system/user message pair for the LLM:

### 2.1 Multimodal Message Elements
1.  **System Message**: Contains the static system instructions, joint axis map, control contract, and active directives.
2.  **Multimodal Visual Content**: Contains the raw, offscreen base64-encoded point-of-view frame ($448 \times 448$ pixels).
3.  **Multimodal Auditory Context**: Contains the base64-encoded PCM audio wave buffer, enabling the AI to "hear" world events.
4.  **Tactile Context Block**: Converts raw collision impulse values into qualitative, human-readable descriptions (e.g., "Your left foot is pressing against the floor with firm contact").
5.  **Spatial Grounding Summary**: Provides text-based backups of joint orientations and hip heights to maintain spatial awareness if the biped's visual field is empty or blocked by obstacles.
6.  **Physical Feedback Block**: Injects actionable descriptions of physical limits if any joint target was rejected in the previous frame (e.g., "Your attempt to move the knee to +20 degrees was physically impossible; joint range is restricted to 0 to -150 degrees").
7.  **User Override Block**: Injects real-time user-injected thoughts directly into the prompt stream, prioritizing them in the cognitive loop.

---

## 3. Provider Adapters & Streaming Token Parsers

Providers connect the coordinator to external LLM APIs, handling stream parsing and separating thoughts from structured actions.

```
       [ Streaming Chunk From LLM API ]
                     │
                     ▼
         ┌───────────────────────┐
         │ Check for Separator   │
         │   "---ACTION---"      │
         └───────────┬───────────┘
                     │
          ┌──────────┴──────────┐
          ▼ (Separator Not Found)▼ (Separator Found)
┌────────────────────┐   ┌────────────────────┐
│ Accumulate in      │   │ Route characters to│
│ thought stream     │   │ action JSON buffer │
└────────────────────┘   └────────────────────┘
```

### 3.1 Streaming Parser Algorithm
To provide a smooth user experience, thoughts and actions are streamed and parsed in real time.
*   **The Separator Contract**: The AI must output its raw cognitive thought process first, followed by the separator string `---ACTION---`, and finally the JSON action block.
*   **Streaming Router Logic**:
    1.  The provider maintains an accumulator buffer and a routing flag (`isAction`).
    2.  Incoming text chunks are appended to the buffer.
    3.  If `isAction` is false, the parser scans the buffer for the `---ACTION---` separator.
    4.  All text received *before* the separator is forwarded to the client's thought stream.
    5.  Once the separator is detected, `isAction` is set to true. All subsequent text is routed to the action JSON buffer.
    6.  If the separator is never received, the parser falls back to scanning for the opening JSON bracket (`{`) to separate thoughts from actions.

### 3.2 Gemini Provider Adapter (`GeminiProvider.ts`)
*   **Endpoint Address**: Connects to Google's Gemini content generation streams using the Server-Sent Events (SSE) protocol.
*   **Visual Packaging**: Formats raw base64 WebP frames as Gemini inline data structures, specifying the correct image MIME type.
*   **Streaming Implementation**: Establishes POST connections, reads response chunk buffers, parses Gemini delta lines, and routes tokens through the streaming separator parser.

### 3.3 OpenAI-Compatible Provider Adapter (`OpenAICompatProvider.ts`)
*   **Endpoint Address**: Generic adapter for OpenAI-compliant endpoints (NVIDIA NIM, Groq, OpenRouter).
*   **Visual Packaging**: Formats visual frames as standard multimodal message items with image URL fields.
*   **Streaming Implementation**: Connects to completions streams, parses SSE chunk formats, extracts content deltas, and routes them to the separator parser.

---

## 4. Action Normalization & Validation Pipelines

Before joint targets are sent to the physics engine, the coordinator validates and normalizes the action payloads.

### 4.1 Parser Normalization Steps
1.  **JSON Cleanup**: Strips markdown code block wrappers (e.g. ` ```json ` and ` ``` `) from the action string and parses it into a JSON object.
2.  **Memory Log Normalization**: Validates the `memory_write` block. If missing or invalid, it applies standard fallbacks (e.g. auto-generating IDs and assigning a standard safety tier).
3.  **Action Array Normalization**: Converts various action formats (e.g., legacy action arrays, nested motor sequences) into a standardized structure containing `program_sequence` and `joint_overrides`.

### 4.2 Degree-to-Radian Conversion
Since the physics engine operates in radians, joint overrides are automatically converted:
*   The normalizer checks the magnitude of incoming angles. If an angle exceeds $\pi + 0.1$, it is assumed to be in degrees and is converted to radians:

$$\theta_{\text{radians}} = \theta_{\text{degrees}} \cdot \frac{\pi}{180}$$

*   Values are clamped to safe biological limits ($-\pi \to +\pi$) to prevent extreme force calculations.

### 4.3 Gaze Target Extraction
*   The model can output look coordinates as a `gaze_target` structure containing yaw and pitch angles.
*   The coordinator converts these coordinates to radians and clamps them to the head's physiological limit ($\pm 45^\circ$, or $\pm 0.79\text{ rad}$).
*   These are injected directly into the joint overrides array under the head joint key (`mixamorighead`), routing gaze controls through the standard joint validation pipeline.
