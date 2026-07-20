import { create } from 'zustand';

export type LogLevel = 'success' | 'error' | 'info' | 'warning';

export interface LogEntry {
  id: string;
  message: string;
  level: LogLevel;
  timestamp: number;
}

interface LogState {
  entries: LogEntry[];
  maxEntries: number;

  addEntry: (message: string, level: LogLevel) => void;
  clear: () => void;
}

let _nextId = 0;

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  maxEntries: 200,

  addEntry: (message, level) => {
    const entry: LogEntry = {
      id: `log-${Date.now()}-${_nextId++}`,
      message,
      level,
      timestamp: Date.now(),
    };
    set((state) => {
      const next = [entry, ...state.entries];
      if (next.length > state.maxEntries) next.length = state.maxEntries;
      return { entries: next };
    });
  },

  clear: () => set({ entries: [] }),
}));
