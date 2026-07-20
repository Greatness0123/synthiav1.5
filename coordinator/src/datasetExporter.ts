/**
 * Dataset export logic (LeRobot, JSONL, CSV, Frames ZIP, Thoughts Report, Session Full).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import { ExportConfig } from './types/export';
import * as fs from 'fs';
import * as path from 'path';
import { tableFromArrays, tableToIPC } from 'apache-arrow';
import ffmpegStatic from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import JSZip from 'jszip';

ffmpeg.setFfmpegPath(ffmpegStatic!);

export class DatasetExporter {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async export(config: ExportConfig, onProgress: (percent: number, rows: number) => void): Promise<{ filename: string, rows: number, sizeBytes: number }> {
    const timestamp = Date.now();
    const exportDir = `./exports/synthia_export_${timestamp}`;
    fs.mkdirSync(exportDir, { recursive: true });

    // Route to the correct export method based on exportType
    switch (config.exportType) {
      case 'frames_zip':
        return this.exportFramesZip(config, exportDir, onProgress);
      case 'thoughts_report':
        return this.exportThoughtsReport(config, exportDir, onProgress);
      case 'session_full':
        return this.exportSessionFull(config, exportDir, onProgress);
      case 'dataset':
      default:
        return this.exportDataset(config, exportDir, onProgress);
    }
  }

  // ─── Dataset export (existing LeRobot/JSONL/CSV) ───────────────────────────

  private async exportDataset(config: ExportConfig, exportDir: string, onProgress: (percent: number, rows: number) => void): Promise<{ filename: string, rows: number, sizeBytes: number }> {
    const timestamp = Date.now();

    // 1. Query memories
    let query = this.supabase.from('memories').select('*').in('agent_id', config.agentIds);

    if (config.scope === 'date_range') {
      if (config.dateFrom) query = query.gte('created_at', config.dateFrom);
      if (config.dateTo) query = query.lte('created_at', config.dateTo);
    } else if (config.scope === 'session') {
      if (config.sessionIds) query = query.in('session_id', config.sessionIds);
    } else if (config.scope === 'heartbeat_range') {
      if (config.heartbeatFrom) query = query.gte('heartbeat', config.heartbeatFrom);
      if (config.heartbeatTo) query = query.lte('heartbeat', config.heartbeatTo);
    }

    if (config.includeTiers) query = query.in('tier', config.includeTiers);
    if (config.excludeInjected) query = query.not('injected', 'eq', true);
    if (config.successfulOnly) query = query.neq('outcome', 'failure');
    if (config.minReward !== undefined) query = query.gte('reward_signal', config.minReward);

    const { data: memories, error } = await query.order('created_at', { ascending: true });
    if (error) throw error;
    if (!memories || memories.length === 0) throw new Error('No memories found matching criteria');

    onProgress(10, memories.length);

    const format = config.format || 'LeRobot';
    if (format === 'LeRobot') {
      await this.exportLeRobot(memories, exportDir, onProgress);
    } else if (format === 'JSONL') {
      await this.exportJSONL(memories, exportDir);
    } else if (format === 'CSV') {
      await this.exportCSV(memories, exportDir);
    }

    // Zip
    const zip = new JSZip();
    this.addDirectoryToZip(zip, exportDir, exportDir);
    const content = await zip.generateAsync({ type: 'nodebuffer' });
    const zipFilename = `synthia_export_${timestamp}.zip`;
    const zipPath = `./exports/${zipFilename}`;
    fs.writeFileSync(zipPath, content);

    // Cleanup exportDir
    fs.rmSync(exportDir, { recursive: true, force: true });

    const stats = fs.statSync(zipPath);

    return {
      filename: zipFilename,
      rows: memories.length,
      sizeBytes: stats.size
    };
  }

  // ─── Frames ZIP export ─────────────────────────────────────────────────────

  private async exportFramesZip(config: ExportConfig, exportDir: string, onProgress: (percent: number, rows: number) => void): Promise<{ filename: string, rows: number, sizeBytes: number }> {
    const timestamp = Date.now();
    const framesDir = path.join(exportDir, 'frames');
    fs.mkdirSync(framesDir, { recursive: true });

    // Query memories with frame_url
    let query = this.supabase
      .from('memories')
      .select('id, memory_id, heartbeat, session_id, frame_url, tier')
      .in('agent_id', config.agentIds)
      .not('frame_url', 'is', null);

    if (config.scope === 'session' && config.sessionIds) {
      query = query.in('session_id', config.sessionIds);
    } else if (config.scope === 'date_range') {
      if (config.dateFrom) query = query.gte('created_at', config.dateFrom);
      if (config.dateTo) query = query.lte('created_at', config.dateTo);
    } else if (config.scope === 'heartbeat_range') {
      if (config.heartbeatFrom) query = query.gte('heartbeat', config.heartbeatFrom);
      if (config.heartbeatTo) query = query.lte('heartbeat', config.heartbeatTo);
    }

    if (config.includeTiers) query = query.in('tier', config.includeTiers);

    const { data: memories, error } = await query.order('heartbeat', { ascending: true });
    if (error) throw error;
    if (!memories || memories.length === 0) throw new Error('No frames found matching criteria');

    onProgress(5, memories.length);

    // Download each frame
    let downloaded = 0;
    for (const m of memories) {
      if (!m.frame_url) continue;

      // Organize by session
      const sessionDir = path.join(framesDir, m.session_id || 'unknown');
      fs.mkdirSync(sessionDir, { recursive: true });

      const framePath = path.join(sessionDir, `hb_${String(m.heartbeat).padStart(4, '0')}.webp`);
      try {
        const res = await fetch(m.frame_url);
        if (res.ok) {
          const buffer = await res.arrayBuffer();
          fs.writeFileSync(framePath, Buffer.from(buffer));
        }
      } catch (e) {
        console.warn(`[DatasetExporter] Failed to download frame for heartbeat ${m.heartbeat}:`, e);
      }

      downloaded++;
      if (downloaded % 10 === 0) {
        onProgress(5 + Math.floor((downloaded / memories.length) * 90), memories.length);
      }
    }

    onProgress(95, memories.length);

    // Create a manifest
    const manifest = {
      exported_at: new Date().toISOString(),
      total_frames: memories.length,
      sessions: [...new Set(memories.map(m => m.session_id))],
      format: 'webp',
    };
    fs.writeFileSync(path.join(framesDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // Zip
    const zip = new JSZip();
    this.addDirectoryToZip(zip, exportDir, exportDir);
    const content = await zip.generateAsync({ type: 'nodebuffer' });
    const zipFilename = `synthia_frames_${timestamp}.zip`;
    const zipPath = `./exports/${zipFilename}`;
    fs.writeFileSync(zipPath, content);

    fs.rmSync(exportDir, { recursive: true, force: true });

    const stats = fs.statSync(zipPath);
    return {
      filename: zipFilename,
      rows: memories.length,
      sizeBytes: stats.size
    };
  }

  // ─── Thoughts Report export ────────────────────────────────────────────────

  private async exportThoughtsReport(config: ExportConfig, exportDir: string, onProgress: (percent: number, rows: number) => void): Promise<{ filename: string, rows: number, sizeBytes: number }> {
    const timestamp = Date.now();

    // Query memories
    let query = this.supabase.from('memories').select('*').in('agent_id', config.agentIds);

    if (config.scope === 'session' && config.sessionIds) {
      query = query.in('session_id', config.sessionIds);
    } else if (config.scope === 'date_range') {
      if (config.dateFrom) query = query.gte('created_at', config.dateFrom);
      if (config.dateTo) query = query.lte('created_at', config.dateTo);
    } else if (config.scope === 'heartbeat_range') {
      if (config.heartbeatFrom) query = query.gte('heartbeat', config.heartbeatFrom);
      if (config.heartbeatTo) query = query.lte('heartbeat', config.heartbeatTo);
    }

    if (config.includeTiers) query = query.in('tier', config.includeTiers);
    if (config.excludeInjected) query = query.not('injected', 'eq', true);
    if (config.successfulOnly) query = query.neq('outcome', 'failure');
    if (config.minReward !== undefined) query = query.gte('reward_signal', config.minReward);

    const { data: memories, error } = await query.order('created_at', { ascending: true });
    if (error) throw error;
    if (!memories || memories.length === 0) throw new Error('No memories found matching criteria');

    onProgress(10, memories.length);

    // Group by session
    const sessionGroups = new Map<string, any[]>();
    for (const m of memories) {
      const sid = m.session_id || 'unknown';
      if (!sessionGroups.has(sid)) sessionGroups.set(sid, []);
      sessionGroups.get(sid)!.push(m);
    }

    // Build Markdown report
    const lines: string[] = [];
    lines.push('# SYNTHIA — AI Thoughts Report');
    lines.push('');
    lines.push(`**Generated:** ${new Date().toISOString()}`);
    lines.push(`**Total Memories:** ${memories.length}`);
    lines.push(`**Sessions:** ${sessionGroups.size}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Table of contents
    lines.push('## Table of Contents');
    lines.push('');
    let sessionIndex = 0;
    for (const [sessionId, sessionMemories] of sessionGroups) {
      sessionIndex++;
      lines.push(`${sessionIndex}. [Session ${sessionId}](#session-${sessionIndex}) — ${sessionMemories.length} memories`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');

    // Each session
    sessionIndex = 0;
    for (const [sessionId, sessionMemories] of sessionGroups) {
      sessionIndex++;
      const firstMemory = sessionMemories[0];
      const lastMemory = sessionMemories[sessionMemories.length - 1];

      lines.push(`## Session ${sessionIndex} — ${sessionId}`);
      lines.push('');
      lines.push(`- **Heartbeats:** ${firstMemory.heartbeat} → ${lastMemory.heartbeat}`);
      lines.push(`- **Memories:** ${sessionMemories.length}`);
      lines.push(`- **Started:** ${firstMemory.created_at || 'N/A'}`);
      lines.push('');

      // Tier breakdown
      const tier1 = sessionMemories.filter(m => m.tier === 1);
      const tier2 = sessionMemories.filter(m => m.tier === 2);
      const tier3 = sessionMemories.filter(m => m.tier === 3);
      lines.push('**Tier Breakdown:**');
      lines.push(`- Tier 1 (Working): ${tier1.length}`);
      lines.push(`- Tier 2 (Episodic): ${tier2.length}`);
      lines.push(`- Tier 3 (Long-term): ${tier3.length}`);
      lines.push('');

      // Memories
      for (const m of sessionMemories) {
        lines.push(`### Heartbeat ${m.heartbeat} — Tier ${m.tier}`);
        lines.push('');
        lines.push(`**Thought:**`);
        lines.push('');
        lines.push(`> ${m.thought || '(no thought)'}`);
        lines.push('');
        if (m.visual_description) {
          lines.push(`**Visual:** ${m.visual_description}`);
        }
        if (m.outcome) {
          lines.push(`**Outcome:** ${m.outcome}`);
        }
        if (m.reward_signal !== undefined && m.reward_signal !== null) {
          lines.push(`**Reward:** ${m.reward_signal.toFixed(2)}`);
        }
        if (m.goal_at_time) {
          lines.push(`**Goal:** ${m.goal_at_time}`);
        }
        if (m.injected) {
          lines.push(`**Injected:** Yes`);
        }
        lines.push('');
        lines.push('---');
        lines.push('');
      }
    }

    // Summary stats
    lines.push('## Summary Statistics');
    lines.push('');
    const avgReward = memories.reduce((sum, m) => sum + (m.reward_signal || 0), 0) / memories.length;
    const successes = memories.filter(m => m.outcome && !m.outcome.includes('fail')).length;
    lines.push(`- **Average Reward:** ${avgReward.toFixed(3)}`);
    lines.push(`- **Success Rate:** ${((successes / memories.length) * 100).toFixed(1)}%`);
    lines.push(`- **Injected Memories:** ${memories.filter(m => m.injected).length}`);
    lines.push('');

    fs.writeFileSync(path.join(exportDir, 'thoughts_report.md'), lines.join('\n'));

    onProgress(90, memories.length);

    // Zip
    const zip = new JSZip();
    this.addDirectoryToZip(zip, exportDir, exportDir);
    const content = await zip.generateAsync({ type: 'nodebuffer' });
    const zipFilename = `synthia_thoughts_${timestamp}.zip`;
    const zipPath = `./exports/${zipFilename}`;
    fs.writeFileSync(zipPath, content);

    fs.rmSync(exportDir, { recursive: true, force: true });

    const stats = fs.statSync(zipPath);
    return {
      filename: zipFilename,
      rows: memories.length,
      sizeBytes: stats.size
    };
  }

  // ─── Session Full export ───────────────────────────────────────────────────

  private async exportSessionFull(config: ExportConfig, exportDir: string, onProgress: (percent: number, rows: number) => void): Promise<{ filename: string, rows: number, sizeBytes: number }> {
    const timestamp = Date.now();

    // Determine which sessions to export
    let sessionIds: string[] = [];
    if (config.sessionIds && config.sessionIds.length > 0) {
      sessionIds = config.sessionIds;
    } else if (config.scope === 'session' && config.sessionIds) {
      sessionIds = config.sessionIds;
    } else {
      // Fetch all sessions for agent
      const { data: sessions } = await this.supabase
        .from('sessions')
        .select('id')
        .in('agent_id', config.agentIds)
        .order('started_at', { ascending: false });
      sessionIds = (sessions || []).map(s => s.id);
    }

    if (sessionIds.length === 0) throw new Error('No sessions found matching criteria');

    onProgress(5, 0);

    // 1. Fetch all memories for these sessions
    let query = this.supabase
      .from('memories')
      .select('*')
      .in('agent_id', config.agentIds)
      .in('session_id', sessionIds);

    if (config.includeTiers) query = query.in('tier', config.includeTiers);

    const { data: memories, error: memError } = await query.order('created_at', { ascending: true });
    if (memError) throw memError;

    onProgress(15, memories?.length || 0);

    // 2. Fetch skills
    const { data: skills } = await this.supabase
      .from('skills')
      .select('*')
      .in('agent_id', config.agentIds);

    onProgress(20, memories?.length || 0);

    // 3. Fetch motor programs
    const { data: motorPrograms } = await this.supabase
      .from('motor_programs')
      .select('*')
      .in('agent_id', config.agentIds);

    onProgress(25, memories?.length || 0);

    // 4. Write memories JSONL
    if (memories && memories.length > 0) {
      const memoriesDir = path.join(exportDir, 'memories');
      fs.mkdirSync(memoriesDir, { recursive: true });

      const lines = memories.map(m => JSON.stringify(m));
      fs.writeFileSync(path.join(memoriesDir, 'memories.jsonl'), lines.join('\n'));
    }

    // 5. Download frames if requested
    if (config.includeFrames && memories) {
      const framesDir = path.join(exportDir, 'frames');
      fs.mkdirSync(framesDir, { recursive: true });

      let downloaded = 0;
      const framesWithUrl = memories.filter(m => m.frame_url);

      for (const m of framesWithUrl) {
        const sessionDir = path.join(framesDir, m.session_id || 'unknown');
        fs.mkdirSync(sessionDir, { recursive: true });

        const framePath = path.join(sessionDir, `hb_${String(m.heartbeat).padStart(4, '0')}.webp`);
        try {
          const res = await fetch(m.frame_url);
          if (res.ok) {
            const buffer = await res.arrayBuffer();
            fs.writeFileSync(framePath, Buffer.from(buffer));
          }
        } catch (e) {
          console.warn(`[DatasetExporter] Failed to download frame for heartbeat ${m.heartbeat}`);
        }

        downloaded++;
        if (downloaded % 10 === 0) {
          onProgress(25 + Math.floor((downloaded / framesWithUrl.length) * 55), memories.length);
        }
      }
    }

    onProgress(80, memories?.length || 0);

    // 6. Write thoughts report
    if (config.includeThoughts !== false && memories && memories.length > 0) {
      const reportLines: string[] = [];
      reportLines.push('# SYNTHIA — Session Export');
      reportLines.push('');
      reportLines.push(`**Generated:** ${new Date().toISOString()}`);
      reportLines.push(`**Sessions:** ${sessionIds.join(', ')}`);
      reportLines.push(`**Total Memories:** ${memories.length}`);
      reportLines.push('');

      // Group by session
      const sessionGroups = new Map<string, any[]>();
      for (const m of memories) {
        const sid = m.session_id || 'unknown';
        if (!sessionGroups.has(sid)) sessionGroups.set(sid, []);
        sessionGroups.get(sid)!.push(m);
      }

      for (const [sid, sessionMemories] of sessionGroups) {
        reportLines.push(`## Session ${sid}`);
        reportLines.push('');
        reportLines.push(`- Heartbeats: ${sessionMemories[0]?.heartbeat} → ${sessionMemories[sessionMemories.length - 1]?.heartbeat}`);
        reportLines.push(`- Memories: ${sessionMemories.length}`);
        reportLines.push('');

        for (const m of sessionMemories) {
          reportLines.push(`### HB ${m.heartbeat} (Tier ${m.tier})`);
          reportLines.push('');
          reportLines.push(`> ${m.thought || '(no thought)'}`);
          reportLines.push('');
          if (m.visual_description) reportLines.push(`**Visual:** ${m.visual_description}`);
          if (m.outcome) reportLines.push(`**Outcome:** ${m.outcome}`);
          if (m.reward_signal != null) reportLines.push(`**Reward:** ${m.reward_signal.toFixed(2)}`);
          reportLines.push('');
        }
      }

      fs.writeFileSync(path.join(exportDir, 'thoughts_report.md'), reportLines.join('\n'));
    }

    // 7. Write skills
    if (config.includeSkills !== false && skills && skills.length > 0) {
      fs.writeFileSync(path.join(exportDir, 'skills.json'), JSON.stringify(skills, null, 2));
    }

    // 8. Write motor programs
    if (config.includeMotorPrograms !== false && motorPrograms && motorPrograms.length > 0) {
      fs.writeFileSync(path.join(exportDir, 'motor_programs.json'), JSON.stringify(motorPrograms, null, 2));
    }

    // 9. Write session metadata
    const { data: sessionMeta } = await this.supabase
      .from('sessions')
      .select('*')
      .in('id', sessionIds);

    if (sessionMeta) {
      fs.writeFileSync(path.join(exportDir, 'sessions.json'), JSON.stringify(sessionMeta, null, 2));
    }

    onProgress(90, memories?.length || 0);

    // Zip
    const zip = new JSZip();
    this.addDirectoryToZip(zip, exportDir, exportDir);
    const content = await zip.generateAsync({ type: 'nodebuffer' });
    const zipFilename = `synthia_session_full_${timestamp}.zip`;
    const zipPath = `./exports/${zipFilename}`;
    fs.writeFileSync(zipPath, content);

    fs.rmSync(exportDir, { recursive: true, force: true });

    const stats = fs.statSync(zipPath);
    return {
      filename: zipFilename,
      rows: memories?.length || 0,
      sizeBytes: stats.size
    };
  }

  // ─── Shared format methods ─────────────────────────────────────────────────

  private async exportLeRobot(memories: any[], exportDir: string, onProgress: (p: number, r: number) => void) {
    const dataDir = path.join(exportDir, 'data');
    const videoDir = path.join(exportDir, 'videos');
    const metaDir = path.join(exportDir, 'meta');
    fs.mkdirSync(dataDir);
    fs.mkdirSync(videoDir);
    fs.mkdirSync(metaDir);

    // Assemble Parquet data
    const observationJoints: number[][] = [];
    const actionJoints: number[][] = [];
    const rewards: number[] = [];

    const frameFiles: string[] = [];

    for (let i = 0; i < memories.length; i++) {
      const m = memories[i];
      // Joint states
      try {
        const jointState = JSON.parse(m.joint_state_summary);
        observationJoints.push(Object.values(jointState) as number[]);
      } catch {
        observationJoints.push([]);
      }

      // Actions
      try {
        const action = m.action_taken;
        actionJoints.push(Object.values(action.joint_overrides || {}) as number[]);
      } catch {
        actionJoints.push([]);
      }

      rewards.push(m.reward_signal || 0);

      // Download frames (WebP format from Supabase storage)
      if (m.frame_url) {
        const framePath = path.join(videoDir, `frame_${String(i).padStart(6, '0')}.webp`);
        const res = await fetch(m.frame_url);
        const buffer = await res.arrayBuffer();
        fs.writeFileSync(framePath, Buffer.from(buffer));
        frameFiles.push(framePath);
      }

      if (i % 10 === 0) onProgress(10 + Math.floor((i / memories.length) * 80), memories.length);
    }

    // Write Parquet
    const table = tableFromArrays({
      observation_joints: observationJoints,
      action_joints: actionJoints,
      reward: rewards
    });
    fs.writeFileSync(path.join(dataDir, 'chunk_000.parquet'), tableToIPC(table));

    // Stitch video
    if (frameFiles.length > 0) {
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(path.join(videoDir, 'frame_%06d.webp'))
          .inputFPS(1) // 1 frame per second for step-by-step view
          .output(path.join(videoDir, 'observation.mp4'))
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
      // Remove frames after stitching
      frameFiles.forEach(f => fs.unlinkSync(f));
    }

    // Meta
    const info = {
      schema_version: '1.0',
      fps: 0.5,
      total_frames: memories.length,
      features: {
         observation_joints: { shape: [observationJoints[0]?.length || 0] },
         action_joints: { shape: [actionJoints[0]?.length || 0] }
      }
    };
    fs.writeFileSync(path.join(metaDir, 'info.json'), JSON.stringify(info, null, 2));

    const stats = {
      observation_joints: { mean: observationJoints[0]?.length ? 0 : 0, std: 0, count: memories.length },
      action_joints: { mean: actionJoints[0]?.length ? 0 : 0, std: 0, count: memories.length },
      reward: { mean: rewards.reduce((a, b) => a + b, 0) / Math.max(rewards.length, 1), std: 0, count: rewards.length },
    };
    fs.writeFileSync(path.join(metaDir, 'stats.json'), JSON.stringify(stats, null, 2));

    const tasks = memories.map((m, i) =>
      JSON.stringify({ task_index: i, task: m.visual_description || 'embodiment_step' })
    );
    fs.writeFileSync(path.join(metaDir, 'tasks.jsonl'), tasks.join('\n'));
  }

  private async exportCSV(memories: any[], exportDir: string) {
    const header = 'heartbeat,tier,thought,action_json,outcome,reward,session_id\n';
    const rows = memories.map((m) => {
      const actionJson = JSON.stringify(m.action_taken || {}).replace(/"/g, '""');
      const thought = (m.thought || '').replace(/"/g, '""');
      const outcome = m.outcome || '';
      return `${m.heartbeat},${m.tier},"${thought}","${actionJson}",${outcome},${m.reward_signal ?? 0},${m.session_id ?? ''}`;
    });
    fs.writeFileSync(path.join(exportDir, 'export.csv'), header + rows.join('\n'));
  }

  private async exportJSONL(memories: any[], exportDir: string) {
    const lines = memories.map(m => {
      return JSON.stringify({
        session_id: m.session_id ?? null,
        messages: [
          { role: 'system', content: 'You are SYNTHIA, an AI embodiment.' },
          { role: 'user', content: `${m.visual_description} Audio: ${m.audio_state}` },
          { role: 'assistant', content: `${m.thought}---ACTION---${JSON.stringify({ actions: m.action_taken, memory_write: { tier: m.tier, summary: m.visual_description } })}` }
        ]
      });
    });
    fs.writeFileSync(path.join(exportDir, 'data.jsonl'), lines.join('\n'));
  }

  private addDirectoryToZip(zip: JSZip, rootPath: string, currentPath: string) {
    const files = fs.readdirSync(currentPath);
    for (const file of files) {
      const filePath = path.join(currentPath, file);
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        this.addDirectoryToZip(zip, rootPath, filePath);
      } else {
        const relativePath = path.relative(rootPath, filePath);
        zip.file(relativePath, fs.readFileSync(filePath));
      }
    }
  }
}
