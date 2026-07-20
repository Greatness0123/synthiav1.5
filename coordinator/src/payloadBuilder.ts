/**
 * Assembles InferPayload from world state, memories, and settings.
 */

import { InferPayload } from './types/payload';
import { embeddingEngine } from './embeddingEngine';
import { MemoryManager } from './memoryManager';
import { injectionQueue } from './injectionQueue';

export class PayloadBuilder {
  private memoryManager: MemoryManager;

  constructor(memoryManager: MemoryManager) {
    this.memoryManager = memoryManager;
  }

  private heartbeatCounter: number = 0;

  /**
   * Build a natural-language description of active contact forces.
   * Converts raw impulse magnitudes to qualitative labels.
   */
  private buildTactileContext(contactForces: Record<string, any>): string {
    const entries = Object.entries(contactForces);
    if (entries.length === 0) return 'No active contact — you are not touching anything.';

    const lines: string[] = [];
    for (const [bodyPart, data] of entries) {
      if (!data.contact || !data.impulse_magnitude) continue;

      const mag = data.impulse_magnitude;
      let label: string;
      if (mag < 1) label = 'light touch';
      else if (mag < 5) label = 'moderate force';
      else if (mag < 20) label = 'firm contact';
      else label = 'strong ground support';

      const partName = bodyPart
        .replace('capsule_body', 'body')
        .replace(/_/g, ' ')
        .replace('mixamorig', '');

      lines.push(`Your ${partName} is pressing against ${data.touching || 'something'} with ${label} (${mag.toFixed(1)} N·s).`);
    }

    return lines.length > 0
      ? lines.join(' ')
      : 'No active contact — you are not touching anything.';
  }

  /**
   * Build a perception summary for spatial grounding when the visual field is uninformative.
   * Converts joint state + world state to human-readable text.
   */
  private buildPerceptionSummary(payload: InferPayload): string {
    const joints = payload.joints || {};

    // Head orientation → cardinal direction
    const head = joints['mixamorighead'] || {};
    const headRotation = head.rotation || [0, 0, 0, 1];
    const headY = typeof headRotation === 'object' && Array.isArray(headRotation)
      ? headRotation[1] : 0;
    // Quaternion Y component → approximate yaw in degrees
    const yawDeg = Math.round((2 * Math.asin(Math.max(-1, Math.min(1, headY || 0)))) * (180 / Math.PI));
    let facing = 'forward';
    if (yawDeg > 45) facing = 'right';
    else if (yawDeg < -45) facing = 'left';
    else if (Math.abs(yawDeg) <= 45) facing = 'forward';

    // Hip height → upright detection
    const hips = joints['mixamorighips'] || {};
    const hipPos = hips.position || [0, 1, 0];
    const bodyHeight = Array.isArray(hipPos) ? hipPos[1] : 1;
    const isFallen = bodyHeight < 0.5;
    // Determine posture from hip height and contact info
    const contactForces2 = payload.contact_forces || {};
    const contactCount = Object.values(contactForces2).filter((c: any) => c.contact).length;

    // isGrounded: authoritative value from HumanoidPhysicsBinder.getIsGrounded()
    // Falls back to contact-count heuristic if the frontend doesn't send it.
    const isGrounded: boolean = (payload as any).isGrounded !== undefined
      ? (payload as any).isGrounded
      : (contactCount > 0 && bodyHeight < 1.5);

    let postureLabel: string;
    let situationBlock: string;
    if (bodyHeight > 0.8) {
      postureLabel = 'STANDING UPRIGHT';
      situationBlock = `SITUATION: I am standing on the floor. My feet are on the ground. This is normal. Contact sensors indicate floor contact, NOT a ceiling. No emergency action needed.`;
    } else if (bodyHeight > 0.3) {
      postureLabel = 'FALLEN — HIP NEAR GROUND';
      situationBlock = `SITUATION: I have FALLEN. My body is on the FLOOR (hip height ${bodyHeight.toFixed(2)}m). I am NOT trapped against a ceiling. Contact sensors detect the FLOOR beneath me. PRIORITY ACTION: execute 'get_up_from_front' or 'get_up_from_back' motor program to return upright.`;
    } else {
      postureLabel = 'PRONE — LYING FLAT';
      situationBlock = `SITUATION: I am lying flat on the FLOOR (hip height ${bodyHeight.toFixed(2)}m). I am NOT inverted or pressed against a ceiling. This is ground contact. PRIORITY ACTION: execute 'get_up_from_front' or 'get_up_from_back' to stand up.`;
    }

    // Nearby objects (within 5m of head)
    const headPos = head.position || [0, 1.6, 0];
    const nearbyObjects = (payload.objects_in_world || [])
      .map((obj: any) => {
        const pos = obj.position || obj.mesh?.position || [0, 0, 0];
        const dx = (pos.x || pos[0] || 0) - (headPos[0] || 0);
        const dy = (pos.y || pos[1] || 0) - (headPos[1] || 0);
        const dz = (pos.z || pos[2] || 0) - (headPos[2] || 0);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        return { type: obj.type || obj.name || 'object', dist };
      })
      .filter((o: any) => o.dist < 5)
      .sort((a: any, b: any) => a.dist - b.dist)
      .slice(0, 5);

    const objectLines = nearbyObjects.length > 0
      ? nearbyObjects.map((o: any) => `${o.type} (${o.dist.toFixed(1)}m away)`).join('\n')
      : 'None detected nearby';

    // Contact forces
    const contactForces = payload.contact_forces || {};
    const contactEntries = Object.entries(contactForces);
    let contactText = 'No active contact';
    if (contactEntries.length > 0) {
      const parts = contactEntries.map(([part, data]: [string, any]) => {
        if (!data.contact) return null;
        const mag = data.impulse_magnitude || 0;
        let label = 'touching';
        if (mag > 20) label = 'strong ground support';
        else if (mag > 5) label = 'firm contact';
        else if (mag > 1) label = 'moderate force';
        else if (mag > 0.01) label = 'light touch';
        return `${part.replace('capsule_body', 'body')} ${label} ${data.touching || ''}`;
      }).filter(Boolean);
      contactText = parts.length > 0 ? parts.join('; ') : 'No active contact';
    }

    return `CURRENT BODY STATE:
Head facing: ${facing} (yaw: ${yawDeg}°)
Posture: ${postureLabel}
Hip height: ${bodyHeight.toFixed(2)}m above floor
Current heartbeat: ${payload.heartbeat}
Time of day: ${payload.light_state}

${situationBlock}

OBJECTS WITHIN 5 METRES:
${objectLines}

CONTACT FORCES (these are FLOOR contacts, not ceiling):
${contactText}

LOCOMOTION PHYSICS — HOW TO MOVE:
• Your body is a single capsule. It moves through Kinematic Ground Reaction Forces (K-GRF).
• When your foot/toe bones are touching the ground AND you move them (by setting joint rotations),
  the system detects foot movement against the ground and applies a proportional impulse to your capsule.
• To move FORWARD: place your toes/feet on the ground, then push them BACKWARD (by rotating
  your hips and knees to stroke backward). The K-GRF system will convert this into forward capsule movement.
• To TURN: push one foot backward more than the other (asymmetric foot stroke).
  The torque system converts this into rotation.
• To STOP: dig your toes in forward or keep your feet stationary on the ground.
• K-GRF ONLY works when your foot bones are in contact with the ground surface.
• Jumping: set both legs to push downward (extend knees) while airborne timer is zero.
  The system applies a jump impulse. You must be grounded for executeJump() to fire.

CONCRETE LOCOMOTION EXAMPLE (degrees; the system converts to radians automatically):
  FORWARD STEP (right foot):
    { mixamorigrightupleg: [-10, 0, 0], mixamorigrightleg: -30 }   → lift right foot, knee bends
    then stroke backward:
    { mixamorigrightupleg: [20, 0, 0], mixamorigrightleg: -10 }   → foot pushes against ground, capsule moves forward
    At the same time, the left arm swings forward naturally:
    { mixamorigleftarm: [0, 0, 30] }
  FORWARD STEP (left foot):
    { mixamorigleftupleg: [-10, 0, 0], mixamorigleftleg: -30 }    → lift left foot
    then stroke backward:
    { mixamorigleftupleg: [20, 0, 0], mixamorigleftleg: -10 }
    Right arm swings forward:
    { mixamorigrightarm: [0, 0, -30] }
  TURN LEFT:
    Stroke right foot backward harder than left: { mixamorigrightupleg: [25, 0, 0] }
    while left foot stays: { mixamorigleftupleg: [0, 0, 0] }
    The torque from asymmetric foot stroke rotates the capsule.
  JUMP:
    { mixamorigrightleg: 0, mixamorigleftleg: 0 }  → Extend knees suddenly while grounded.
    Must set programSequence: ["jump"] AND be grounded.

IMPORTANT: Use program_sequence: ["upright_preset"] or ["stand"] to return to standing.
Use program_sequence: ["jump"] to trigger a jump (must be grounded).
All other program_sequence values are ignored — you must use joint_overrides to move.

NOTE: The image above shows my current first-person view.
If the view appears blank or shows only one surface, I am likely facing a wall or the floor. My joint rotation data above tells me where I am even when my visual field is empty.
IMPORTANT: contacts=1 means ONE surface (the floor) is touching me. This is NORMAL for standing or lying down. It does NOT mean I am trapped against a ceiling.`;
  }

  public getHeartbeat(): number {
    return this.heartbeatCounter;
  }

  async build(worldState: any, agentId: string, options: any): Promise<InferPayload> {
    const contextString = `${worldState.currentGoal || ''} ${(worldState.objects || []).map((o: any) => o.name).join(', ')}`;
    const embedding = await embeddingEngine.embed(contextString);

    const relevantMemories = await this.memoryManager.retrieveRelevant(embedding, agentId, 5);
    const recentWorkingMemories = await this.memoryManager.retrieveRecent(agentId, 3);

    // Injection is dequeued in agentLoop before build() is called, and passed via worldState.injected_thought
    const pendingInjection: string | null = worldState.injected_thought || null;

    // --- FIX 1: Strip data URL prefix from frame ---
    // Frontend sends raw WebP base64 (from 448×448 offscreen capture) — providers expect raw base64 only
    // If a data URL prefix is present (legacy format), strip it
    let rawFrame: string = worldState.frame || '';
    if (rawFrame.includes(',')) {
      rawFrame = rawFrame.split(',')[1];
    }

    // --- FIX 2: Correct audio_pcm field name ---
    // captureWorldState() returns { audio_pcm: '...' }, NOT { audio: { pcm: '...' } }
    const audioPcm: string = worldState.audio_pcm || worldState.audio?.pcm || '';

    // --- FIX 3: heartbeat — worldState has no heartbeat, use internal counter ---
    this.heartbeatCounter += 1;
    const heartbeat: number = typeof worldState.heartbeat === 'number'
      ? worldState.heartbeat
      : this.heartbeatCounter;

    // Contact forces — passed through from the frontend
    const contactForces: Record<string, any> = worldState.contact_forces || {};

    console.log(`[PayloadBuilder] heartbeat=${heartbeat}, frame_raw_len=${rawFrame.length}, audio_len=${audioPcm.length}, joints=${Object.keys(worldState.joints || {}).length}, contacts=${Object.keys(contactForces).length}`);

    const payload: InferPayload = {
      frame: rawFrame,
      audio_pcm: audioPcm,
      joints: worldState.joints || {},
      valid_joints: Object.keys(worldState.joints || {}),
      upright_preset: worldState.uprightPreset || {},
      heartbeat,
      light_state: worldState.lightState || 'day',
      session_id: worldState.sessionId || `session_${agentId}`,
      body_type: worldState.bodyType || 'humanoid',
      current_goal: worldState.currentGoal ?? options.goal ?? null,
      current_rung: worldState.currentRung ?? 0,
      objects_in_world: worldState.objects || [],
      relevant_memories: relevantMemories.map(m => ({ ...m, summary: m.visual_description || 'No summary' })),
      recent_working_memories: recentWorkingMemories.map(m => ({ ...m, summary: m.visual_description || 'No summary' })),
      known_skills: options.masteredSkills || [],
      pending_injection: pendingInjection || worldState.injected_thought || null,
      motor_program_library: options.motorPrograms || [],
      directive_mode: options.mode || 'free_will',
      agent_id: agentId,
      contact_forces: contactForces,
    };

    // Attach the formatted tactile context string for the prompt builder
    (payload as any).tactile_context = this.buildTactileContext(contactForces);

    // Gaze context — tell the AI how its vision works
    (payload as any).gaze_context = `You control your view by rotating your head (set mixamorighead joint overrides).
The first-person camera is attached to your head bone. It does NOT move independently.
The chase/second-person camera is a fixed spectator camera — it never follows your movement.

Your eyes can make small shifts (gaze_target yaw/pitch in radians, range -0.15 to 0.15)
but this is a subtle eye movement within the head, not turning your head.`;

    // Perception summary — spatial grounding for when visual field is uninformative
    (payload as any).perception_summary = this.buildPerceptionSummary(payload);

    const feedback = options.physicalFeedback as any[] | undefined;
    if (feedback && feedback.length > 0) {
      (payload as any).physical_feedback = feedback.map(r =>
        `Your attempt to move ${r.joint} to ${Number(r.requested).toFixed(2)} ` +
        `radians was physically impossible — your body's limit for ` +
        `this joint is ${Number(r.limit_min).toFixed(2)} to ${Number(r.limit_max).toFixed(2)} ` +
        `radians. The joint did not move. Try a smaller adjustment.`
      ).join(' ');
    } else {
      (payload as any).physical_feedback = null;
    }

    return payload;
  }
}
