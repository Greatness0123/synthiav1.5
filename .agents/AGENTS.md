# Synthia Codebase Rules & Known Issues

## [SOLVED] VLA Quaternion Hallucination — Model Accordion Collapse

### Symptom
The AI agent's humanoid body folds completely inside out (accordion/pretzel collapse) within 1–2 heartbeats of session start. This happens regardless of model (Gemini, Qwen, etc.).

### Root Cause (Three simultaneous failures)

**1. Quaternion Hallucination**
LLMs cannot reliably compute normalized 4D quaternions. When instructed to output joint angles in radians, models hallucinate quaternion arrays like `[0.1, 0.0, 0.0, 0.995]` instead. These pass into Three.js bone rotations as raw `[x,y,z,w]` which snaps bones to extreme angles instantly.

**2. Contact Sensor Misinterpretation**
`contacts=1` at spawn (foot on ground) was interpreted by the model as "I am pressed against a ceiling". This caused a panic loop where the model tried to escape an imaginary overhead obstruction, generating increasingly extreme joint values.

**3. Anatomical Limit Rejection Instead of Clamping**
`HumanoidPhysicsBinder.setMotorTargets()` was *rejecting* out-of-range joint values (silently dropping them). This meant extreme quaternion-derived angles weren't blocked by the limit system — they slipped through normalisation with `val[0]` extraction and applied unclamped.

**4. 3-Element Euler Array Parser Bug (discovered later)**
The model was sometimes sending Euler degree arrays `[0, 15, 0]` which the coordinator parser was treating as quaternions and running `2 * asin(sqrt(0² + 15² + 0²))`. Since `asin` clamps to `[-1,1]` this evaluated to `2 * asin(1) = π` — instructing the neck to snap 180° in one frame. This caused immediate ragdoll collapse on the frame it occurred.

### Fix Applied

**File: `kaggle_new.py` (output contract block)**
- Changed joint format from radians to **plain DEGREES** (e.g. `15`, `-30`, `90`)
- Explicitly banned arrays and quaternions with concrete wrong/right examples
- Added anatomical hard limits table directly in the prompt so the model self-censors

**File: `coordinator/src/agentLoop.ts` (`parseAndValidateAction`)**
- 3-element arrays `[pitch, yaw, roll]` → take the largest-magnitude element as degrees → convert to radians
- 4-element arrays `[x,y,z,w]` (quaternion) → extract via `2 * asin(|xyz|)` axis-angle
- `gaze_target` yaw/pitch also converted from degrees and clamped to ±0.44 rad (≈25°)

**File: `coordinator/src/payloadBuilder.ts` (`buildPerceptionSummary`)**
- Added explicit `isGrounded: true/false` boolean
- Added `POSTURE` label (STANDING / FALLEN / PRONE)
- Added a `SITUATION` block that tells the model exactly what the contact means:
  - e.g. `"SITUATION: I am lying flat on the FLOOR. I am NOT inverted or pressed against a ceiling. PRIORITY ACTION: execute get_up_from_back."`
- Added `IMPORTANT: contacts=1 means ONE surface (the floor) is touching me. This does NOT mean I am trapped against a ceiling.`

**File: `src/world/engine/HumanoidPhysicsBinder.ts` (`setMotorTargets`)**
- Changed from **reject** to **clamp**: joints exceeding anatomical limits are moved to the nearest safe angle instead of being silently dropped
- This means even a hallucinated extreme value can never produce a full accordion collapse

### Anatomical Limits Active (in `src/constants/anatomicalLimits.ts`)
| Body Part | Range |
|---|---|
| Spine segments | ±15° |
| Neck / Cervical | ±60° |
| Head | ±45° |
| Knee | -150° to 0° |
| Elbow / Forearm | -145° to 0° |
| Hip (upleg) | ±120° |
| Shoulder | ±180° |

### Known Remaining Limitation: Single-Capsule Physics
The humanoid uses ONE capsule collider at the root (standard game-engine approach). Individual limb bones are purely visual — they have no Rapier colliders attached. This means:
- Arms/legs can visually clip through the floor plane when the AI commands extreme downward rotations
- There is no self-collision detection between limbs

A full ragdoll collider hierarchy (per-bone capsule + Rapier joints) would fix this but is a major architectural change. Current mitigation: anatomical limits prevent the worst extremes.

### Key Rule for Future Development
**Never let the LLM output quaternions or radians for joint angles.** Always instruct it to use plain integer degrees. The TypeScript coordinator converts to radians before physics application. The physics engine then clamps to anatomical limits as a final safety net.

**Never describe contact forces to the LLM without labeling their source.** Always tell it whether a contact is the floor, a wall, or an object — raw `contacts=N` numbers will be hallucinated as ceiling/obstacle collisions.
