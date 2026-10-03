import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type DockHeight = "collapsed" | "normal" | "tall";

export interface Preferences {
  /** hovering a concept shows a short explanation */
  learnMode: boolean;
  /** full metrics, raw values and model parameters */
  advanced: boolean;
  /** WCAG 2.1.4: single-character shortcuts can be switched off */
  singleKeyShortcuts: boolean;
  dockHeight: DockHeight;
}

interface PreferenceActions {
  setLearnMode: (learnMode: boolean) => void;
  toggleLearnMode: () => void;
  setAdvanced: (advanced: boolean) => void;
  toggleAdvanced: () => void;
  setSingleKeyShortcuts: (enabled: boolean) => void;
  setDockHeight: (dockHeight: DockHeight) => void;
  cycleDockHeight: () => void;
}

export const PREFERENCE_DEFAULTS: Preferences = {
  learnMode: false,
  advanced: false,
  singleKeyShortcuts: true,
  dockHeight: "normal",
};

/** The server has no preferences to read; it renders the defaults. */
const serverStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const NEXT_DOCK_HEIGHT: Record<DockHeight, DockHeight> = {
  collapsed: "normal",
  normal: "tall",
  tall: "collapsed",
};

/**
 * Persisted in localStorage. Hydration is deferred (`skipHydration`) so server and first client
 * render agree; `Providers` calls `usePreferences.persist.rehydrate()` after mount.
 */
export const usePreferences = create<Preferences & PreferenceActions>()(
  persist(
    (set) => ({
      ...PREFERENCE_DEFAULTS,
      setLearnMode: (learnMode) => set({ learnMode }),
      toggleLearnMode: () => set((state) => ({ learnMode: !state.learnMode })),
      setAdvanced: (advanced) => set({ advanced }),
      toggleAdvanced: () => set((state) => ({ advanced: !state.advanced })),
      setSingleKeyShortcuts: (singleKeyShortcuts) =>
        set({ singleKeyShortcuts }),
      setDockHeight: (dockHeight) => set({ dockHeight }),
      cycleDockHeight: () =>
        set((state) => ({ dockHeight: NEXT_DOCK_HEIGHT[state.dockHeight] })),
    }),
    {
      name: "helix.preferences",
      version: 1,
      storage: createJSONStorage(() => (typeof window === "undefined" ? serverStorage : window.localStorage)),
      skipHydration: true,
      partialize: ({
        learnMode,
        advanced,
        singleKeyShortcuts,
        dockHeight,
      }) => ({
        learnMode,
        advanced,
        singleKeyShortcuts,
        dockHeight,
      }),
    },
  ),
);

export const useLearnMode = () => usePreferences((state) => state.learnMode);
export const useAdvancedMode = () => usePreferences((state) => state.advanced);
