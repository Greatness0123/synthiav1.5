// Kept in sync with frontend/src/types — update both if schema changes

export type ExportType = 'dataset' | 'frames_zip' | 'thoughts_report' | 'session_full';
export type ExportFormat = 'LeRobot' | 'JSONL' | 'CSV';

export interface ExportConfig {
  exportType: ExportType;
  format?: ExportFormat;           // Only for 'dataset' type
  agentIds: string[]
  scope: 'all' | 'date_range' | 'session' | 'heartbeat_range'
  dateFrom?: string        // ISO string
  dateTo?: string          // ISO string
  sessionIds?: string[]
  heartbeatFrom?: number
  heartbeatTo?: number
  includeTiers: (1 | 2 | 3)[]
  includeFrames: boolean
  includeThoughts?: boolean
  includeSkills?: boolean
  includeMotorPrograms?: boolean
  excludeInjected: boolean
  successfulOnly: boolean
  minReward?: number
}
