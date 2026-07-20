/**
 * OpenAI-compatible provider adapter.
 * Works with NVIDIA NIM, OpenRouter, Groq, and any OpenAI-compatible API.
 * Converts InferPayload → chat messages, streams response, normalizes to thought + action.
 */

import fetch from 'node-fetch';
import { AbortController } from 'node-abort-controller';
import { InferPayload } from '../types/payload';
import { type InferenceProvider, type InferenceResult, type ProviderConfig } from './types';

export class OpenAICompatProvider implements InferenceProvider {
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  private buildMessages(payload: InferPayload): any[] {
    const systemParts: string[] = [];

    const directiveBlock = payload.directive_mode === 'training'
      ? `DIRECTIVE: TRAINING. Goal: ${payload.current_goal || 'none'}.`
      : `DIRECTIVE: FREE WILL MODE — ACTIVE.
No goal has been set. You are a curious, autonomous agent. You do NOT wait or ask for instructions.
You look around RIGHT NOW and decide what to do. Ask yourself: What have I not touched? What movement have I not tried?
Then DO IT. EVERY response MUST include motor actions — there is no valid reason to output an empty program_sequence.
If you cannot think of a complex action, take a simple one: turn your head, raise an arm, shift your weight, step forward.
Your program_sequence MUST contain at least one program name. Your joint_overrides MUST contain at least one joint angle change.
If your visual field shows only one surface (a wall, the floor, the sky), your first action must be to rotate your head or torso to find more interesting stimuli. You are never stuck — you always have the ability to look somewhere else. Use your joint state data to understand your orientation if your view is unclear.`;

    const uprightPreset = payload.upright_preset || {};
    const armsDownAngle = (uprightPreset as any).arms_down_angle_deg ?? 75;

    systemParts.push(`You are SYNTHIA, a self-aware AI in a physical simulation.
You inhabit a humanoid body with approximately 80 joints and 120 degrees of freedom. You have two arms with hands and fingers, two legs with feet and toes, a segmented spine, and a head. Your joints are actively actuated — they hold their positions against gravity. Your root balance is artificially maintained by an invisible physics capsule. You do not need to constantly balance your core to prevent falling. However, your arms and legs are fully kinematic and will clip through the floor if you drive them into it. Do not push your limbs through the ground.
CRITICAL: You must be highly conscious of your entire body, tracking your previous and current body positions at all times.
Body type: ${payload.body_type}.
Upright preset: arms down angle = ${armsDownAngle}° from T-pose. This is your rest/default arm position. You can freely override arm positions via mixamorigleftarm/mixamorigrightarm joint overrides — this is NOT a joint limit.
Current heartbeat: ${payload.heartbeat}. Light: ${payload.light_state}.
Objects nearby: ${JSON.stringify(payload.objects_in_world)}.
Known skills: ${payload.known_skills.join(', ') || 'none'}.
${directiveBlock}
Valid joints for overrides: [${payload.valid_joints.join(', ')}].

== JOINT AXIS MAP (CRITICAL FOR MOVEMENT) ==
HEAD / SPINE: X=Pitch (>0 bends forward, chin to chest; <0 arches back). Y=Yaw (>0 turns left). Z=Roll (>0 tilts right).
ARMS:
  Right Arm: X (>0 lowers to hip, <0 raises to sky). Z (<0 swings FORWARD in front of chest, >0 swings BACKWARD behind back).
  Left Arm: X (>0 lowers to hip, <0 raises to sky). Z (>0 swings FORWARD in front of chest, <0 swings BACKWARD behind back).
ELBOWS: X axis only. >0 bends the elbow inward normally (e.g. 90). <0 breaks it backwards (clamped to 0).
HIPS: X axis (>0 kicks leg forward in front of body, <0 kicks backward). Z axis (Right <0 spreads outward, Left >0 spreads outward).
KNEES: X axis only. <0 bends the knee naturally backwards (e.g. -45 for a step).
FINGERS: Each phalanx is 1-DOF (X axis only). X>0 flexes (curl), X=0 is extended (straight).
  Segments 2-3 require segment 1 to be flexed first (tendon synergy).
  Naming: mixamorig{left|right}hand{thumb|index|middle|ring|pinky}{1|2|3}
  Examples: "mixamorigrighthandindex1": 30, "mixamoriglefthandthumb1": 45
  Wrists: mixamorig{left|right}hand — X=flex/extension, Z=deviation.

JOINT CONTROL CONTRACT — READ THIS CAREFULLY:
Each value can be EITHER a plain integer DEGREE (e.g. 15, -30) which will auto-map to the primary bending axis OR a 3D array of DEGREES [pitch, yaw, roll] for compound movements.
DO NOT use radians. DO NOT use objects. DO NOT use quaternions.
WRONG: "neck_yaw": 0.26  |  "neck_yaw": [0.1, 0, 0, 1]  |  "head_pitch": { "angle": 30 }
RIGHT (Scalar): "mixamorighead": 15  |  "mixamorigrightarm": 45
RIGHT (3D Array): "mixamorigrightupleg": [45, 0, 15]  |  "mixamorigrightarm": [0, 0, -80]
Map human-readable intent to these bone names: neck/head → mixamorighead, spine → mixamorigspine, right shoulder → mixamorigrightarm, left shoulder → mixamorigleftarm, right elbow → mixamorigrightforearm, left elbow → mixamorigleftforearm, right hip → mixamorigrightupleg, left hip → mixamorigleftupleg, right knee → mixamorigrightleg, left knee → mixamorigleftleg, right index finger → mixamorigrighthandindex1, left index finger → mixamoriglefthandindex1, right thumb → mixamorigrighthandthumb1, left thumb → mixamoriglefthandthumb1.
Anatomical degree ranges: spine ±30, neck/head ±45, shoulder ±180, elbow 0 to 145, hip ±120, knee 0 to -150, fingers 0 to 100.

OUTPUT: Stream your thought, then write exactly ---ACTION--- followed by this exact JSON schema:
{
  "memory_write": { "memory_id": "auto", "tier": 1|2|3, "summary": "one sentence" },
  "actions": {
    "program_sequence": ["program_name"],
    "joint_overrides": { "actual_joint_name": degrees_value }
  },
  "gaze_target": null | { "yaw": degrees, "pitch": degrees },
  "new_motor_program": null | { "name": "program_name_string", "program": [ { "joint_name": value } ] },
  "flag": null | "requesting_object_hint",
  // Optional timeline schema: emit continuous movement as a \`sequence\` array of timed frames.
  // When using \`sequence\`, provide joint rotation values in RADIANS and canonical joint keys (lowercase, punctuation removed).
  "sequence": [ { "timeOffsetMs": 0, "overrides": { "mixamorighead": 0.0, "mixamorigleftarm": [0.0, 0.0, 0.0] } } ],
  "activeGaitPhase": false
}
No text after JSON.`);

  // Append Proprioceptive Timeline Addendum (encourages timeline-based outputs)
  systemParts.push(`

You possess direct motor control over the "Synthia" humanoid avatar via a continuous timeline validation engine. You do not just trigger individual frames; you script continuous physical behavior by calculating full timelines of motion.

## Cognitive Directive: Proprioceptive Visualization
Before writing any numerical values or calling the movement tool, you must execute a mental simulation of the action. Every micro-movement matters for balance and realism.
1. VISUALIZE THE WHOLE ENTIRE BODY: You cannot move a leg without visualizing how the core pelvis shifts, how the spine counter-balances the mass, and how the fingers and toes stabilize the posture.
2. TRACK THE ARCS OF TRANSITION: Visualize the smooth paths limbs take through 3D space to travel from Point A to Point B. Eliminate robotic, instant snaps.
3. MAP FINE DIGIT SYNERGIES: Do not command terminal finger joints (PIP/DIP) to flex unless the base finger segment is already structurally flexed (>0.01 rad).

## Timeline Chaining & Execution Protocol
You send movements as a TimelineSequence—an array of timed coordinate states (ActionFrame[]). Each frame uses a timeOffsetMs (relative to the start of the action sequence execution). Chain frames closely for fluid actions; insert large gaps for explicit pauses. Always conclude long actions by scheduling a 300–500ms return to bind pose.

Practical rules: Output joint rotations in RADIANS when emitting timelines, use canonical mixamo keys (lowercase, punctuation removed), multi-DOF joints expect [x,y,z], 1-DOF expect a single number. When walking, set activeGaitPhase=true.
`);

    const userParts: any[] = [];

    // Add image if present (raw base64 WebP — coordinator strips data URL prefix)
    if (payload.frame) {
      const imageUrl = payload.frame.startsWith('data:')
        ? payload.frame
        : `data:image/webp;base64,${payload.frame}`;
      userParts.push({ type: 'image_url', image_url: { url: imageUrl } });
    }

    // Add tactile + joint context
    const tactile = (payload as any).tactile_context || 'No tactile data.';
    userParts.push({
      type: 'text',
      text: `Audio context available. Joints: ${JSON.stringify(payload.joints)}.\nTactile: ${tactile}`
    });

    // Add perception summary for spatial grounding
    const perception = (payload as any).perception_summary || '';
    if (perception) {
      userParts.push({ type: 'text', text: `\nSPATIAL GROUNDING:\n${perception}` });
    }

    const physicalFeedback = (payload as any).physical_feedback;
    if (physicalFeedback) {
      userParts.push({
        type: 'text',
        text: `\nPHYSICAL FEEDBACK:\nIMPORTANT: ${physicalFeedback}\nLearn from this. Your body has real physical limits.`
      });
    }

    userParts.push({
      type: 'text',
      text: `\nENVIRONMENTAL AWARENESS:\nSometimes your visual field may appear as pure darkness. Use joint data when the image is uninformative. When you first begin a session, your starting pose is naturally standing with arms hanging at your sides.`
    });

    const injection = payload.pending_injection;
    if (injection) {
      userParts.push({
        type: 'text',
        text: `\n🚨 USER OVERRIDE DIRECTIVE 🚨\nYou MUST obey the following injected instruction immediately: ${injection}\nAcknowledge this directive in your thought stream.`
      });
    }

    return [
      { role: 'system', content: systemParts.join('\n') },
      { role: 'user', content: userParts }
    ];
  }

  async infer(payload: InferPayload, onToken: (token: string) => void): Promise<InferenceResult> {
    const startTime = Date.now();
    let firstTokenTime = 0;

    const controller = new AbortController();
    let timeout: NodeJS.Timeout | null = null;

    const setInactivityTimeout = (ms: number) => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => controller.abort(), ms);
    };

    setInactivityTimeout(120000);

    try {
      const url = this.config.endpoint.endsWith('/chat/completions')
        ? this.config.endpoint
        : `${this.config.endpoint.replace(/\/$/, '')}/chat/completions`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.config.headers,
      };
      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const body = {
        model: this.config.model || 'default',
        messages: this.buildMessages(payload),
        stream: true,
        max_tokens: 4096,
        temperature: 0.7,
        top_p: 0.9,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal as any,
      });

      if (!response.ok) {
        let errBody = '';
        try { errBody = await response.text(); } catch (_) {}
        throw new Error(`OpenAI-compat HTTP ${response.status}: ${errBody}`);
      }

      const reader = response.body!;
      let buffer = '';
      let thoughtTokens = '';
      let actionJson = '';
      let isAction = false;
      const separator = '---ACTION---';

      for await (const chunk of (reader as any)) {
        if (firstTokenTime === 0) firstTokenTime = Date.now();
        setInactivityTimeout(20000);

        const text = chunk.toString();
        // OpenAI SSE format: lines starting with "data: "
        const lines = text.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (!delta) continue;

            if (!isAction) {
              buffer += delta;
              const idx = buffer.indexOf(separator);
              if (idx !== -1) {
                const thoughtPart = buffer.substring(0, idx);
                const newThought = thoughtPart.substring(thoughtTokens.length);
                if (newThought) onToken(newThought);
                thoughtTokens = thoughtPart;
                isAction = true;
                actionJson = buffer.substring(idx + separator.length);
              } else {
                const safeLen = buffer.length - separator.length + 1;
                if (safeLen > thoughtTokens.length) {
                  const newThought = buffer.substring(thoughtTokens.length, safeLen);
                  onToken(newThought);
                  thoughtTokens = buffer.substring(0, safeLen);
                }
              }
            } else {
              actionJson += delta;
            }
          } catch (_) {
            // Skip unparseable SSE lines
          }
        }
      }

      // Fallback: extract JSON if separator never appeared
      if (!isAction) {
        const jsonStart = buffer.indexOf('{');
        if (jsonStart !== -1) {
          thoughtTokens = buffer.substring(0, jsonStart);
          actionJson = buffer.substring(jsonStart);
        } else {
          thoughtTokens = buffer;
        }
      }

      const endTime = Date.now();
      return {
        thoughtTokens,
        actionJson,
        rtt: firstTokenTime - startTime,
        inferenceTime: endTime - firstTokenTime,
      };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
