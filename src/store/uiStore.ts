/**
 * Zustand store for UI visibility and navigation state.
 */

import { create } from 'zustand';

interface UIState {
  activeRightPanelTab: 'thoughts' | 'memories' | 'structure' | 'logs';
  rightPanelOpen: boolean;
  theme: 'dark' | 'light';
  exportModalOpen: boolean;
  objectSpawnerOpen: boolean;
  rehydrationModalOpen: boolean;
  exportProgress: number;
  selectedEntityId: string | null;

  // Actions
  setActiveRightPanelTab: (tab: 'thoughts' | 'memories' | 'structure' | 'logs') => void;
  setRightPanelOpen: (open: boolean) => void;
  toggleTheme: () => void;
  setSelectedEntityId: (id: string | null) => void;
  setExportModalOpen: (open: boolean) => void;
  setObjectSpawnerOpen: (open: boolean) => void;
  setRehydrationModalOpen: (open: boolean) => void;
  setExportProgress: (progress: number) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeRightPanelTab: 'thoughts',
  rightPanelOpen: false,
  theme: 'dark',
  exportModalOpen: false,
  objectSpawnerOpen: false,
  rehydrationModalOpen: false,
  exportProgress: 0,
  selectedEntityId: null,

  setActiveRightPanelTab: (activeRightPanelTab) => set({ activeRightPanelTab }),
  setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
  toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
  setSelectedEntityId: (selectedEntityId) => set({ selectedEntityId }),
  setExportModalOpen: (exportModalOpen) => set({ exportModalOpen }),
  setObjectSpawnerOpen: (objectSpawnerOpen) => set({ objectSpawnerOpen }),
  setRehydrationModalOpen: (rehydrationModalOpen) => set({ rehydrationModalOpen }),
  setExportProgress: (exportProgress) => set({ exportProgress }),
}));
