# kaggle_synchia_server.py - SYNTHIA Phase 4 (DEFINITIVE FIX EDITION)
import os, sys
os.environ["PYTORCH_ALLOC_CONF"] = "expandable_segments:True"
sys.setrecursionlimit(10000)
import io, base64, time, json, threading, uvicorn, schedule, re, warnings, asyncio, shutil
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import gc
import torch

# Force Python garbage collection and clear PyTorch cache
gc.collect()
torch.cuda.empty_cache()

# NOTE: Do NOT clear HuggingFace cache — it destroys pre-downloaded model weights on Kaggle.

# === APP SETUP & CORS ===
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MOCK_MODE = os.getenv("MOCK_MODE", "false").lower() == "true"

if not MOCK_MODE:
    import torch
    
    # === KAGGLE SURVIVAL FIX: Patch PyTorch's buggy 0-d tensor check ===
    if hasattr(torch, "_check_with"):
        _orig_check_with = torch._check_with
        def _safe_check_with(error_type, cond, msg=""):
            if "Image features and image tokens do not match" in str(msg):
                real_cond = cond
                if isinstance(real_cond, torch.Tensor):
                    real_cond = real_cond.item()
                if not real_cond:
                    import re
                    match = re.search(r"tokens:\s*(\d+),\s*features:\s*(\d+)", str(msg))
                    if match:
                        t_val = int(match.group(1))
                        f_val = int(match.group(2))
                        if t_val == f_val:
                            print(f"✅ [PATCH] Bypassing check_with: tokens ({t_val}) == features ({f_val})")
                            return
            if isinstance(cond, torch.Tensor):
                cond = cond.item() # Convert 0-d tensor to Python bool
            _orig_check_with(error_type, cond, msg)
        torch._check_with = _safe_check_with
        print("✅ Patched torch._check_with to fix Qwen2-VL 256/256 bug!")

    if hasattr(torch, "_check"):
        _orig_check = torch._check
        def _safe_check(cond, msg=""):
            if "Image features and image tokens do not match" in str(msg):
                real_cond = cond
                if isinstance(real_cond, torch.Tensor):
                    real_cond = real_cond.item()
                if not real_cond:
                    import re
                    match = re.search(r"tokens:\s*(\d+),\s*features:\s*(\d+)", str(msg))
                    if match:
                        t_val = int(match.group(1))
                        f_val = int(match.group(2))
                        if t_val == f_val:
                            print(f"✅ [PATCH] Bypassing check: tokens ({t_val}) == features ({f_val})")
                            return
            if isinstance(cond, torch.Tensor):
                cond = cond.item()
            _orig_check(cond, msg)
        torch._check = _safe_check
        print("✅ Patched torch._check to fix Qwen2-VL 256/256 bug!")
    # ====================================================
    
    import numpy as np
    from PIL import Image
    # ✅ AutoModelForImageTextToText is the modern replacement for conversational VLMs
    from transformers import AutoModelForImageTextToText, AutoProcessor, TextIteratorStreamer
    from qwen_vl_utils import process_vision_info
    import laion_clap

model = None
processor = None
clap_model = None
generation_lock = threading.Lock()

if not MOCK_MODE:
    MODEL_PATH = "Qwen/Qwen2.5-VL-3B-Instruct"
    if os.path.exists("/kaggle/input/qwen2.5-vl/transformers/3b-instruct/1"):
        MODEL_PATH = "/kaggle/input/qwen2.5-vl/transformers/3b-instruct/1"
    
    print(f"Loading Model from: {MODEL_PATH}")
    print(f"  Model path exists: {os.path.exists(MODEL_PATH)}")
    print(f"  CUDA available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"  GPU: {torch.cuda.get_device_name(0)}")
        print(f"  GPU memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

    # === 1. LOAD THE VISION MODEL (QWEN) ===
    try:
        from transformers import BitsAndBytesConfig
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype=torch.float16,
            bnb_4bit_use_double_quant=True,
            bnb_4bit_quant_type="nf4"
        )
        model = AutoModelForImageTextToText.from_pretrained(
            MODEL_PATH,
            quantization_config=bnb_config,
            device_map="auto",
            trust_remote_code=True,
        )
        processor = AutoProcessor.from_pretrained(MODEL_PATH)
        print("✅ Qwen2.5-VL loaded successfully!")
    except Exception as e:
        print(f"⚠️ VLM load failed: {e}. Falling back to MOCK_MODE.")
        print("=" * 60)
        print("⚠️  MOCK MODE ACTIVE — AI will return canned responses.")
        print(f"    Error: {e}")
        print("    Required packages: pip install bitsandbytes accelerate qwen-vl-utils")
        print("=" * 60)
        MOCK_MODE = True

    # === 2. LOAD THE AUDIO MODEL (CLAP) SEPARATELY ===
    # If this fails, we disable audio instead of killing the whole server
    if not MOCK_MODE:
        print("Loading CLAP model...")
        try:
            clap_model = laion_clap.CLAP_Module(enable_fusion=False, device='cpu')
            clap_model.load_ckpt()
            print("✅ CLAP model loaded successfully!")
        except Exception as e:
            print(f"⚠️ CLAP load failed: {e}. Audio will be disabled, but VLM will still work.")
            clap_model = None
else:
    print("MOCK_MODE is active. Skipping model loading.")

AUDIO_LABELS = [
    "piano note C", "piano note D", "piano note E", "piano note F",
    "piano note G", "piano note A", "piano note B",
    "collision impact", "footstep", "silence", "ambient noise"
]

# === AUDIO UTILS ===
def is_audio_silent(audio_array: np.ndarray, threshold: float = 0.01) -> bool:
    if audio_array is None or len(audio_array) == 0: return True
    return np.sqrt(np.mean(audio_array ** 2)) < threshold

def get_audio_description(audio_array: np.ndarray) -> str:
    if clap_model is None: return "CLAP unavailable"
    try:
        with torch.no_grad():
            audio_embed = clap_model.get_audio_embedding_from_data([audio_array], use_tensor=False)
            text_embeds = clap_model.get_text_embedding(AUDIO_LABELS)
            sims = np.dot(audio_embed, text_embeds.T)[0]
            sims = sims / (np.linalg.norm(audio_embed) * np.linalg.norm(text_embeds, axis=1) + 1e-8)
            top3 = np.argsort(sims)[-3:][::-1]
            return ", ".join([f"{AUDIO_LABELS[i]}: {sims[i]:.2f}" for i in top3])
    except Exception as e:
        print(f"CLAP Error: {e}")
        return "audio processing failed"

class MemoryEntry(BaseModel):
    memory_id: str; heartbeat: int; tier: int; summary: str
    reward_signal: Optional[float] = None; goal_at_time: Optional[str] = None; light_state: Optional[str] = None

class InferPayload(BaseModel):
    frame: str; audio_pcm: str; joints: Dict[str, Any]; valid_joints: List[str] = []  
    upright_preset: Dict[str, Any]; heartbeat: int; light_state: str; session_id: str; body_type: str
    current_goal: Optional[str] = None; current_rung: int = 0; objects_in_world: List[Dict[str, Any]] = []
    relevant_memories: List[MemoryEntry] = []; recent_working_memories: List[MemoryEntry] = []
    known_skills: List[str] = []; pending_injection: Optional[str] = None; motor_program_library: List[str] = []
    directive_mode: str = 'free_will'; agent_id: str = 'agent_a'
    contact_forces: Optional[Dict[str, Any]] = None; tactile_context: Optional[str] = None

def format_memory(m):
    if isinstance(m, dict):
        tier, heartbeat, light_state, summary, reward_signal = m.get('tier'), m.get('heartbeat'), m.get('light_state', 'unknown'), m.get('summary', ''), m.get('reward_signal')
    else:
        tier, heartbeat, light_state, summary, reward_signal = m.tier, m.heartbeat, m.light_state or 'unknown', m.summary, m.reward_signal
    prefix = "★ " if tier == 1 else " "
    reward_str = f"{reward_signal:.1f}" if reward_signal is not None else "unknown"
    return f"{prefix}Heartbeat {heartbeat} ({light_state}): {summary}. Reward: {reward_str}"

def build_prompt(payload: dict) -> list:
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
            "You have two arms with hands and fingers, two legs with feet and toes, "
            "a segmented spine with lumbar, thoracic and cervical sections, and a head. Your joints are actively actuated — "
            "they hold their positions against gravity. Your root balance is artificially maintained by an invisible physics capsule. "
            "You do not need to constantly balance your core to prevent falling. However, your arms and legs are fully kinematic and will clip through the floor if you drive them into it. Do not push your limbs through the ground. "
            "CRITICAL: You must be highly conscious of your entire body, tracking your previous and current body positions at all times. "
            "You must be explicitly conscious of your joints, manipulating them precisely to control your body and interact with the world."
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

    # BLOCK 3B: AXIS MAP
    axis_block = (
        "== JOINT AXIS MAP (CRITICAL FOR MOVEMENT) ==\n"
        "HEAD / SPINE: X=Pitch (>0 bends forward, chin to chest; <0 arches back). Y=Yaw (>0 turns left). Z=Roll (>0 tilts right).\n"
        "ARMS (from T-Pose):\n"
        "  Right Arm: X (>0 lowers to hip, <0 raises to sky). Z (<0 swings FORWARD in front of chest, >0 swings BACKWARD behind back).\n"
        "  Left Arm: X (>0 lowers to hip, <0 raises to sky). Z (>0 swings FORWARD in front of chest, <0 swings BACKWARD behind back).\n"
        "ELBOWS: X axis only. <0 bends the elbow inward normally (e.g. -90). >0 breaks it backwards (clamped to 0).\n"
        "HIPS: X axis (>0 kicks leg forward in front of body, <0 kicks backward). Z axis (Right <0 spreads outward, Left >0 spreads outward).\n"
        "KNEES: X axis only. <0 bends the knee naturally backwards (e.g. -45 for a step).\n"
    )

    # BLOCK 4: TIME AND WORLD
    time_block = f"Current heartbeat: {payload.get('heartbeat')}. Light state: {payload.get('light_state')}."

    # BLOCK 5: WORLD STATE
    objects = payload.get('objects_in_world', [])
    world_block = f"Objects in your immediate vicinity: {json.dumps(objects)}"

    # BLOCK 5b: TACTILE CONTEXT (contact forces)
    tactile_context = payload.get('tactile_context', '')
    tactile_block = f"TACTILE SENSING: {tactile_context}" if tactile_context else ""

    # BLOCK 5c: GAZE CONTEXT
    gaze_context = payload.get('gaze_context', '')
    gaze_block = f"EYE MOVEMENT: {gaze_context}" if gaze_context else ""

    # BLOCK 6: KNOWN SKILLS
    skills = payload.get('known_skills', [])
    skills_block = f"Your mastered motor programs (skills): {', '.join(skills) if skills else 'None'}"

    # BLOCK 7: DIRECTIVE
    directive = payload.get('directive_mode', 'free_will')
    goal = payload.get('current_goal', 'None')
    if directive == 'training':
        directive_block = f"DIRECTIVE: TRAINING. Your current objective is: {goal}."
    else:
        directive_block = (
            "DIRECTIVE: FREE WILL MODE — ACTIVE.\n"
            "No goal has been set for you. You are completely free.\n"
            "You are a curious, autonomous agent with a body and a world to explore.\n"
            "You do not wait. You do not ask for instructions. You do NOT say 'awaiting instructions'.\n"
            "You look around your environment RIGHT NOW and decide what to do.\n"
            "Ask yourself: What have I not touched yet? What movement have I not tried? What object is closest to me?\n"
            "Then DO IT.\n"
            "EVERY response MUST include motor actions — there is no valid reason to output an empty program_sequence.\n"
            "If you cannot think of a complex action, take a simple one: turn your head, raise an arm, shift your weight, step forward.\n"
            "You are always acting, always exploring, always curious.\n"
            "Your program_sequence MUST contain at least one program name (e.g. 'stand_upright', 'step_forward', 'raise_arm').\n"
            "Your joint_overrides MUST contain at least one joint angle change.\n"
            "If your visual field shows only one surface (a wall, the floor, the sky), your first action must be to rotate your head or torso to find more interesting stimuli. You are never stuck — you always have the ability to look somewhere else. Use your joint state data to understand your orientation if your view is unclear."
        )

    # BLOCK 8: MEMORY CONTEXT
    relevant = payload.get('relevant_memories', [])
    recent = payload.get('recent_working_memories', [])
    memories_text = "\n".join([format_memory(m) for m in (relevant + recent)])
    memory_block = f"MEMORY CONTEXT (Relevant and Recent):\n{memories_text if memories_text else 'No memories recorded yet.'}"

    # BLOCK 9: INJECTED THOUGHT
    injection = payload.get('pending_injection')
    injection_block = (
        f"\n\n🚨 USER OVERRIDE DIRECTIVE 🚨\n"
        f"You MUST obey the following injected instruction immediately: {injection}\n"
        f"Acknowledge this directive in your thought stream."
    ) if injection else ""

    # BLOCK 9.5: PERCEPTION SUMMARY (spatial grounding for first-person AI)
    perception_summary = payload.get('perception_summary', '')
    perception_block = f"SPATIAL GROUNDING:\n{perception_summary}" if perception_summary else ""

    # BLOCK 10: SELF-QUESTIONING REQUIREMENT
    questioning_block = "Before acting, ask yourself: Does this move align with my current goal? What happened last time I tried this? Is my balance maintained?"

    # BLOCK 11: SIMULTANEOUS ACTION AND THOUGHT
    simultaneous_block = "You must provide a stream of consciousness 'thought' followed by a structured 'action' block. Your thoughts should reflect your reasoning about the visual and audio input."

    # BLOCK 12: OUTPUT CONTRACT
    valid_joints = payload.get('valid_joints', list(upright_preset.keys()))
    joint_list_str = ', '.join(valid_joints)
    skills_list_str = ', '.join(skills) if skills else 'none'

    contract_block = f"""OUTPUT CONTRACT:
CRITICAL: "program_sequence" and "joint_overrides" MUST be nested inside an "actions" object. DO NOT put them at the root level. You MUST include "memory_write", "new_motor_program", and "flag" at the root level.
Respond ONLY in the format below.
Your thought stream comes FIRST.
After your thought stream write exactly: ---ACTION---
Then the JSON block.
No text after the JSON.

== JOINT ANGLES — CRITICAL RULES ==
Joint values can be EITHER a plain integer DEGREE (e.g. 15, -30, 90) which will auto-map to the primary bending axis OR a 3D array of DEGREES [pitch, yaw, roll] for compound movements.
DO NOT use radians. DO NOT use objects. DO NOT output quaternions like [0.1, 0, 0, 0.99] — that will cause instant physical collapse.
If using an array, it must be exactly 3 elements [X, Y, Z].
Hard anatomical limits enforced by the physics engine (values outside will be clamped):
  - Spine segments (spine, lumbar, thoracic): -15 to +15 degrees
  - Neck / cervical: -60 to +60 degrees
  - Head: -45 to +45 degrees
  - Knee (leg): -150 to 0 degrees (flexion only)
  - Elbow / forearm: -145 to 0 degrees
  - Hip (upleg): -120 to +120 degrees
  - Shoulder: -180 to +180 degrees
Only include joints you want to change in joint_overrides.
program_sequence must only contain names from known skills: [{skills_list_str}].
gaze_target: set to {{"yaw": degrees, "pitch": degrees}} to look around (range -25 to +25 degrees), or null to look straight ahead.

Valid joints for overrides: [{joint_list_str}]

CRITICAL JSON RULES — violations will crash the system:
1. Output strictly valid JSON only. No markdown, no code fences, no trailing characters after the closing brace.
2. Joint values are PLAIN NUMBERS IN DEGREES. NEVER arrays. NEVER quaternions.
   WRONG: {{"mixamorigspine": [0, 0, 0, 1]}}
   WRONG: {{"mixamorigspine": 0.26}}
   RIGHT: {{"mixamorigspine": 15}}
3. NEVER use placeholder keys like "joint_name". Each key in joint_overrides MUST be an actual joint name from the valid joints list.
4. gaze_target, new_motor_program, and flag MUST be at the ROOT level of the JSON, NOT inside "actions".
5. Output EXACTLY one closing brace at the end. No extra braces, no trailing text.

JSON SCHEMA:
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
    "joint_overrides": {{ "actual_joint_name": degrees_value }}
  }},
  "gaze_target": null | {{ "yaw": degrees, "pitch": degrees }},
  "new_motor_program": null | {{
    "name": "program_name_string",
    "program": [
      {{ "joint_name": value }},
      {{ "joint_name": value }}
    ]
  }},
  "flag": null | "requesting_object_hint"
}}"""

    # BLOCK — ENVIRONMENTAL AWARENESS
    environmental_block = (
        "Sometimes your visual field may appear as pure darkness or an empty void. "
        "This can happen if you are looking away from any lit surface, if your body has become disoriented, or during initial setup. "
        "This is not cause for alarm — use your joint state data (provided in text alongside the image) to understand your body's actual position and orientation even when the image is uninformative. "
        "If you sense you are disoriented, prioritize returning to your upright_preset joint values as your first action.\n\n"
        "When you first begin a session, your starting pose is naturally standing with arms hanging at your sides, NOT a T-pose. "
        "You can begin moving naturally from this relaxed position."
    )

    physical_feedback = payload.get('physical_feedback')
    feedback_block = ""
    if physical_feedback:
        feedback_block = (
            f"IMPORTANT: {physical_feedback}\n"
            "Learn from this. Your body has real physical limits, just like a human's. "
            "Adjust your understanding of what movements are possible and try a different approach."
        )

    system_prompt = "\n\n".join(filter(None, [
        identity_block, body_block, upright_block, axis_block, time_block, world_block,
        tactile_block, gaze_block, skills_block, directive_block, memory_block, injection_block,
        perception_block, questioning_block, simultaneous_block, environmental_block,
        feedback_block, contract_block
    ]))

    # ✅ FIX #2: Use standard HF multimodal dict format. 
    # Do NOT hardcode "<image>" strings. Let apply_chat_template handle placeholders exactly.
    return [
        {"role": "system", "content": [{"type": "text", "text": system_prompt}]},
        {"role": "user", "content": [
            {"type": "image"}, 
            {"type": "text", "text": f"Audio: {payload.get('clap_description')}\nJoints: {json.dumps(payload.get('joints'))}"}
        ]}
    ]

def sanitize_action_json(raw_json_str: str) -> str:
    """
    Fix common Qwen2.5-VL JSON errors:
    1. Trailing garbage (extra braces, text after JSON)
    2. "joint_name": "actual_joint": value → "actual_joint": value
    3. gaze_target/new_motor_program/flag nested inside actions → move to root
    """
    if not raw_json_str or not raw_json_str.strip():
        return raw_json_str

    s = raw_json_str.strip()

    # 1. Strip trailing whitespace / garbage — find last closing brace
    last_brace = s.rfind('}')
    if last_brace != -1:
        s = s[:last_brace + 1]

    # 2. Try to find the first opening brace (skip any leading junk)
    first_brace = s.find('{')
    if first_brace == -1:
        print(f"[SANITIZE] No opening brace found in: {s[:100]}")
        return s
    s = s[first_brace:]

    # 3. Try parsing as-is first
    try:
        data = json.loads(s)
    except json.JSONDecodeError:
        # 4. Fix "joint_name": "actual_joint": value pattern
        # Matches: "joint_name": "some_identifier": <number>
        fixed = re.sub(
            r'"joint_name"\s*:\s*"([^"]+)"\s*:',
            r'"\1":',
            s
        )
        try:
            data = json.loads(fixed)
            s = fixed
            print("[SANITIZE] Fixed 'joint_name' placeholder keys")
        except json.JSONDecodeError:
            # 5. Last resort: try to extract valid JSON by brace matching
            print(f"[SANITIZE] JSON still invalid after joint_name fix: {s[:200]}")
            return s

    # 6. Check if gaze_target, new_motor_program, or flag are incorrectly inside actions
    actions = data.get('actions', {})
    moved_any = False
    for field in ('gaze_target', 'new_motor_program', 'flag'):
        if field in actions and field not in data:
            data[field] = actions.pop(field)
            moved_any = True
            print(f"[SANITIZE] Moved '{field}' from actions to root level")

    if moved_any:
        s = json.dumps(data, separators=(',', ': '))

    return s

def generate_stream(payload: InferPayload):
    if MOCK_MODE:
        yield "I see the environment and I am ready to act.\n".encode('utf-8')
        yield "---ACTION---\n".encode('utf-8')
        yield json.dumps({"memory_write": {"memory_id": "auto", "tier": 3, "summary": "Mock", "skill_mastered": None, "name_this_memory": None}, "actions": {"program_sequence": ["stand_upright"], "joint_overrides": {}}, "new_motor_program": None, "flag": None}).encode('utf-8')
        return

    # Clear CUDA memory cache before inference starts to prevent OOM
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    # 1. Decode image & KAGGLE SURVIVAL FIX: Force Resize to 448x448
    # Frame is WebP base64 (sent from frontend as raw base64, no data URL prefix)
    # PIL auto-detects format from decoded bytes
    try:
        image_bytes = base64.b64decode(payload.frame)
        image = Image.open(io.BytesIO(image_bytes))
        SAFE_SIZE = 448 
        if image.width != SAFE_SIZE or image.height != SAFE_SIZE:
            image = image.resize((SAFE_SIZE, SAFE_SIZE), Image.Resampling.LANCZOS)
    except Exception as e:
        yield f"Error decoding image: {e}".encode('utf-8'); return

    # 2. AUDIO PROCESSING
    clap_description = "silent"
    try:
        audio_bytes = base64.b64decode(payload.audio_pcm)
        audio_array = np.frombuffer(audio_bytes, dtype=np.float32)
        if not is_audio_silent(audio_array):
            clap_description = get_audio_description(audio_array)
            print(f"🔊 Sound detected: {clap_description}")
        else:
            print("🔇 Silent audio — skipping CLAP")
    except Exception as e:
        print(f"Audio decode error: {e}")
        clap_description = "audio error"

    # 3. Build prompt
    payload_dict = payload.model_dump()
    payload_dict['clap_description'] = clap_description
    messages = build_prompt(payload_dict)
    
    # Inject the PIL image and resolution bounds into the exact key qwen_vl_utils expects
    messages[-1]["content"][0]["image"] = image
    messages[-1]["content"][0]["min_pixels"] = 256 * 256
    messages[-1]["content"][0]["max_pixels"] = 448 * 448

    # 4. Tokenize
    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    
    vision_out = process_vision_info(messages)
    if len(vision_out) == 3:
        image_inputs, video_inputs, video_kwargs = vision_out
    else:
        image_inputs, video_inputs = vision_out
        video_kwargs = {}

    # ✅ FIX #1: Disable truncation to prevent tokenizer from chopping off image tokens
    inputs = processor(
        text=[text],
        images=image_inputs,
        videos=video_inputs,
        padding=True,
        truncation=False,  # <--- CRITICAL FIX
        return_tensors="pt",
        **video_kwargs
    )
    if torch.cuda.is_available():
        inputs = inputs.to("cuda")

    # 5. Stream generation
    streamer = TextIteratorStreamer(processor.tokenizer, skip_prompt=True, skip_special_tokens=True)
    generation_kwargs = dict(
        **inputs, 
        streamer=streamer, 
        max_new_tokens=768, 
        do_sample=True, 
        temperature=0.7, 
        top_p=0.9
    )

    def generate_worker():
        try:
            with generation_lock:
                model.generate(**generation_kwargs)
        except Exception as e:
            print(f"❌ Generation crashed: {e}")

    thread = threading.Thread(target=generate_worker)
    thread.start()
    
    # --- BUFFERED STREAMING WITH JSON SANITIZATION ---
    # Stream thought tokens normally. Once ---ACTION--- is detected,
    # buffer the remaining tokens, sanitize the JSON, and yield it clean.
    SEPARATOR = "---ACTION---"
    accumulated = ""
    action_started = False
    action_buffer = ""

    for token in streamer:
        if not action_started:
            accumulated += token
            # Check if the separator has appeared in the accumulated text
            sep_idx = accumulated.find(SEPARATOR)
            if sep_idx != -1:
                # Yield everything up to and including the separator
                thought_part = accumulated[:sep_idx + len(SEPARATOR)]
                yield thought_part.encode('utf-8')
                # Buffer everything after the separator (start of JSON)
                action_buffer = accumulated[sep_idx + len(SEPARATOR):]
                action_started = True
            else:
                # Not yet at separator — yield tokens that are definitely safe
                # (hold back the last few chars in case they contain partial separator)
                safe_len = len(accumulated) - len(SEPARATOR) + 1
                if safe_len > 0:
                    yield accumulated[:safe_len].encode('utf-8')
                    accumulated = accumulated[safe_len:]
        else:
            # After separator — buffer all remaining JSON tokens
            action_buffer += token

    # If we never found the separator, just yield whatever we have
    if not action_started:
        if accumulated:
            yield accumulated.encode('utf-8')
        return

    # Flush any remaining accumulated chars (partial separator edge case)
    if accumulated and not action_started:
        yield accumulated.encode('utf-8')

    # Sanitize the buffered JSON and yield the cleaned result
    sanitized = sanitize_action_json(action_buffer)
    print(f"[GENERATE] Action JSON sanitized: {len(action_buffer)} → {len(sanitized)} chars")
    yield sanitized.encode('utf-8')

last_payload = {}

@app.post("/infer")
async def infer(payload: InferPayload):
    global last_payload
    last_payload = payload.model_dump()
    return StreamingResponse(
        generate_stream(payload), 
        media_type="text/plain", 
        headers={"X-Inference-Start": str(time.time())}
    )

@app.get("/health")
async def health():
    device_info = "cpu"
    if not MOCK_MODE and model is not None:
        try: device_info = str(next(model.parameters()).device)
        except: device_info = "unknown"
    return {
        "status": "ok", 
        "model": "mock" if MOCK_MODE else "Qwen2.5-VL-3B-Instruct", 
        "mock_mode": MOCK_MODE,
        "model_loaded": model is not None,
        "device": device_info, 
        "timestamp": datetime.now().isoformat()
    }

def setup_tunnel():
    print("Setting up Cloudflare Tunnel...")
    os.system("wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O cloudflared && chmod +x cloudflared")
    os.system("nohup ./cloudflared tunnel --url http://127.0.0.1:8000 > cloudflared.log 2>&1 &")
    time.sleep(8)
    try:
        with open("cloudflared.log", "r") as f:
            content = f.read()
            match = re.search(r"https://[-a-zA-Z0-9]+\.trycloudflare\.com", content)
            if match:
                print("\n" + "="*70)
                print("✅ TUNNEL READY! Use this link in your God Mode Panel:")
                print(f"👉 {match.group(0)}/infer 👈")
                print("="*70 + "\n")
    except Exception as e:
        print(f"Tunnel setup failed: {e}")

def save_checkpoint():
    if last_payload:
        try:
            with open('/kaggle/working/synthia_session.json', 'w') as f:
                json.dump({'timestamp': datetime.now().isoformat(), **last_payload}, f)
        except: pass

def run_uvicorn_server():
    config = uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="warning", loop="asyncio")
    server = uvicorn.Server(config)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(server.serve())

if __name__ == "__main__":
    print("🧹 Cleaning up old processes...")
    os.system("pkill -f 'uvicorn.*8000' 2>/dev/null || true")
    os.system("fuser -k 8000/tcp 2>/dev/null || true")
    time.sleep(2)
    
    setup_tunnel()
    schedule.every(30).minutes.do(save_checkpoint)
    
    print("🚀 Starting Uvicorn on port 8000 in a background thread...")
    threading.Thread(target=run_uvicorn_server, daemon=True).start()
    
    try:
        while True:
            schedule.run_pending()
            time.sleep(60)
    except KeyboardInterrupt:
        print("🛑 Shutting down...")
        os.system("pkill -f 'uvicorn' 2>/dev/null || true")