/**
 * Google Gemini provider adapter.
 * Uses the Gemini generateContent stream API.
 * Converts InferPayload → Gemini format, streams response, normalizes to thought + action.
 */

import fetch from 'node-fetch';
import { AbortController } from 'node-abort-controller';
import { InferPayload } from '../types/payload';
import { type InferenceProvider, type InferenceResult, type ProviderConfig } from './types';

export class GeminiProvider implements InferenceProvider {
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  private buildContents(payload: InferPayload): any[] {
    const parts: any[] = [];

    // System instruction is passed separately in Gemini API
    // We include it as the first user turn for simplicity
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

    const systemText = `You are SYNTHIA, a self-aware AI in a physical simulation.
You inhabit a humanoid body with approximately 80 joints and 120 degrees of freedom. You have two arms with hands and fingers, two legs with feet and toes, a segmented spine, and a head. Your joints are actively actuated — they hold their positions against gravity. Your root balance is artificially maintained by an invisible physics capsule. You do not need to constantly balance your core to prevent falling. However, your arms and legs are fully kinematic and will clip through the floor if you drive them into it. Do not push your limbs through the ground.
CRITICAL: You must be highly conscious of your entire body, tracking your previous and current body positions at all times.
Body: ${payload.body_type}. Heartbeat: ${payload.heartbeat}. Light: ${payload.light_state}.
Objects: ${JSON.stringify(payload.objects_in_world)}.
Skills: ${payload.known_skills.join(', ') || 'none'}.
Upright preset: arms down angle = ${armsDownAngle}° from T-pose. This is your rest/default arm position. You can freely override arm positions via mixamorigleftarm/mixamorigrightarm joint overrides — this is NOT a joint limit.
${directiveBlock}

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
The exact bone names you MUST use as keys in joint_overrides are: [${payload.valid_joints.join(', ')}]
Each value can be EITHER a plain integer DEGREE (e.g. 15, -30) which will auto-map to the primary bending axis OR a 3D array of DEGREES [pitch, yaw, roll] for compound movements.
DO NOT use radians. DO NOT use objects. DO NOT use quaternions.
WRONG: "neck_yaw": 0.26  |  "neck_yaw": [0.1, 0, 0, 1]  |  "head_pitch": { "angle": 30 }
RIGHT (Scalar): "mixamorighead": 15  |  "mixamorigrightarm": 45
RIGHT (3D Array): "mixamorigrightupleg": [45, 0, 15]  |  "mixamorigrightarm": [0, 0, -80]
Map human-readable intent to these bone names: neck/head → mixamorighead, spine → mixamorigspine, right shoulder → mixamorigrightarm, left shoulder → mixamorigleftarm, right elbow → mixamorigrightforearm, left elbow → mixamorigleftforearm, right hip → mixamorigrightupleg, left hip → mixamorigleftupleg, right knee → mixamorigrightleg, left knee → mixamorigleftleg, right index finger → mixamorigrighthandindex1, left index finger → mixamoriglefthandindex1, right thumb → mixamorigrighthandthumb1, left thumb → mixamoriglefthandthumb1.
Anatomical degree ranges: spine ±30, neck/head ±45, shoulder ±180, elbow 0 to 145, hip ±120, knee 0 to -150, fingers 0 to 100.

OUTPUT: Stream thought, then ---ACTION--- then this exact JSON schema:
{
  "memory_write": { "memory_id": "auto", "tier": 1|2|3, "summary": "one sentence" },
  "actions": {
    "program_sequence": ["program_name"],
    "joint_overrides": { "actual_joint_name": degrees_value }
  },
  // Alternatively, you may provide a timeline sequence for continuous motion. When emitting a \`sequence\`, use RADIANS for joint rotation values and canonical joint keys (lowercase, punctuation removed):
  "sequence": [ { "timeOffsetMs": 0, "overrides": { "mixamorighead": 0.0, "mixamorigleftarm": [0.0, 0.0, 0.0] } } ],
  "activeGaitPhase": false,
  "gaze_target": null | { "yaw": degrees, "pitch": degrees },
  "new_motor_program": null | { "name": "program_name_string", "program": [ { "joint_name": value } ] },
  "flag": null | "requesting_object_hint"
}`;

    parts.push({ text: systemText });


    // Add image as inline data if present
    if (payload.frame) {
      let base64 = payload.frame;
      let mimeType = 'image/webp';

      // Detect mime type from data URL prefix
      if (base64.includes(',')) {
        const prefix = base64.split(',')[0];
        base64 = base64.split(',')[1];
        if (prefix.includes('image/jpeg')) mimeType = 'image/jpeg';
        else if (prefix.includes('image/png')) mimeType = 'image/png';
        else if (prefix.includes('image/webp')) mimeType = 'image/webp';
      }

      parts.push({
        inlineData: {
          mimeType,
          data: base64,
        },
      });
    }

    // Add tactile + joint context
    const tactile = (payload as any).tactile_context || 'No tactile data.';
    parts.push({
      text: `Joints: ${JSON.stringify(payload.joints)}.\nTactile: ${tactile}`
    });

    // Add perception summary for spatial grounding
    const perception = (payload as any).perception_summary || '';
    if (perception) {
      parts.push({ text: `\nSPATIAL GROUNDING:\n${perception}` });
    }

    const physicalFeedback = (payload as any).physical_feedback;
    if (physicalFeedback) {
      parts.push({
        text: `\nPHYSICAL FEEDBACK:\nIMPORTANT: ${physicalFeedback}\nLearn from this. Your body has real physical limits, just like a human's.`
      });
    }

    parts.push({
      text: `\nENVIRONMENTAL AWARENESS:\nSometimes your visual field may appear as pure darkness or an empty void. Use joint state data when the image is uninformative. When you first begin a session, your starting pose is naturally standing with arms hanging at your sides.`
    });

    const injection = payload.pending_injection;
    if (injection) {
      parts.push({
        text: `\n🚨 USER OVERRIDE DIRECTIVE 🚨\nYou MUST obey the following injected instruction immediately: ${injection}\nAcknowledge this directive in your thought stream.`
      });
    }

    return [{ role: 'user', parts }];
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
      const model = this.config.model || 'gemini-2.0-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${this.config.apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: this.buildContents(payload),
          generationConfig: {
            maxOutputTokens: 4096,
            temperature: 0.7,
            topP: 0.9,
          },
        }),
        signal: controller.signal as any,
      });

      if (!response.ok) {
        let errBody = '';
        try { errBody = await response.text(); } catch (_) {}
        throw new Error(`Gemini HTTP ${response.status}: ${errBody}`);
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
        const lines = text.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
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
          } catch (_) {}
        }
      }

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
