# Phase 3 Complete: Camera & Agent-Selection System

## Overview
Phase 3 establishes a fully unified, single-source-of-truth camera and agent selection architecture. All camera viewpoints (1st POV, 2nd POV follow, 3rd POV orbital/axial) and the visual AI Picture-in-Picture (PiP) feed are driven dynamically by the top-center agent selector dropdown (`activeViewAgentId`), ensuring perfect cross-system synchronization without state drift or lagging frames.

---

## 1. What Existed vs. What Had to Be Built for Third-Person Mode
- **What Existed**:
  - The previous camera implementation had a basic `OrbitControls` setup.
  - However, in `CameraManager.ts`, the camera's target was hardcoded to continuously lerp and snap back to the position of `agent_0` in every single animation frame:
    ```typescript
    if (this.mode === 'third_person') {
      if (targetPos) {
        this.controls.target.lerp(targetPos, 0.1);
      }
      this.controls.update();
    }
    ```
    This completely broke standard general orbital cameras because any panning or axial zooming the user performed would instantly get overridden, yanking the camera target back to the character. It also prevented multi-agent scene viewing since it was locked only to the first agent.
- **What Had to Be Built**:
  - **Free-Roaming General Orbital View**: We removed the continuous target position lerping in `third_person` mode. `OrbitControls` is now fully unlocked, allowing unlimited rotation, pan, and zoom without locking to or auto-following any character.
  - **One-Time Focus Snap / Recentering**: When switching to a new agent in the dropdown (or when switching into `third_person` mode), the camera performs a single focus snap/re-center target alignment using the agent's current position to give the user an immediate framing point, and then immediately relinquishes control back to the user for free-roaming.

---

## 2. Dynamic 2nd Person (Follow) Camera
- We implemented a stable, motion-sickness-free follow camera in `model_input` mode.
- The camera extracts the horizontal yaw of the character's root capsule and positions itself smoothly behind (`3.5` meters) and above (`2.0` meters) the character.
- By decoupling pitch and roll, the follow camera stays perfectly upright and stable even if the humanoid stumbles, collides, or falls, while smoothly tracking the character's $x, y, z$ position.

---

## 3. Instant PiP Framing & Unified Multi-Agent HUD
- **Top-Center Glassmorphic Dropdown**: Added a modern capsule selector at the top-center of the HUD, styled consistently with the existing UI components.
- **Synchronized State**: Selecting an agent in the dropdown sets `activeViewAgentId`, which automatically updates `activeAgentId` to keep the right inspector panel (thoughts, memories, logs) perfectly aligned.
- **Instant Picture-in-Picture (PiP)**: To prevent stale/lingering frames when toggling between agents, `WorldEngine.ts` detects changes in `activeViewAgentId` and immediately resets the frame-throttling timer to 0, delivering an instant, high-fidelity first-person vision update for the newly selected agent.

---

## Instructions for Phase 4 to Begin with Zero Prior Context
Phase 4 will focus on **Interactive Possession and Manual Drive**.
1. **Interactive Possession**: Enable keyboard inputs (e.g. WASD / Arrow keys) to manually possess and steer the active viewed agent (`activeViewAgentId`) in real-time.
2. **Manual Joint/Body Drive**: Implement manual joint overrides or forward force impulses (e.g., pushing hips/spine, executing manual jump program step) so the user can physically drive the biped's motors or apply custom forces.
3. **Coexistence**: Ensure that other agents continue to execute their independent AI loops asynchronously while the possessed agent is steered.
