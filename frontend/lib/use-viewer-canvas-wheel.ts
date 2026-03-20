import { useEffect, useRef, type RefObject } from 'react'

const DELTA_PER_SLICE = 40
/** exp exponent scale per wheel unit; pinch/cmd+scroll deltaY can be large */
const ZOOM_EXP_PER_DELTA = 0.00156

const clampZoom = (z: number) => Math.min(10, Math.max(0.1, z))

export function useViewerCanvasWheel(
    targetRef: RefObject<HTMLElement | null>,
    enabled: boolean,
    maxSliceIndexInclusive: number,
    getSliceIndex: () => number,
    setSliceIndex: (n: number) => void,
    getZoom: () => number,
    setZoom: (z: number) => void
) {
    const accRef = useRef(0)
    const getSliceRef = useRef(getSliceIndex)
    const setSliceRef = useRef(setSliceIndex)
    const getZoomRef = useRef(getZoom)
    const setZoomRef = useRef(setZoom)
    getSliceRef.current = getSliceIndex
    setSliceRef.current = setSliceIndex
    getZoomRef.current = getZoom
    setZoomRef.current = setZoom

    useEffect(() => {
        const el = targetRef.current
        if (!el || !enabled) return

        const onWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault()
                const z = getZoomRef.current()
                const next = clampZoom(z * Math.exp(-e.deltaY * ZOOM_EXP_PER_DELTA))
                if (next !== z) setZoomRef.current(next)
                return
            }
            if (maxSliceIndexInclusive < 0) return
            e.preventDefault()
            accRef.current += e.deltaY
            let steps = 0
            const th = DELTA_PER_SLICE
            while (accRef.current >= th) {
                accRef.current -= th
                steps++
            }
            while (accRef.current <= -th) {
                accRef.current += th
                steps--
            }
            if (steps === 0) return
            const cur = getSliceRef.current()
            const next = Math.max(0, Math.min(maxSliceIndexInclusive, cur + steps))
            if (next !== cur) setSliceRef.current(next)
        }

        el.addEventListener('wheel', onWheel, { passive: false })
        return () => {
            el.removeEventListener('wheel', onWheel)
            accRef.current = 0
        }
    }, [targetRef, enabled, maxSliceIndexInclusive])
}
