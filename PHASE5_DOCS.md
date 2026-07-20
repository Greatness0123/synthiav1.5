# SYNTHIA Phase 5 — Documentation

## System Startup Procedure

To run the full SYNTHIA integration:

1.  **Machine A (Coordinator)**:
    -   Navigate to `/coordinator`.
    -   Run `npm install` (first time).
    -   Run `npm run dev`.
    -   The coordinator will start on `ws://localhost:3001`.

2.  **Machine B (Frontend)**:
    -   Navigate to the root directory.
    -   Run `npm install` (first time).
    -   Run `npm run dev`.
    -   Open `http://localhost:5173` in a modern browser (Chrome recommended).

3.  **Kaggle (Inference Server)**:
    -   Start the Kaggle notebook with `kaggle_server.py`.
    -   Copy the `fxtun.dev` URL.

4.  **Initial Connection**:
    -   In the frontend, open **God Mode** (left edge tab).
    -   Go to the **Connection** panel.
    -   Paste the Kaggle URL into the **Endpoint URL** field.
    -   Paste your Supabase credentials.
    -   Click **Connect**.
    -   The rehydration sequence will begin.

## WebSocket Message Reference

### Client -> Coordinator
- `world_state`: Sends current frame (base64), joint angles, audio buffer, and light state.
- `inject_thought`: Injects a manual thought into the agent loop.
- `outcome`: Reports a task outcome (success/reward/description).
- `set_directive`: Updates the agent's mode (free_will/training) and goal.
- `set_endpoint`: Updates the VLM inference endpoint URL.
- `set_supabase`: Updates database credentials.
- `export_request`: Triggers a dataset export.

### Coordinator -> Client
- `action`: Contains `programSequence` and `jointOverrides`.
- `thought_token`: A single token for the streaming thought display.
- `thought_complete`: Signal that the current thought cycle is finished.
- `rehydration_token`: Tokens for the startup summary.
- `rehydration_complete`: Signal that rehydration is finished.
- `skill_mastered`: Notification of a new learned skill.
- `connection_status`: Real-time RTT and inference timing.
- `error`: Error messages for the toast system.

## Troubleshooting Guide

1.  **"Cannot connect to coordinator"**
    -   Verify the coordinator process is running on Machine A.
    -   Check if Machine B can ping Machine A's IP address.
2.  **"Endpoint unreachable"**
    -   Ensure the Kaggle notebook is running and the tunnel URL is correct.
3.  **No thoughts appearing**
    -   Check the WebSocket connection status dot in the status bar (must be green).
4.  **Skeleton not moving**
    -   Verify the AI is returning valid JSON actions (check coordinator logs).
5.  **Supabase connection failed**
    -   Ensure the URL and Anon Key are correct and `pgvector` is enabled in Supabase.
6.  **Low FPS**
    -   Reduce browser window size or close background tabs.
7.  **"Physics instability detected"**
    -   The system will auto-reset. If it persists, try lowering gravity in God Mode.
8.  **Rehydration stuck**
    -   Refresh the browser and reconnect.

## Extending the System

### Adding a new object type
1.  Add the preset to `src/constants/objectPresets.ts`.
2.  Update `src/world/engine/ObjectManager.ts` to handle the new preset ID.
3.  Update the VLM prompt blocks in `coordinator/src/payloadBuilder.ts` to describe the new object.

### Configuring a new training goal
1.  Open God Mode -> Directive.
2.  Switch to Training Mode.
3.  Type the natural language goal (e.g., "Walk toward the red sphere").
4.  The VLM will prioritize this goal in its next thought cycle.
