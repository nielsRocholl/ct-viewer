import { create } from 'zustand'
import { generateDistinctColor } from '@/lib/color-utils'

export type ViewOrientation = 'axial' | 'sagittal' | 'coronal'

export interface SegVolumeEntry {
    volumeId: string
    colorMap: Map<number, string>
    visible?: boolean
}

export interface PairState {
    pairId: string
    ctVolumeId: string
    /** @deprecated use segVolumes[0] */
    segVolumeId?: string
    segVolumes?: SegVolumeEntry[]
    currentSliceIndex: number
    orientation: ViewOrientation
    windowLevel: number
    windowWidth: number
    zoom: number
    pan: { x: number; y: number }
    overlayVisible: boolean
    overlayMode: 'filled' | 'boundary'
    overlayOpacity: number
    /** @deprecated use segVolumes[0].colorMap */
    colorMap?: Map<number, string>
}

const MAX_SEG_VOLUMES_PER_PAIR = 10

export function getPairSegVolumes(pair: PairState): SegVolumeEntry[] {
    if (pair.segVolumes && pair.segVolumes.length > 0) {
        return pair.segVolumes.map((s) => ({ ...s, visible: s.visible !== false }))
    }
    if (pair.segVolumeId && pair.colorMap)
        return [{ volumeId: pair.segVolumeId, colorMap: pair.colorMap, visible: true }]
    return []
}

export interface DatasetCaseState {
    datasetId: string
    caseIndex: number
    caseCount: number
    caseId: string
    imageVolumeId: string
    labelVolumeId: string | null
    predVolumeId: string | null
}

interface ViewerState {
    pairs: Map<string, PairState>
    synchronized: boolean
    snapToMask: boolean
    globalSlicePhysical: number | null
    gridColumns: number
    viewMode: 'pairs' | 'dataset'
    datasetCase: DatasetCaseState | null

    // Actions
    addPair: (pair: PairState) => void
    removePair: (pairId: string) => void
    updatePairSlice: (pairId: string, sliceIndex: number) => void
    updatePairOrientation: (pairId: string, orientation: ViewOrientation) => void
    updatePairWindowLevel: (pairId: string, windowLevel: number, windowWidth: number) => void
    updatePairZoom: (pairId: string, zoom: number) => void
    updatePairPan: (pairId: string, pan: { x: number; y: number }) => void
    updatePairOverlay: (pairId: string, updates: Partial<Pick<PairState, 'overlayVisible' | 'overlayMode' | 'overlayOpacity'>>) => void
    updatePairColorMap: (pairId: string, colorMap: Map<number, string>) => void
    addSegToPair: (pairId: string, volumeId: string, colorMap?: Map<number, string>) => void
    removeSegFromPair: (pairId: string, index: number) => void
    updateSegColorMap: (pairId: string, index: number, colorMap: Map<number, string>) => void
    updateSegVisible: (pairId: string, index: number, visible: boolean) => void
    resetPairView: (pairId: string) => void
    setSynchronized: (synchronized: boolean) => void
    setSnapToMask: (v: boolean) => void
    setGlobalSlicePhysical: (position: number | null) => void
    setGridColumns: (n: number) => void
    updateAllPairsSlice: (sliceIndices: Map<string, number>) => void
    setViewMode: (mode: 'pairs' | 'dataset') => void
    setDatasetCase: (caseState: DatasetCaseState | null) => void
}

const DEFAULT_WINDOW_LEVEL = 40
const DEFAULT_WINDOW_WIDTH = 400
const DEFAULT_ZOOM = 1
const DEFAULT_PAN = { x: 0, y: 0 }
const DEFAULT_OVERLAY_OPACITY = 0.5

export const useViewerStore = create<ViewerState>((set) => ({
    pairs: new Map(),
    synchronized: false,
    snapToMask: false,
    globalSlicePhysical: null,
    gridColumns: 2,
    viewMode: 'pairs',
    datasetCase: null,

    addPair: (pair) =>
        set((state) => {
            const newPairs = new Map(state.pairs)
            newPairs.set(pair.pairId, pair)
            return { pairs: newPairs }
        }),

    removePair: (pairId) =>
        set((state) => {
            const newPairs = new Map(state.pairs)
            newPairs.delete(pairId)
            return { pairs: newPairs }
        }),

    updatePairSlice: (pairId, sliceIndex) =>
        set((state) => {
            const pair = state.pairs.get(pairId)
            if (!pair) return state

            const newPairs = new Map(state.pairs)
            newPairs.set(pairId, { ...pair, currentSliceIndex: sliceIndex })
            return { pairs: newPairs }
        }),

    updatePairOrientation: (pairId, orientation) =>
        set((state) => {
            const pair = state.pairs.get(pairId)
            if (!pair) return state

            const newPairs = new Map(state.pairs)
            newPairs.set(pairId, { ...pair, orientation })
            return { pairs: newPairs }
        }),

    updatePairWindowLevel: (pairId, windowLevel, windowWidth) =>
        set((state) => {
            const pair = state.pairs.get(pairId)
            if (!pair) return state

            const newPairs = new Map(state.pairs)
            newPairs.set(pairId, { ...pair, windowLevel, windowWidth })
            return { pairs: newPairs }
        }),

    updatePairZoom: (pairId, zoom) =>
        set((state) => {
            const pair = state.pairs.get(pairId)
            if (!pair) return state

            const newPairs = new Map(state.pairs)
            newPairs.set(pairId, { ...pair, zoom })
            return { pairs: newPairs }
        }),

    updatePairPan: (pairId, pan) =>
        set((state) => {
            const pair = state.pairs.get(pairId)
            if (!pair) return state

            const newPairs = new Map(state.pairs)
            newPairs.set(pairId, { ...pair, pan })
            return { pairs: newPairs }
        }),

    updatePairOverlay: (pairId, updates) =>
        set((state) => {
            const pair = state.pairs.get(pairId)
            if (!pair) return state

            const newPairs = new Map(state.pairs)
            newPairs.set(pairId, { ...pair, ...updates })
            return { pairs: newPairs }
        }),

    updatePairColorMap: (pairId, colorMap) =>
        set((state) => {
            const pair = state.pairs.get(pairId)
            if (!pair) return state
            const segs = getPairSegVolumes(pair)
            if (segs.length === 0) return state
            const newPairs = new Map(state.pairs)
            const newSegs = [...segs]
            newSegs[0] = { ...newSegs[0], colorMap }
            newPairs.set(pairId, { ...pair, segVolumes: newSegs, colorMap })
            return { pairs: newPairs }
        }),

    addSegToPair: (pairId, volumeId, colorMap) =>
        set((state) => {
            const pair = state.pairs.get(pairId)
            if (!pair) return state
            const segs = getPairSegVolumes(pair)
            if (segs.length >= MAX_SEG_VOLUMES_PER_PAIR) return state
            const newPairs = new Map(state.pairs)
            const defaultColor = generateDistinctColor(segs.length, MAX_SEG_VOLUMES_PER_PAIR)
            const entry: SegVolumeEntry = {
                volumeId,
                colorMap: colorMap ?? new Map([[1, defaultColor]]),
                visible: true,
            }
            newPairs.set(pairId, {
                ...pair,
                segVolumes: [...segs, entry],
                segVolumeId: segs.length === 0 ? volumeId : pair.segVolumeId ?? segs[0].volumeId,
            })
            return { pairs: newPairs }
        }),

    removeSegFromPair: (pairId, index) =>
        set((state) => {
            const pair = state.pairs.get(pairId)
            if (!pair) return state
            const segs = getPairSegVolumes(pair)
            if (index < 0 || index >= segs.length) return state
            const newPairs = new Map(state.pairs)
            const newSegs = segs.filter((_, i) => i !== index)
            if (newSegs.length === 0) return state
            newPairs.set(pairId, {
                ...pair,
                segVolumes: newSegs,
                segVolumeId: newSegs[0].volumeId,
            })
            return { pairs: newPairs }
        }),

    updateSegColorMap: (pairId, index, colorMap) =>
        set((state) => {
            const pair = state.pairs.get(pairId)
            if (!pair) return state
            const segs = getPairSegVolumes(pair)
            if (index < 0 || index >= segs.length) return state
            const newPairs = new Map(state.pairs)
            const newSegs = [...segs]
            newSegs[index] = { ...newSegs[index], colorMap }
            newPairs.set(pairId, { ...pair, segVolumes: newSegs })
            return { pairs: newPairs }
        }),

    updateSegVisible: (pairId, index, visible) =>
        set((state) => {
            const pair = state.pairs.get(pairId)
            if (!pair) return state
            const segs = getPairSegVolumes(pair)
            if (index < 0 || index >= segs.length) return state
            const newPairs = new Map(state.pairs)
            const newSegs = segs.map((s, i) => (i === index ? { ...s, visible } : s))
            newPairs.set(pairId, { ...pair, segVolumes: newSegs })
            return { pairs: newPairs }
        }),

    resetPairView: (pairId) =>
        set((state) => {
            const pair = state.pairs.get(pairId)
            if (!pair) return state

            const newPairs = new Map(state.pairs)
            newPairs.set(pairId, {
                ...pair,
                currentSliceIndex: 0,
                windowLevel: DEFAULT_WINDOW_LEVEL,
                windowWidth: DEFAULT_WINDOW_WIDTH,
                zoom: DEFAULT_ZOOM,
                pan: DEFAULT_PAN,
                overlayOpacity: DEFAULT_OVERLAY_OPACITY,
            })
            return { pairs: newPairs }
        }),

    setSynchronized: (synchronized) => set({ synchronized }),

    setSnapToMask: (v) => set({ snapToMask: v }),

    setGlobalSlicePhysical: (position) => set({ globalSlicePhysical: position }),

    setGridColumns: (n) => set({ gridColumns: Math.min(4, Math.max(1, n)) }),

    updateAllPairsSlice: (sliceIndices) =>
        set((state) => {
            const newPairs = new Map(state.pairs)
            sliceIndices.forEach((sliceIndex, pairId) => {
                const pair = newPairs.get(pairId)
                if (pair) {
                    newPairs.set(pairId, { ...pair, currentSliceIndex: sliceIndex })
                }
            })
            return { pairs: newPairs }
        }),

    setViewMode: (mode) => set({ viewMode: mode }),

    setDatasetCase: (caseState) => set({ datasetCase: caseState }),
}))
