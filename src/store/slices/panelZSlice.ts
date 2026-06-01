export interface PanelZSlice {
  _panelZCounter: number
  _panelZMap: Record<string, number>
  bringPanelToFront: (panelName: string) => void
  getPanelZIndex: (panelName: string, defaultZ: number) => number
}

interface PanelZState {
  _panelZCounter: number
  _panelZMap: Record<string, number>
}

type PanelZSet<TState extends PanelZState> = (
  partial: Partial<TState> | ((state: TState) => Partial<TState>),
) => void

interface CreatePanelZSliceDeps<TState extends PanelZState> {
  set: PanelZSet<TState>
  get: () => TState
}

export function resolvePanelZIndex(order: number | undefined, defaultZ: number): number {
  if (!order) return defaultZ
  return Math.max(defaultZ, 9990) + order
}

export function createPanelZSlice<TState extends PanelZState>({
  set,
  get,
}: CreatePanelZSliceDeps<TState>): PanelZSlice {
  return {
    _panelZCounter: 0,
    _panelZMap: {},

    bringPanelToFront: (panelName) => {
      const next = get()._panelZCounter + 1
      set({
        _panelZCounter: next,
        _panelZMap: { ...get()._panelZMap, [panelName]: next },
      } as Partial<TState>)
    },

    getPanelZIndex: (panelName, defaultZ) => {
      return resolvePanelZIndex(get()._panelZMap[panelName], defaultZ)
    },
  }
}
