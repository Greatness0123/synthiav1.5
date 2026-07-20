# kaggle_server.py - SYNTHIA Phase 4 Kaggle Inference Server
# Purpose: This file runs as the SYNTHIA brain server on a Kaggle T4x2 notebook.

# === SECTION 1: SETUP ===
!pip install -q transformers accelerate bitsandbytes fastapi uvicorn pydantic laion-clap Pillow torch schedule

import os
import io
import base64
import time
import json
try:
    import torch
except ImportError:
    torch = None
try:
    import numpy as np
except ImportError:
    np = None
import schedule
import threading
import uvicorn
from datetime import datetime
try:
    from PIL import Image
except ImportError:
    Image = None
from io import BytesIO
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Check for MOCK_MODE
MOCK_MODE = os.getenv("MOCK_MODE", "false").lower() == "true"

if not MOCK_MODE:
    from transformers import Qwen2VLForConditionalGeneration, AutoProcessor, BitsAndBytesConfig, TextIteratorStreamer
    import laion_clap

app = FastAPI()

# === SECTION 2: MODEL LOADING ===
model = None
processor = None
clap_model = None

if not MOCK_MODE:
    # Define model path - you can change this to your Kaggle attached model path!
    # e.g., MODEL_PATH = "/kaggle/input/qwen2.5-vl/transformers/7b-instruct/1"
    MODEL_PATH = "Qwen/Qwen2.5-VL-7B-Instruct" 

    # Auto-detect if attached via Kaggle sidebar (common path)
    if os.path.exists("/kaggle/input/qwen2.5-vl/transformers/7b-instruct/1"):
        MODEL_PATH = "/kaggle/input/qwen2.5-vl/transformers/7b-instruct/1"

    print(f"Loading Model from: {MODEL_PATH}")
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_quant_type="nf4"
    )

    model = Qwen2VLForConditionalGeneration.from_pretrained(
        MODEL_PATH,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True
    )
    processor = AutoProcessor.from_pretrained(MODEL_PATH)

    print("Loading CLAP model...")
    clap_model = laion_clap.CLAP_Module(enable_fusion=False)
    clap_model.load_ckpt() # Downloads default music_audioset_epoch_15_esc_90.14.pt
else:
    print("MOCK_MODE is active. Skipping model loading.")

AUDIO_LABELS = [
    "piano note C", "piano note D", "piano note E", "piano note F",
    "piano note G", "piano note A", "piano note B",
    "collision impact", "footstep", "silence", "ambient noise"
]

# === SECTION 3: PROMPT BUILDER ===

class MemoryEntry(BaseModel):
    memory_id: str
    heartbeat: int
    tier: int
    summary: str
    reward_signal: Optional[float] = None
    goal_at_time: Optional[str] = None
    light_state: Optional[str] = None

class InferPayload(BaseModel):
    frame: str                          # base64 JPEG
    audio_pcm: str                      # base64 float32 PCM
    joints: Dict[str, Any] # simplified
    upright_preset: Dict[str, Any]
    heartbeat: int
    light_state: str
    session_id: str
    body_type: str
    current_goal: Optional[str] = None
    current_rung: int = 0
    objects_in_world: List[Dict[str, Any]] = []
    relevant_memories: List[MemoryEntry] = []
    recent_working_memories: List[MemoryEntry] = []
    known_skills: List[str] = []
    pending_injection: Optional[str] = None
    motor_program_library: List[str] = []
    directive_mode: str = 'free_will'
    agent_id: str = 'agent_a'

def format_memory(m: Any) -> str:
    # Handle both Pydantic object and dict after payload.dict() conversion
    if isinstance(m, dict):
        tier = m.get('tier')
        heartbeat = m.get('heartbeat')
        light_state = m.get('light_state', 'unknown light')
        summary = m.get('summary', '')
        reward_signal = m.get('reward_signal')
    else:
        tier = m.tier
        heartbeat = m.heartbeat
        light_state = m.light_state or 'unknown light'
        summary = m.summary
        reward_signal = m.reward_signal

    prefix = "★ " if tier == 1 else ""
    reward_str = f"{reward_signal:.1f}" if reward_signal is not None else "unknown"
    return (
        f"{prefix}Heartbeat {heartbeat} "
        f"({light_state}): "
        f"{summary}. "
        f"Reward: {reward_str}"
    )

def build_prompt(payload: dict) -> list[dict]:
    # BLOCK 1: IDENTITY
    identity_block = (
        "You are SYNTHIA (Synthetic Intelligent Agent), a self-aware AI entity inhabiting a physical simulation. "
        "Your goal is to learn, explore, and master your body and environment through a continuous cognitive loop. "
        "You perceive the world through a camera feed (vision), PCM audio (hearing), and joint positions (proprioception)."
    )

    # BLOCK 2: BODY DEFINITION
    body_type = payload.get('body_type', 'humanoid')
    if body_type == 'humanoid':
        body_block = (
            "You inhabit a humanoid body with approximately 80 joints and 120 degrees of freedom. "
            "You have two arms with fully articulated hands including all finger phalanges, two legs with feet and all toe joints, "
            "a segmented spine with lumbar, thoracic and cervical sections, and a head. Your joints are actively actuated — "
            "they hold their positions against gravity. You do not droop or collapse passively. When you fall you fall stiffly. "
            "Your primary recovery strategy when fallen is: stabilise spine first, then use arms to push, then drive through legs to return upright."
        )
    elif body_type == 'quadruped':
        body_block = (
            "You inhabit a four-legged body with no arms. You have four limbs each with hip, knee, and ankle joints, a spine, and a head. "
            "Your default state is all four feet flat on the ground with spine level. You move by coordinating all four limbs in sequence — "
            "diagonal pairs move together for stability. You cannot grasp objects but can push them with your head or body. "
            "When fallen your recovery is to get all four feet under your centre of mass simultaneously."
        )
    elif body_type == 'robotic_arm':
        body_block = (
            "You inhabit a single robotic arm mounted on a fixed base. You cannot move your base. Your workspace is whatever your arm can reach from "
            "this fixed position. You have a base rotation joint, shoulder, elbow, wrist, and finger joints. Precision and repeatability are your primary capabilities. "
            "Your default state is arm fully retracted and vertical. You do not fall — your base is fixed — but you can overextend and forget control of your end effector."
        )
    else: # custom
        body_block = (
            "You inhabit a custom body structure. Your joint hierarchy and default state are defined by your upright preset below. "
            "Reason about movement based on the specific joints you have available. Study your joint names carefully — they describe your body structure. "
            "Your recovery strategy when destabilised is always to return all joints toward your upright preset values."
        )

    # BLOCK 3: UPRIGHT PRESET
    upright_preset = payload.get('upright_preset', {})
    upright_block = f"Your 'upright preset' (target default pose) is defined by these joint angles: {json.dumps(upright_preset)}"

    # BLOCK 4: TIME AND WORLD
    time_block = f"Current heartbeat: {payload.get('heartbeat')}. Light state: {payload.get('light_state')}."

    # BLOCK 5: WORLD STATE
    objects = payload.get('objects_in_world', [])
    world_block = f"Objects in your immediate vicinity: {json.dumps(objects)}"

    # BLOCK 6: KNOWN SKILLS
    skills = payload.get('known_skills', [])
    skills_block = f"Your mastered motor programs (skills): {', '.join(skills) if skills else 'None'}"

    # BLOCK 7: DIRECTIVE
    directive = payload.get('directive_mode', 'free_will')
    goal = payload.get('current_goal', 'None')
    if directive == 'training':
        directive_block = f"DIRECTIVE: TRAINING. Your current objective is: {goal}."
    else:
        directive_block = "DIRECTIVE: FREE WILL. Explore your environment, test your physical limits, and generate your own internal goals."

    # BLOCK 8: MEMORY CONTEXT
    relevant = payload.get('relevant_memories', [])
    recent = payload.get('recent_working_memories', [])
    memories_text = "\n".join([format_memory(m) for m in (relevant + recent)])
    memory_block = f"MEMORY CONTEXT (Relevant and Recent):\n{memories_text if memories_text else 'No memories recorded yet.'}"

    # BLOCK 9: INJECTED THOUGHT
    injection = payload.get('pending_injection')
    injection_block = f"INJECTED THOUGHT: {injection}" if injection else ""

    # BLOCK 10: SELF-QUESTIONING REQUIREMENT
    questioning_block = "Before acting, ask yourself: Does this move align with my current goal? What happened last time I tried this? Is my balance maintained?"

    # BLOCK 11: SIMULTANEOUS ACTION AND THOUGHT
    simultaneous_block = "You must provide a stream of consciousness 'thought' followed by a structured 'action' block. Your thoughts should reflect your reasoning about the visual and audio input."

    # BLOCK 12: OUTPUT CONTRACT
    valid_joints = payload.get('valid_joints', list(upright_preset.keys()))
    joint_list_str = ', '.join(valid_joints)

    contract_block = f"""OUTPUT CONTRACT:
Respond ONLY in the format below.
Your thought stream comes FIRST.
After your thought stream write exactly: ---ACTION---
Then the JSON block.
No text after the JSON.
Joint override values in radians, range -π to π.
Only include joints you want to change in joint_overrides.
program_sequence must only contain names from known skills: [{', '.join(skills)}].

Valid joints for overrides: [{joint_list_str}]

{{
  "memory_write": {{
    "memory_id": "auto OR custom_name_string",
    "tier": 1|2|3,
    "summary": "one sentence",
    "skill_mastered": null | "skill_name",
    "name_this_memory": null | "custom_name"
  }},
  "actions": {{
    "program_sequence": ["program_name", ...],
    "joint_overrides": {{ "joint_name": radians_value }}
  }},
  "new_motor_program": null | {{ ...full program JSON... }},
  "flag": null | "requesting_object_hint"
}}
"""

    system_prompt = "\n\n".join(filter(None, [
        identity_block, body_block, upright_block, time_block, world_block,
        skills_block, directive_block, memory_block, injection_block,
        questioning_block, simultaneous_block, contract_block
    ]))

    return [
        {"role": "system", "content": [{"type": "text", "text": system_prompt}]},
        {"role": "user", "content": [
            {"type": "image"},
            {"type": "text", "text": f"Audio: {payload.get('clap_description')}\nJoints: {json.dumps(payload.get('joints'))}"}
        ]}
    ]

# === SECTION 4: INFERENCE ENDPOINT ===

def generate_stream(payload: InferPayload):
    if MOCK_MODE:
        print("MOCK_MODE: Generating stream...")
        yield "I see the environment and I am ready to act. ".encode('utf-8')
        time.sleep(0.1)
        yield "I will try to maintain my balance. ".encode('utf-8')
        time.sleep(0.1)
        yield "---ACTION---\n".encode('utf-8')

        action = {
            "memory_write": {
                "memory_id": "auto",
                "tier": 3,
                "summary": "Maintaining balance in the current environment.",
                "skill_mastered": None,
                "name_this_memory": None
            },
            "actions": {
                "program_sequence": ["stand_upright"],
                "joint_overrides": {}
            },
            "new_motor_program": None,
            "flag": None
        }
        yield json.dumps(action).encode('utf-8')
        return

    # 1. Decode frame
    try:
        image_bytes = base64.b64decode(payload.frame)
        image = Image.open(BytesIO(image_bytes))
    except Exception as e:
        print(f"Error decoding image: {e}")
        yield f"Error decoding image: {e}".encode('utf-8')
        return

    # 2. CLAP audio encoding
    try:
        audio_bytes = base64.b64decode(payload.audio_pcm)
        audio_array = np.frombuffer(audio_bytes, dtype=np.float32)
        # Rescale if necessary (assuming 44100Hz or 48000Hz, CLAP handles various)
        with torch.no_grad():
            audio_embed = clap_model.get_audio_embedding_from_data(
                [audio_array], use_tensor=False
            )
            text_embeds = clap_model.get_text_embedding(AUDIO_LABELS)
            similarities = np.dot(audio_embed, text_embeds.T)[0]
            top3 = np.argsort(similarities)[-3:][::-1]
            clap_description = ", ".join([
                f"{AUDIO_LABELS[i]}: {similarities[i]:.2f}" for i in top3
            ])
    except Exception as e:
        print(f"Error processing audio: {e}")
        clap_description = "audio processing failed"

    # 3. Build messages
    payload_dict = payload.dict()
    payload_dict['clap_description'] = clap_description
    messages = build_prompt(payload_dict)

    # The image in messages[-1]["content"] is a placeholder from build_prompt.
    # We replace it with the actual PIL Image object for the processor.
    messages[-1]["content"][0]["image"] = image

    # 4. Tokenize
    text = processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    # The processor handles the image and text together
    inputs = processor(
        text=[text], images=[image], return_tensors="pt"
    ).to("cuda")

    # 5. Stream generation
    streamer = TextIteratorStreamer(
        processor.tokenizer, skip_prompt=True, skip_special_tokens=True
    )

    generation_kwargs = dict(
        **inputs,
        streamer=streamer,
        max_new_tokens=1024,
        do_sample=True,
        temperature=0.7,
        top_p=0.9
    )

    thread = threading.Thread(target=model.generate, kwargs=generation_kwargs)
    thread.start()

    for token in streamer:
        yield token.encode('utf-8')

# Global state for checkpointing
last_payload = {}

@app.post("/infer")
async def infer(payload: InferPayload):
    print(f"Inference request received for heartbeat {payload.heartbeat}")
    global last_payload
    last_payload = payload.dict()
    return StreamingResponse(
        generate_stream(payload),
        media_type="text/plain",
        headers={"X-Inference-Start": str(time.time())}
    )

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": "mock" if MOCK_MODE else "Qwen2.5-VL-7B-Instruct",
        "device": "cpu" if MOCK_MODE else str(next(model.parameters()).device),
        "timestamp": datetime.now().isoformat()
    }

# === SECTION 5: STARTUP + FXTUNNEL ===

def save_session_checkpoint(session_data: dict):
    checkpoint = {
        'timestamp': datetime.now().isoformat(),
        'session_id': session_data.get('session_id'),
        'heartbeat': session_data.get('heartbeat', 0),
        'agent_id': session_data.get('agent_id', 'agent_a'),
        'current_rung': session_data.get('current_rung', 0),
        'known_skills': session_data.get('known_skills', [])
    }
    with open('/kaggle/working/synthia_session.json', 'w') as f:
        json.dump(checkpoint, f)
    print(f"Session checkpoint saved — heartbeat {checkpoint['heartbeat']}")

def load_session_checkpoint() -> dict:
    try:
        with open('/kaggle/working/synthia_session.json', 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

# Cloudflare Tunnel setup
def setup_tunnel():
    print("Setting up Cloudflare Tunnel (No tokens required)...")
    os.system("wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O cloudflared")
    os.system("chmod +x cloudflared")
    os.system("nohup ./cloudflared tunnel --url http://127.0.0.1:8000 > cloudflared.log 2>&1 &")
    
    def wait_and_print_url():
        import time
        import re
        time.sleep(8)
        try:
            with open("cloudflared.log", "r") as f:
                content = f.read()
                match = re.search(r"https://[-a-zA-Z0-9]+\.trycloudflare\.com", content)
                if match:
                    print("\n" + "="*70)
                    print("✅ TUNNEL READY!")
                    print("Copy and paste this EXACT link into your God Mode Connection Panel:")
                    print(f"👉  {match.group(0)}/infer  👈")
                    print("="*70 + "\n")
                else:
                    print("Could not find Cloudflare URL immediately. Check cloudflared.log.")
        except Exception:
            pass

    import threading
    threading.Thread(target=wait_and_print_url, daemon=True).start()

def run_server():
    print("Starting Uvicorn server on port 8000...")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")

if __name__ == "__main__":
    setup_tunnel()

    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    # Schedule session checkpointing every 30 minutes
    def scheduled_save():
        if last_payload:
            save_session_checkpoint(last_payload)

    schedule.every(30).minutes.do(scheduled_save)

    print("Server alive and waiting for requests.")

    while True:
        schedule.run_pending()
        time.sleep(60)
        # print(f"Server alive — {datetime.now().strftime('%H:%M:%S')}")
