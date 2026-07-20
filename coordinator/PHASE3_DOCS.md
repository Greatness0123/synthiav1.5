# PHASE 3: Coordinator Server

The Coordinator Server (Machine A) acts as the bridge between the SYNTHIA Frontend (Machine B), the Kaggle Inference Endpoint, and the Supabase persistent storage.

## Components

### 1. Fastify + WebSocket Server (`server.ts`)
- Listens on `ws://localhost:3001`.
- Handles real-time communication between Machine B and Machine A.
- Routes incoming `world_state` to the appropriate `AgentLoop`.
- Manages `export_request` and `inject_thought` commands.

### 2. Agent Loop (`agentLoop.ts`)
- Manages the main cognitive cycle for an agent (default 2000ms).
- Orchestrates payload building, inference, action execution, and memory storage.
- Implements retry logic and validation for AI-generated JSON actions.

### 3. Payload Builder (`payloadBuilder.ts`)
- Assembles the context for the AI.
- Retrieves relevant and recent memories using the `MemoryManager`.
- Incorporates world state (visuals, audio, joints), goals, and pending thought injections.

### 4. Embedding Engine (`embeddingEngine.ts`)
- Uses `@xenova/transformers` to run the `all-MiniLM-L6-v2` model locally in Node.js.
- Produces 384-dimensional vectors used for memory retrieval.

### 5. Memory Manager (`memoryManager.ts`)
- Interface for Supabase `memories` table.
- Implements vector similarity search via the `match_memories` RPC.
- Handles frame uploads to Supabase Storage.
- Implements `pruneOld()` to manage storage for free-tier users.

### 6. Inference Client (`inferenceClient.ts`)
- Connects to the Kaggle raw text streaming endpoint.
- Forwards thought tokens in real-time.
- Parses the structured JSON block after the `---ACTION---` separator.

### 7. Dataset Exporter (`datasetExporter.ts`)
- Generates datasets in **LeRobot** (Parquet + MP4) and **JSONL** formats.
- Uses `apache-arrow` for Parquet and `ffmpeg-static` for video stitching.

## WebSocket Protocol

### From Frontend (Machine B)
- `world_state`: Updates the coordinator with the latest sensor data.
- `inject_thought`: Manually injects a thought into the next cycle.
- `outcome`: Reports the result of an action.
- `set_endpoint`: Configures the inference URL.
- `set_supabase`: Configures Supabase credentials.
- `set_directive`: Updates the agent's goal and mode.
- `export_request`: Triggers a dataset export.

### To Frontend (Machine B)
- `thought_token`: Real-time streaming tokens.
- `thought_complete`: Signal that thinking is finished.
- `action`: Commands for the motor system.
- `memory_saved`: Confirmation of persistence.
- `skill_mastered`: Milestone notification.
- `connection_status`: Latency and RTT reports.
- `export_progress` / `export_complete`: Export status.
- `error`: Generic error notification.

## Setup Instructions

1. **Install Dependencies**:
   ```bash
   cd coordinator
   npm install
   ```

2. **Configure Environment**:
   Create a `.env` file in the `coordinator/` directory:
   ```env
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ```

3. **Database Setup**:
   Run the SQL provided in `supabase_schema.sql` in the project root within the Supabase SQL Editor to create the necessary tables and the `match_memories` RPC.

4. **Run the Server**:
   ```bash
   npm run dev
   ```

## Development and Testing
- Run tests: `npm test`
- Type check: `npx tsc --noEmit`
