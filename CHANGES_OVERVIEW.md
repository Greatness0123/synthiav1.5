# SYNTHIA Codebase Changes Overview

This document summarizes the coordinated fixes and improvements made to the SYNTHIA platform.

## 1. Camera Positioning (Issue 2)
- **Empirical Orientation:** Implemented a new calculation in `HumanoidPhysicsBinder.ts` that derives "up" (Neck to Head) and "forward" (using Arm positions) vectors directly from the model's bind pose. This removes assumptions about the model's export orientation.
- **Eye-Level Placement:** The camera is now positioned at the calculated eye level (slightly above and in front of the head bone center) and oriented using a proper look-at matrix.
- **Synchronized Views:** Both `1ST` (first-person) and `MODEL` (AI perception) cameras use this identical calculation, ensuring the user and the AI see the exact same perspective.

## 2. Physics Realism & Stability (Issue 5)
- **Box Foot Colliders:** Overrode default capsule colliders for foot and toe bones with box (cuboid) colliders. This creates a flat support polygon, significantly improving the stability of the humanoid's balance.
- **Physics Activation:** Automated the transition from the initial "Bind Pose" (Step A) to active physics with actuated motors (Step D).
- **Motor Tuning:** Set default motor stiffness to 150 and damping to 15 for a firm but responsive "rigid" mode. In "ragdoll" mode, stiffness is zeroed but minimal damping is maintained for natural physical collapse.
- **Global Friction:** Wired the global friction setting from God Mode to apply directly to humanoid colliders.

## 3. Joint Name Alignment (Issue 4)
- **Canonical Naming:** Standardized all joint names to a canonical form (lowercase, colons stripped) across the physics binder, coordinator payload, and AI prompt.
- **Upright Preset:** Populated the `upright_preset` in the AI payload with these canonical names and their default angles, allowing the AI to reason about its target pose correctly.
- **Action Pipeline:** Centralized AI action handling through a window event bus, ensuring both the physics binder and the UI stay in sync.

## 4. Object Spawning (Issue 3)
- **Terrain Geometry:** Fixed missing geometry generation for 'Slope', 'Wedge', and 'Ramp' presets in `ObjectManager.ts`.
- **Visual Sync:** Added a `syncVisuals` pass for all spawned objects, ensuring their Three.js meshes follow the Rapier rigid body positions every frame.
- **Collision Groups:** Verified and corrected collision group masks to ensure spawned objects interact correctly with both the environment and the humanoid ragdoll.

## 5. Debug Visualization (Issue 1)
- **Toggleable Markers:** Added a "Joint Debug Markers" toggle in God Mode under the Body section.
- **Minimal Styling:** Replaced large green spheres with small, subtle, semi-transparent grey spheres (radius 0.02) to maintain the platform's minimal aesthetic while providing essential debugging info.

## 6. Audio Pipeline & Thought Injection (Issue 6)
- **Real Audio Capture:** Enhanced `AudioEngine.ts` with a `Tone.Analyser` node to capture real PCM waveform data from the simulation.
- **AI Transmission:** Updated the world state capture logic to base64-encode this audio data (`audio_pcm`), enabling the AI to "hear" simulation events like piano notes or collisions.
- **Thought Injection:** Verified the end-to-end flow of injected thoughts from the UI to the coordinator and into the AI's cognitive loop.
