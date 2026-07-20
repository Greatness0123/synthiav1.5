# PHASE 4 DOCS — Kaggle Inference Server

This document explains how to set up and run the `kaggle_server.py` on a Kaggle notebook to serve as the SYNTHIA brain.

## Prerequisites
- A Kaggle account.
- A new Kaggle Notebook with **GPU T4 x2** accelerator enabled.
- Internet access enabled in the Kaggle notebook settings.
- An account/subdomain at [fxtun.dev](https://fxtun.dev).

## Step-by-Step Setup

1. **Create Notebook**: Open a new notebook on Kaggle.
2. **Enable GPU**: In the right-hand sidebar, under "Settings", set "Accelerator" to "GPU T4 x2".
3. **Paste Code**: Copy the entire content of `kaggle_server.py` and paste it into the first code cell.
4. **Configure fxTunnel**:
   - In the `frpc_config` section of the code, change `synthia-brain` to your chosen subdomain registered at `fxtun.dev`.
   - Update `custom_domains = your-subdomain.fxtun.dev` accordingly.
5. **Run Cell**: Execute the cell. It will:
   - Install all necessary dependencies (`transformers`, `laion-clap`, `fastapi`, etc.).
   - Load the Qwen2.5-VL-7B-Instruct model in 4-bit quantization.
   - Load the CLAP audio model.
   - Start the FastAPI server on port 8000.
   - Start the fxTunnel (`frpc`) to expose the server to the internet.
6. **Verify**:
   - Look for the output `Server alive and waiting for requests.`
   - Check the printed URL (e.g., `https://your-subdomain.fxtun.dev`).
   - You can test the health by visiting `https://your-subdomain.fxtun.dev/health` in your browser.

## Environment Variables
No specific environment variables are required as the script is self-contained. However, ensure `KAGGLE_KERNEL_RUN_TYPE` is standard (interactive).

## Checkpointing
The server automatically saves a session state checkpoint every 30 minutes to `/kaggle/working/synthia_session.json`. This includes:
- `heartbeat`
- `session_id`
- `agent_id`
- `current_rung`
- `known_skills`

The model weights are NOT checkpointed as they are loaded fresh from HuggingFace on each start.

## Restoring a Session
If the Kaggle kernel restarts:
1. Re-run the notebook cell.
2. The server will start fresh.
3. The coordinator will sync the current state from Supabase once it reconnects to the new Kaggle URL.

## Adding a New Body Type
To add a new body type to the prompt builder:
1. Locate the `build_prompt` function in `kaggle_server.py`.
2. Add a new `elif body_type == 'your_type':` block in the BODY DEFINITION section.
3. Provide a natural language description of the body structure and recovery strategy.

## Troubleshooting
- **Out of Memory (OOM)**: Ensure you are using "GPU T4 x2". The model is loaded in 4-bit to fit comfortably.
- **Tunnel Connection Failed**: Verify your `fxtun.dev` subdomain is active and the `frpc.ini` configuration matches your credentials.
- **Slow Inference**: The first request might be slow as components initialize. Subsequent requests should be faster.
