# PHASE 1 — Project Scaffold & Design System

## Component Tree
```
src/
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx         ← Main layout, top bar, camera toggle
│   │   └── StatusBar.tsx        ← Bottom metrics bar
│   ├── world/
│   │   ├── WorldViewport.tsx    ← 3D canvas placeholder
│   │   └── ModelInputPiP.tsx    ← Sending to AI preview overlay
│   ├── agent/
│   │   ├── AgentStatus.tsx      ← Rung indicator, skill count
│   │   ├── ThoughtBank.tsx      ← Scrolling thought stream (Fraunces font)
│   │   ├── InjectionInput.tsx   ← Thought injection input
│   │   └── MemoryViewer.tsx     ← Collapsible memory panel
│   ├── godmode/
│   │   ├── GodModePanel.tsx     ← Left slide-out drawer
│   │   ├── PhysicsControls.tsx  ← Gravity/Friction sliders
│   │   ├── BodyControls.tsx     ← Body type and mode selectors
│   │   ├── DirectivePanel.tsx   ← Free Will / Training toggle + Goal input
│   │   ├── ConnectionPanel.tsx  ← Endpoint URL + Supabase config
│   │   └── ObjectSpawner.tsx    ← Grid overlay for spawning objects
│   ├── export/
│   │   └── ExportModal.tsx      ← Dataset export configuration
│   └── ui/
│       ├── Panel.tsx            ← Reusable container
│       ├── Badge.tsx            ← Status badges
│       ├── Button.tsx           ← Design system buttons
│       ├── Slider.tsx           ← Custom range input
│       ├── Toggle.tsx           ← Custom switch
│       ├── Tooltip.tsx          ← Hover labels
│       └── Toast.tsx            ← Custom Sonner variants
```

## Store Shapes

### connectionStore
- `endpoint`: string
- `supabaseUrl`: string
- `supabaseKey`: string
- `status`: 'disconnected' | 'connecting' | 'connected' | 'error'
- `rtt`: number
- `inferenceTime`: number
- `frameSize`: number
- `fps`: number

### agentStore
- `thoughts`: Thought[]
- `memories`: Memory[]
- `skills`: string[]
- `currentRung`: number
- `currentGoal`: string | null
- `directiveMode`: 'free_will' | 'training'
- `heartbeat`: number
- `lightState`: 'day' | 'night'
- `status`: AgentStatus
- `pendingInjection`: string | null

### worldStore
- `objects`: WorldObject[]
- `gravity`: number
- `globalFriction`: number
- `bodyType`: BodyType
- `bodyMode`: 'rigid' | 'ragdoll'
- `spawnPoint`: Vector3
- `cameraMode`: CameraMode
- `godModeOpen`: boolean
- `sessionName`: string

### uiStore
- `activeRightPanelTab`: 'thoughts' | 'memories'
- `exportModalOpen`: boolean
- `objectSpawnerOpen`: boolean
- `rehydrationModalOpen`: boolean

## CSS Variable Reference
- `--bg-primary`: #0a0a0a
- `--bg-panel`: #111111
- `--bg-elevated`: #1a1a1a
- `--bg-hover`: #222222
- `--border`: #2a2a2a
- `--accent-blue`: #4a9eff (Physics/Connected)
- `--accent-amber`: #f59e0b (Thinking/Warning)
- `--accent-green`: #22c55e (Success/Connected)
- `--accent-red`: #ef4444 (Error/Fall)
- `--accent-purple`: #a78bfa (Agent/Thoughts)
- `--accent-teal`: #2dd4bf (Memory)

## How to add a new toast type
1. Open `src/components/ui/Toast.tsx`.
2. Add a new method to the `synthiaToast` object.
3. Use `toast.custom` with a `ToastContent` component, specifying your preferred icon and accent color.

## How to add a new God Mode panel section
1. Create a new component in `src/components/godmode/`.
2. Wrap its content in a `Panel` or use the standard `p-4 border-t border-border` pattern.
3. Import and add it to the list of sections in `src/components/godmode/GodModePanel.tsx`.
