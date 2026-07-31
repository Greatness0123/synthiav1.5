/**
 * Assembles InferPayload from world state, memories, and settings client-side.
 */

import { InferPayload } from '../../types/payload';
import { MemoryManager } from './MemoryManager';

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

    const head = joints['mixamorighead'] || {};
    const headRotation = head.rotation || [0, 0, 0, 1];
    const headY = typeof headRotation === 'object' && Array.isArray(headRotation)
      ? headRotation[1] : 0;

    const yawDeg = Math.round((2 * Math.asin(Math.max(-1, Math.min(1, headY || 0)))) * (180 / Math.PI));
    let facing = 'forward';
    if (yawDeg > 45) facing = 'right';
    else if (yawDeg < -45) facing = 'left';

    const hips = joints['mixamorighips'] || {};
    const hipPos = hips.position || [0, 1, 0];
    const bodyHeight = Array.isArray(hipPos) ? hipPos[1] : 1;

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
• YOU control every joint directly through joint_overrides or sequence timeline frames.
• All joint angle values are IN DEGREES. The system converts to radians automatically.
• Your capsule body moves through the world when foot-to-ground contact produces forces.
  The more contact your feet/toes have with the ground while moving, the more your capsule will translate.

MOVEMENT IS ACHIEVED ENTIRELY THROUGH JOINT ANGLES:
  To walk forward: alternate lifting each leg (negative hip X = foot lifts forward, knee bends negative)
  then pushing backward (positive hip X = leg extends back, knee straightens). Swing arms for balance.
  To turn: use asymmetric leg strokes — push one leg harder than the other, creating capsule rotation.
  To look around: rotate your head (mixamorighead) using [pitch, yaw, roll] in degrees.
  To reach for an object: move your arm with mixamorigrightarm or mixamorigleftarm.

PROGRAM SEQUENCE COMMANDS (use sparingly):
  program_sequence: ["stand"] → resets body to upright standing pose at origin
  program_sequence: ["jump"] → applies upward impulse (must be grounded)
  For ALL other movement, use joint_overrides or sequence timeline — NOT program_sequence.

TIMELINE SEQUENCE (for smooth continuous motion):
  Output a "sequence" array of timed frames. Each frame has a timeOffsetMs and overrides map.
  Frame times are relative to sequence start. Use small timesteps (30–100ms) for fluid motion.
  Always end sequences by returning to a neutral pose.
  Both joint_overrides and sequence overrides use IDENTICAL format — degrees, canonical joint keys.

NOTE: The image above shows my current first-person view.
If the view appears blank or shows only one surface, I am likely facing a wall or the floor. My joint rotation data above tells me where I am even when my visual field is empty.
IMPORTANT: contacts=1 means ONE surface (the floor) is touching me. This is NORMAL for standing or lying down. It does NOT mean I am trapped against a ceiling.`;
  }

  public getHeartbeat(): number {
    return this.heartbeatCounter;
  }

  async build(worldState: any, agentId: string, options: any): Promise<InferPayload> {
    const contextString = `${worldState.currentGoal || ''} ${(worldState.objects || []).map((o: any) => o.name).join(', ')}`;
    const embedding = this.memoryManager.getDeterministicEmbedding(contextString);

    const relevantMemories = await this.memoryManager.retrieveRelevant(embedding, agentId, 5);
    const recentWorkingMemories = await this.memoryManager.retrieveRecent(agentId, 3);

    const pendingInjection: string | null = worldState.injected_thought || null;

    let rawFrame: string = worldState.frame || '';
    if (rawFrame.includes(',')) {
      rawFrame = rawFrame.split(',')[1];
    }

    const audioPcm: string = worldState.audio_pcm || worldState.audio?.pcm || '';

    this.heartbeatCounter += 1;
    const heartbeat: number = typeof worldState.heartbeat === 'number'
      ? worldState.heartbeat
      : this.heartbeatCounter;

    const contactForces: Record<string, any> = worldState.contact_forces || {};

    console.log(`[PayloadBuilder] agent=${agentId}, heartbeat=${heartbeat}, frame_raw_len=${rawFrame.length}, audio_len=${audioPcm.length}, joints=${Object.keys(worldState.joints || {}).length}, contacts=${Object.keys(contactForces).length}`);

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

    payload.tactile_context = this.buildTactileContext(contactForces);

    payload.gaze_context = `You control your view by rotating your head (set mixamorighead joint overrides).
The first-person camera is attached to your head bone. It does NOT move independently.
The chase/second-person camera is a fixed spectator camera — it never follows your movement.

Your eyes can make small shifts (gaze_target yaw/pitch in radians, range -0.15 to 0.15)
but this is a subtle eye movement within the head, not turning your head.`;

    payload.perception_summary = this.buildPerceptionSummary(payload);

    const feedback = options.physicalFeedback as any[] | undefined;
    if (feedback && feedback.length > 0) {
      payload.physical_feedback = feedback.map(r =>
        `Your attempt to move ${r.joint} to ${Number(r.requested).toFixed(2)} ` +
        `radians was physically impossible — your body's limit for ` +
        `this joint is ${Number(r.limit_min).toFixed(2)} to ${Number(r.limit_max).toFixed(2)} ` +
        `radians. The joint did not move. Try a smaller adjustment.`
      ).join(' ');
    } else {
      payload.physical_feedback = null;
    }

    return payload;
  }
}
