/**
 * Modal for exporting simulation data with side-panel preview.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useCoordinator } from '../../world/hooks/useCoordinator';
import { useConnectionStore } from '../../store/connectionStore';
import { useAgentStore } from '../../store/agentStore';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import * as Icons from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { STRINGS } from '../../constants/strings';
import type { ExportFormat, ExportConfig, ExportType } from '../../types/export';
import { synthiaToast } from '../ui/Toast';

interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  total_heartbeats: number;
  body_type: string | null;
  memory_count: number;
  estimated_size_bytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const ExportModal: React.FC = () => {
  const { exportModalOpen, setExportModalOpen, exportProgress, setExportProgress } = useUIStore();
  const { sendMessage, onMessage } = useCoordinator();
  const { status, supabaseUrl, supabaseKey } = useConnectionStore();
  const { memories, heartbeat } = useAgentStore();

  const [availableSessions, setAvailableSessions] = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const [exportType, setExportType] = useState<ExportType>('dataset');
  const [format, setFormat] = useState<ExportFormat>('LeRobot');
  const [scope, setScope] = useState<ExportConfig['scope']>('all');

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [hbFrom, setHbFrom] = useState(0);
  const [hbTo, setHbTo] = useState(heartbeat);
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);

  const [includeTiers, setIncludeTiers] = useState<number[]>([1, 2, 3]);
  const [includeFrames, setIncludeFrames] = useState(true);
  const [includeThoughts, setIncludeThoughts] = useState(true);
  const [includeSkills, setIncludeSkills] = useState(true);
  const [includeMotorPrograms, setIncludeMotorPrograms] = useState(true);
  const [excludeInjected, setExcludeInjected] = useState(false);
  const [successfulOnly, setSuccessfulOnly] = useState(false);
  const [minReward, setMinReward] = useState(0);
  const [tierInfoOpen, setTierInfoOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (!exportModalOpen || !supabaseUrl || !supabaseKey) {
      setAvailableSessions([]);
      return;
    }
    setSessionsLoading(true);
    sendMessage('fetch_sessions', { agentId: 'agent_a' });
  }, [exportModalOpen, supabaseUrl, supabaseKey, sendMessage]);

  useEffect(() => {
    const unsub = onMessage((msg: any) => {
      if (msg.type === 'sessions_data') {
        setAvailableSessions(msg.data.sessions || []);
        setSessionsLoading(false);
      }
    });
    return unsub;
  }, [onMessage]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setExportModalOpen]);

  const filteredCount = useMemo(() => {
    let filtered = memories.filter(memory => includeTiers.includes(memory.tier));
    if (excludeInjected) filtered = filtered.filter(memory => !memory.isInjected);
    if (successfulOnly) filtered = filtered.filter(memory => memory.rewardSignal > 0.5);
    if (minReward > 0) filtered = filtered.filter(memory => memory.rewardSignal >= minReward);
    if (scope === 'heartbeat_range') {
      filtered = filtered.filter(memory => memory.heartbeat >= hbFrom && memory.heartbeat <= hbTo);
    } else if (scope === 'session' && selectedSessions.length > 0) {
      filtered = filtered.filter((memory) => selectedSessions.includes(memory.sessionId ?? ''));
    }
    return filtered.length;
  }, [memories, includeTiers, excludeInjected, successfulOnly, minReward, scope, hbFrom, hbTo, selectedSessions]);

  const estimatedSize = useMemo(() => {
    const bytesPerRow = includeFrames ? 52 * 1024 : 2 * 1024;
    const totalBytes = filteredCount * bytesPerRow;
    if (totalBytes > 1024 * 1024) return `~${(totalBytes / (1024 * 1024)).toFixed(1)}MB`;
    return `~${(totalBytes / 1024).toFixed(1)}KB`;
  }, [filteredCount, includeFrames]);

  const selectedSessionData = useMemo(() => {
    return availableSessions.filter(s => selectedSessions.includes(s.id));
  }, [availableSessions, selectedSessions]);

  const totalMemoryCount = useMemo(() => {
    if (scope === 'session' && selectedSessionData.length > 0) {
      return selectedSessionData.reduce((sum, s) => sum + (s.memory_count || 0), 0);
    }
    return filteredCount;
  }, [scope, selectedSessionData, filteredCount]);

  const totalSessionSize = useMemo(() => {
    if (scope === 'session' && selectedSessionData.length > 0) {
      return selectedSessionData.reduce((sum, s) => sum + (s.estimated_size_bytes || 0), 0);
    }
    // Fallback: estimate from filtered count
    const bytesPerRow = includeFrames ? 52 * 1024 : 2 * 1024;
    return filteredCount * bytesPerRow;
  }, [scope, selectedSessionData, filteredCount, includeFrames]);

  const handleExport = () => {
    if (status !== 'connected') {
      synthiaToast.error('Must be connected to coordinator to export');
      return;
    }
    if (scope === 'session' && selectedSessionData.length > 0 && totalSessionSize === 0) {
      synthiaToast.error('Selected sessions have no data to export');
      return;
    }
    setIsExporting(true);
    setExportProgress(0);
    synthiaToast.info(STRINGS.TOASTS.EXPORT_STARTED);

    const config: ExportConfig = {
      exportType,
      format: exportType === 'dataset' ? format : undefined,
      agentIds: ['agent_a'],
      scope,
      includeTiers: includeTiers as any,
      includeFrames,
      includeThoughts: exportType === 'session_full' ? includeThoughts : undefined,
      includeSkills: exportType === 'session_full' ? includeSkills : undefined,
      includeMotorPrograms: exportType === 'session_full' ? includeMotorPrograms : undefined,
      excludeInjected,
      successfulOnly,
      minReward,
      dateFrom: scope === 'date_range' ? dateFrom : undefined,
      dateTo: scope === 'date_range' ? dateTo : undefined,
      heartbeatFrom: scope === 'heartbeat_range' ? hbFrom : undefined,
      heartbeatTo: scope === 'heartbeat_range' ? hbTo : undefined,
      sessionIds: scope === 'session' ? selectedSessions : undefined,
    };

    sendMessage('export_request', config);
  };

  useEffect(() => {
    if (exportProgress === 100 && isExporting) {
      setIsExporting(false);
      setExportModalOpen(false);
    }
  }, [exportProgress, isExporting, setExportModalOpen]);

  const toggleTier = (tier: number) => {
    setIncludeTiers(prev =>
      prev.includes(tier) ? prev.filter(t => t !== tier) : [...prev, tier]
    );
  };

  if (!exportModalOpen) return null;

  const exportTypes: { id: ExportType; name: string; icon: Icons.Icon; desc: string }[] = [
    { id: 'dataset', name: 'Dataset', icon: Icons.Database, desc: STRINGS.EXPORT.EXPORT_TYPE_DATASET_DESC },
    { id: 'frames_zip', name: 'Frames ZIP', icon: Icons.Image, desc: STRINGS.EXPORT.EXPORT_TYPE_FRAMES_DESC },
    { id: 'thoughts_report', name: 'Thoughts Report', icon: Icons.Notebook, desc: STRINGS.EXPORT.EXPORT_TYPE_THOUGHTS_DESC },
    { id: 'session_full', name: 'Session Full', icon: Icons.Archive, desc: STRINGS.EXPORT.EXPORT_TYPE_SESSION_FULL_DESC },
  ];

  const formats: { id: ExportFormat; name: string; icon: Icons.Icon }[] = [
    { id: 'LeRobot', name: 'LeRobot (HF)', icon: Icons.HardDrive },
    { id: 'JSONL', name: 'JSONL', icon: Icons.FileCode },
    { id: 'CSV', name: 'CSV', icon: Icons.FileCsv },
  ];

  const scopeOptions = [
    { id: 'all', label: 'All Sessions' },
    { id: 'date_range', label: 'Date Range' },
    { id: 'session', label: 'Session Picker', disabled: !supabaseUrl || !supabaseKey },
    { id: 'heartbeat_range', label: 'Heartbeat Range' },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-[780px] max-h-[90vh] flex flex-col"
      >
        <Panel className="border-border-subtle shadow-2xl overflow-hidden flex flex-col">
          <div className="p-4 border-b border-border flex items-center justify-between bg-bg-panel shrink-0">
            <h2 className="text-sm font-bold uppercase tracking-widest text-text-secondary">{STRINGS.EXPORT.TITLE}</h2>
            <button onClick={() => setExportModalOpen(false)} className="text-text-tertiary hover:text-text-primary">
              <Icons.X size={20} />
            </button>
          </div>

          <div className="flex overflow-hidden" style={{ minHeight: '460px' }}>
            {/* LEFT PANEL — Configuration */}
            <div className="flex-1 p-6 space-y-5 overflow-y-auto border-r border-border-subtle">
              {/* Export Type Selector */}
              <div className="space-y-3">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">{STRINGS.EXPORT.EXPORT_TYPE}</label>
                <div className="grid grid-cols-2 gap-2">
                  {exportTypes.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setExportType(t.id)}
                      className={`flex items-center gap-3 p-2.5 border rounded-btn transition-all text-left ${
                        exportType === t.id
                          ? "border-accent-blue bg-accent-blue/5 text-text-primary"
                          : "border-border text-text-tertiary hover:border-text-secondary"
                      }`}
                    >
                      <t.icon size={18} weight="light" />
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold">{t.name}</span>
                        <span className="text-[9px] text-text-tertiary">{t.desc}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Format Selector (only for dataset) */}
              <AnimatePresence>
                {exportType === 'dataset' && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="space-y-3 overflow-hidden"
                  >
                    <label className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">{STRINGS.EXPORT.SELECT_FORMAT}</label>
                    <div className="grid grid-cols-3 gap-2">
                      {formats.map((f) => (
                        <button
                          key={f.id}
                          onClick={() => setFormat(f.id)}
                          className={`flex flex-col items-center gap-1.5 p-2.5 border rounded-btn transition-all ${
                            format === f.id
                              ? "border-accent-blue bg-accent-blue/5 text-text-primary"
                              : "border-border text-text-tertiary hover:border-text-secondary"
                          }`}
                        >
                          <f.icon size={20} weight="light" />
                          <span className="text-[10px] font-bold">{f.name}</span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Session Full sub-options */}
              <AnimatePresence>
                {exportType === 'session_full' && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="space-y-3 overflow-hidden"
                  >
                    <label className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">Include In Export</label>
                    <div className="grid grid-cols-2 gap-y-2">
                      {[
                        { label: STRINGS.EXPORT.INCLUDE_VISUALS, checked: includeFrames, onChange: () => setIncludeFrames(!includeFrames) },
                        { label: STRINGS.EXPORT.INCLUDE_THOUGHTS, checked: includeThoughts, onChange: () => setIncludeThoughts(!includeThoughts) },
                        { label: STRINGS.EXPORT.INCLUDE_SKILLS, checked: includeSkills, onChange: () => setIncludeSkills(!includeSkills) },
                        { label: STRINGS.EXPORT.INCLUDE_MOTOR_PROGRAMS, checked: includeMotorPrograms, onChange: () => setIncludeMotorPrograms(!includeMotorPrograms) },
                      ].map((opt, i) => (
                        <label key={i} className="flex items-center gap-3 cursor-pointer group">
                          <div className={`w-4 h-4 border rounded-[4px] flex items-center justify-center transition-colors ${opt.checked ? 'border-accent-blue bg-accent-blue/10' : 'border-border bg-bg-elevated'}`}>
                            {opt.checked && <div className="w-2 h-2 bg-accent-blue rounded-[1px]" />}
                          </div>
                          <span className="text-[11px] text-text-secondary group-hover:text-text-primary transition-colors">{opt.label}</span>
                          <input type="checkbox" className="hidden" checked={opt.checked} onChange={opt.onChange} />
                        </label>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Scope Selector */}
              <div className="space-y-3">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">{STRINGS.EXPORT.SCOPE_LABEL}</label>
                <div className="grid grid-cols-2 gap-2">
                  {scopeOptions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => !s.disabled && setScope(s.id as ExportConfig['scope'])}
                      title={s.disabled ? 'Connect Supabase to browse past sessions' : undefined}
                      disabled={s.disabled}
                      className={`px-3 py-2 text-[10px] font-bold uppercase border rounded-btn transition-all ${
                        scope === s.id
                          ? "border-accent-blue bg-accent-blue/5 text-text-primary"
                          : s.disabled
                            ? "border-border text-text-tertiary/40 cursor-not-allowed"
                            : "border-border text-text-tertiary hover:border-text-secondary"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                <AnimatePresence mode="wait">
                  {scope === 'date_range' && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="grid grid-cols-2 gap-3 pt-2">
                      <div className="space-y-1">
                        <label className="text-[9px] uppercase text-text-tertiary">From</label>
                        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full h-8 px-2 bg-bg-elevated border border-border rounded-btn text-xs" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] uppercase text-text-tertiary">To</label>
                        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full h-8 px-2 bg-bg-elevated border border-border rounded-btn text-xs" />
                      </div>
                    </motion.div>
                  )}

                  {scope === 'heartbeat_range' && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="grid grid-cols-2 gap-3 pt-2">
                      <div className="space-y-1">
                        <label className="text-[9px] uppercase text-text-tertiary">From</label>
                        <input type="number" value={hbFrom} onChange={e => setHbFrom(parseInt(e.target.value))} className="w-full h-8 px-2 bg-bg-elevated border border-border rounded-btn text-xs font-mono" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] uppercase text-text-tertiary">To (Max: {heartbeat})</label>
                        <input type="number" value={hbTo} onChange={e => setHbTo(parseInt(e.target.value))} className="w-full h-8 px-2 bg-bg-elevated border border-border rounded-btn text-xs font-mono" />
                      </div>
                    </motion.div>
                  )}

                  {scope === 'session' && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="pt-2">
                      {!supabaseUrl || !supabaseKey ? (
                        <div className="p-3 text-[10px] text-text-tertiary border border-border rounded-btn">
                          Session picker requires Supabase — connect in the Connection panel.
                        </div>
                      ) : sessionsLoading ? (
                        <div className="p-3 text-[10px] text-text-tertiary">{STRINGS.EXPORT.SESSIONS_LOADING}</div>
                      ) : availableSessions.length === 0 ? (
                        <div className="p-3 text-[10px] text-text-tertiary">{STRINGS.EXPORT.NO_SESSIONS}</div>
                      ) : (
                        <div className="max-h-36 overflow-y-auto border border-border rounded-btn bg-bg-elevated/10">
                          {availableSessions.map((session) => (
                            <label
                              key={session.id}
                              className="flex items-center gap-3 p-2 hover:bg-bg-elevated/20 cursor-pointer border-b border-border last:border-0"
                            >
                              <input
                                type="checkbox"
                                checked={selectedSessions.includes(session.id)}
                                onChange={() =>
                                  setSelectedSessions((prev) =>
                                    prev.includes(session.id)
                                      ? prev.filter((id) => id !== session.id)
                                      : [...prev, session.id]
                                  )
                                }
                                className="accent-accent-blue"
                              />
                              <div className="flex flex-col flex-1 min-w-0">
                                <span className="text-[10px] font-mono text-text-primary truncate">{session.id}</span>
                                <span className="text-[9px] text-text-tertiary">
                                  {new Date(session.started_at).toLocaleString()} · {session.total_heartbeats ?? 0} hb · {session.memory_count ?? 0} memories · {formatBytes(session.estimated_size_bytes || 0)}
                                </span>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Tier Filters */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">{STRINGS.EXPORT.TIER_LABEL}</label>
                  <button
                    onClick={() => setTierInfoOpen(!tierInfoOpen)}
                    className="flex items-center gap-1 text-[9px] text-accent-blue hover:text-accent-blue/80 transition-colors"
                  >
                    <Icons.Info size={12} />
                    {STRINGS.EXPORT.TIER_INFO}
                  </button>
                </div>

                <AnimatePresence>
                  {tierInfoOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="p-3 bg-bg-elevated/30 rounded-btn border border-border-subtle space-y-2 mb-3">
                        {[
                          { tier: 1, name: STRINGS.EXPORT.TIER_1_NAME, desc: STRINGS.EXPORT.TIER_1_DESC, color: 'text-accent-green' },
                          { tier: 2, name: STRINGS.EXPORT.TIER_2_NAME, desc: STRINGS.EXPORT.TIER_2_DESC, color: 'text-accent-blue' },
                          { tier: 3, name: STRINGS.EXPORT.TIER_3_NAME, desc: STRINGS.EXPORT.TIER_3_DESC, color: 'text-accent-amber' },
                        ].map(({ tier, name, desc, color }) => (
                          <div key={tier} className="flex items-start gap-2">
                            <span className={`text-[10px] font-bold font-mono ${color}`}>T{tier}</span>
                            <div className="flex flex-col">
                              <span className="text-[10px] font-bold text-text-secondary">{name}</span>
                              <span className="text-[9px] text-text-tertiary leading-relaxed">{desc}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="grid grid-cols-3 gap-2">
                  {[1, 2, 3].map((tier) => (
                    <button
                      key={tier}
                      onClick={() => toggleTier(tier)}
                      className={`px-3 py-2 text-[10px] font-bold border rounded-btn transition-all ${
                        includeTiers.includes(tier)
                          ? 'border-accent-blue bg-accent-blue/5 text-text-primary'
                          : 'border-border text-text-tertiary hover:border-text-secondary'
                      }`}
                    >
                      Tier {tier}
                    </button>
                  ))}
                </div>
              </div>

              {/* Additional Filters */}
              <div className="space-y-3">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">{STRINGS.EXPORT.FILTERS}</label>
                <div className="grid grid-cols-2 gap-y-2">
                  {[
                    { label: STRINGS.EXPORT.INCLUDE_VISUALS, checked: includeFrames, onChange: () => setIncludeFrames(!includeFrames) },
                    { label: 'Exclude Injected', checked: excludeInjected, onChange: () => setExcludeInjected(!excludeInjected) },
                    { label: 'Successful Only', checked: successfulOnly, onChange: () => setSuccessfulOnly(!successfulOnly) },
                  ].map((opt, i) => (
                    <label key={i} className="flex items-center gap-3 cursor-pointer group">
                      <div className={`w-4 h-4 border rounded-[4px] flex items-center justify-center transition-colors ${opt.checked ? 'border-accent-blue bg-accent-blue/10' : 'border-border bg-bg-elevated'}`}>
                        {opt.checked && <div className="w-2 h-2 bg-accent-blue rounded-[1px]" />}
                      </div>
                      <span className="text-[11px] text-text-secondary group-hover:text-text-primary transition-colors">{opt.label}</span>
                      <input type="checkbox" className="hidden" checked={opt.checked} onChange={opt.onChange} />
                    </label>
                  ))}
                </div>

                <div className="pt-1 space-y-1.5">
                  <div className="flex justify-between">
                    <label className="text-[10px] uppercase text-text-tertiary">Min Reward Signal</label>
                    <span className="text-[10px] font-mono text-text-secondary">{minReward.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={minReward}
                    onChange={e => setMinReward(parseFloat(e.target.value))}
                    className="w-full h-1 bg-bg-elevated rounded-lg appearance-none cursor-pointer accent-accent-blue"
                  />
                </div>
              </div>
            </div>

            {/* RIGHT PANEL — Preview */}
            <div className="w-[280px] p-5 bg-bg-elevated/20 flex flex-col">
              <div className="flex items-center gap-2 mb-4">
                <Icons.Eye size={14} weight="light" className="text-accent-blue" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{STRINGS.EXPORT.PREVIEW_PANEL}</span>
              </div>

              {filteredCount === 0 && !isExporting ? (
                <div className="flex-1 flex items-center justify-center">
                  <span className="text-[10px] text-text-tertiary text-center">{STRINGS.EXPORT.NO_SELECTION}</span>
                </div>
              ) : (
                <div className="space-y-4 flex-1">
                  {/* Export Type */}
                  <div className="space-y-1">
                    <span className="text-[9px] uppercase text-text-tertiary">Type</span>
                    <span className="text-xs font-bold text-text-primary">
                      {exportTypes.find(t => t.id === exportType)?.name}
                    </span>
                  </div>

                  {/* Format (dataset only) */}
                  {exportType === 'dataset' && (
                    <div className="space-y-1">
                      <span className="text-[9px] uppercase text-text-tertiary">Format</span>
                      <span className="text-xs font-bold text-text-primary">{format}</span>
                    </div>
                  )}

                  {/* Scope */}
                  <div className="space-y-1">
                    <span className="text-[9px] uppercase text-text-tertiary">Scope</span>
                    <span className="text-xs font-bold text-text-primary capitalize">{scope.replace('_', ' ')}</span>
                    {scope === 'session' && selectedSessions.length > 0 && (
                      <span className="text-[9px] text-accent-blue">{selectedSessions.length} session(s) selected</span>
                    )}
                  </div>

                  {/* Tiers */}
                  <div className="space-y-1">
                    <span className="text-[9px] uppercase text-text-tertiary">Tiers</span>
                    <div className="flex gap-1">
                      {includeTiers.map(t => (
                        <span key={t} className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${
                          t === 1 ? 'bg-accent-green/10 text-accent-green' :
                          t === 2 ? 'bg-accent-blue/10 text-accent-blue' :
                          'bg-accent-amber/10 text-accent-amber'
                        }`}>
                          T{t}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Breakdown */}
                  <div className="space-y-1">
                    <span className="text-[9px] uppercase text-text-tertiary">Breakdown</span>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-text-tertiary">Memories</span>
                        <span className="text-text-secondary font-mono">{totalMemoryCount.toLocaleString()}</span>
                      </div>
                      {includeFrames && (
                        <div className="flex justify-between text-[10px]">
                          <span className="text-text-tertiary">Frames</span>
                          <span className="text-text-secondary font-mono">{totalMemoryCount.toLocaleString()}</span>
                        </div>
                      )}
                      {scope === 'session' && selectedSessionData.length > 0 && (
                        <div className="flex justify-between text-[10px]">
                          <span className="text-text-tertiary">Sessions</span>
                          <span className="text-text-secondary font-mono">{selectedSessionData.length}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="h-px bg-border-subtle" />

                  {/* Size Estimate */}
                  <div className="space-y-1">
                    <span className="text-[9px] uppercase text-text-tertiary">{STRINGS.EXPORT.ESTIMATED_SIZE}</span>
                    <span className="text-sm font-bold text-text-primary">
                      {scope === 'session' && selectedSessionData.length > 0
                        ? formatBytes(totalSessionSize)
                        : estimatedSize}
                    </span>
                    {!supabaseUrl && (
                      <span className="text-[9px] text-accent-amber">
                        Estimated from current session only.
                      </span>
                    )}
                  </div>

                  {/* Filters active */}
                  <div className="space-y-1">
                    <span className="text-[9px] uppercase text-text-tertiary">Active Filters</span>
                    <div className="flex flex-wrap gap-1">
                      {excludeInjected && <span className="px-1.5 py-0.5 text-[8px] bg-bg-elevated rounded text-text-tertiary">No Injected</span>}
                      {successfulOnly && <span className="px-1.5 py-0.5 text-[8px] bg-bg-elevated rounded text-text-tertiary">Successful Only</span>}
                      {minReward > 0 && <span className="px-1.5 py-0.5 text-[8px] bg-bg-elevated rounded text-text-tertiary">Reward ≥ {minReward.toFixed(1)}</span>}
                      {!excludeInjected && !successfulOnly && minReward === 0 && (
                        <span className="text-[9px] text-text-tertiary">None</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Export Button */}
              <div className="mt-auto pt-4 space-y-3">
                <Button
                  variant="primary"
                  className="w-full h-10 font-bold uppercase tracking-widest text-xs"
                  onClick={handleExport}
                  disabled={isExporting || filteredCount === 0 || (scope === 'session' && selectedSessionData.length > 0 && totalSessionSize === 0)}
                >
                  {isExporting ? STRINGS.EXPORT.EXPORTING(exportProgress) : STRINGS.EXPORT.START_EXPORT}
                </Button>

                {isExporting && (
                  <div className="w-full h-1 bg-bg-elevated rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-accent-blue"
                      initial={{ width: 0 }}
                      animate={{ width: `${exportProgress}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </Panel>
      </motion.div>
    </div>
  );
};
