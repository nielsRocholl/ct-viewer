'use client'

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react'
import { DEFAULT_LABEL_COLOR, DEFAULT_PRED_COLOR } from '@/lib/color-utils'

const LOCAL_PATCH_RADIUS = 15
const MIN_WINDOW_WIDTH = 20

export interface CanvasRendererHandle {
    getLevelAtPoint: (canvasX: number, canvasY: number) => number | null
    getWindowAtPoint: (canvasX: number, canvasY: number) => { level: number; width: number } | null
    getImagePoint: (canvasX: number, canvasY: number) => { x: number; y: number } | null
    canvas: HTMLCanvasElement | null
}

function hexToRgb(hex: string): [number, number, number] {
    const n = hex.replace(/^#/, '')
    if (n.length === 3) {
        const r = parseInt(n[0] + n[0], 16)
        const g = parseInt(n[1] + n[1], 16)
        const b = parseInt(n[2] + n[2], 16)
        return [r, g, b]
    }
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}

export interface OverlayLayerSpec {
    url: string | null
    colorMap: Map<number, string>
    opacity: number
    visible: boolean
}

export interface CanvasRendererProps {
    ctSliceUrl: string | null
    segmentationSliceUrl: string | null
    overlayMode: 'filled' | 'boundary'
    overlayOpacity: number
    overlayVisible: boolean
    colorMap: Map<number, string>
    predictionSliceUrl?: string | null
    predictionOpacity?: number
    predictionVisible?: boolean
    predictionColor?: string
    overlayLayers?: OverlayLayerSpec[]
    zoom: number
    pan: { x: number; y: number }
    windowLevel: number
    windowWidth: number
    width?: number
    height?: number
    onSliceDimensions?: (dims: { width: number; height: number }) => void
}

function toRaw(P: number, windowLevel: number, windowWidth: number): number {
    return (P / 255) * windowWidth + (windowLevel - windowWidth / 2)
}

function getLevelAtPointImpl(
    ctImg: HTMLImageElement,
    canvasX: number,
    canvasY: number,
    width: number,
    height: number,
    zoom: number,
    pan: { x: number; y: number },
    windowLevel: number,
    windowWidth: number,
    getTempCanvas: (w: number, h: number) => HTMLCanvasElement
): number {
    const r = getWindowAtPointImpl(ctImg, canvasX, canvasY, width, height, zoom, pan, windowLevel, windowWidth, getTempCanvas)
    return r ? r.level : windowLevel
}

function canvasToImagePoint(
    ctImg: HTMLImageElement,
    canvasX: number,
    canvasY: number,
    width: number,
    height: number,
    zoom: number,
    pan: { x: number; y: number }
): { x: number; y: number } | null {
    const srcW = ctImg.naturalWidth || ctImg.width
    const srcH = ctImg.naturalHeight || ctImg.height
    const scale = Math.min(width / srcW, height / srcH)
    if (scale <= 0) return null
    const drawW = srcW * scale
    const drawH = srcH * scale
    if (drawW <= 0 || drawH <= 0) return null
    const drawX = (width - drawW) / 2
    const drawY = (height - drawH) / 2
    const logicalX = (canvasX - width / 2) / zoom - pan.x + width / 2
    const logicalY = (canvasY - height / 2) / zoom - pan.y + height / 2
    const ix = Math.floor(((logicalX - drawX) / drawW) * srcW)
    const iy = Math.floor(((logicalY - drawY) / drawH) * srcH)
    if (ix < 0 || ix >= srcW || iy < 0 || iy >= srcH) return null
    return { x: ix, y: iy }
}

function getWindowAtPointImpl(
    ctImg: HTMLImageElement,
    canvasX: number,
    canvasY: number,
    width: number,
    height: number,
    zoom: number,
    pan: { x: number; y: number },
    windowLevel: number,
    windowWidth: number,
    getTempCanvas: (w: number, h: number) => HTMLCanvasElement
): { level: number; width: number } | null {
    const pt = canvasToImagePoint(ctImg, canvasX, canvasY, width, height, zoom, pan)
    if (!pt) return null
    const { x: ix, y: iy } = pt
    const srcW = ctImg.naturalWidth || ctImg.width
    const srcH = ctImg.naturalHeight || ctImg.height
    const temp = getTempCanvas(srcW, srcH)
    const tCtx = temp.getContext('2d', { willReadFrequently: true })
    if (!tCtx) return null
    tCtx.drawImage(ctImg, 0, 0)
    const x0 = Math.max(0, ix - LOCAL_PATCH_RADIUS)
    const y0 = Math.max(0, iy - LOCAL_PATCH_RADIUS)
    const x1 = Math.min(srcW, ix + LOCAL_PATCH_RADIUS + 1)
    const y1 = Math.min(srcH, iy + LOCAL_PATCH_RADIUS + 1)
    const data = tCtx.getImageData(x0, y0, x1 - x0, y1 - y0).data
    let Pmin = 255
    let Pmax = 0
    for (let i = 0; i < data.length; i += 4) {
        const p = data[i]
        if (p < Pmin) Pmin = p
        if (p > Pmax) Pmax = p
    }
    const rawMin = toRaw(Pmin, windowLevel, windowWidth)
    const rawMax = toRaw(Pmax, windowLevel, windowWidth)
    const level = (rawMin + rawMax) / 2
    const widthOut = Math.max(rawMax - rawMin, MIN_WINDOW_WIDTH)
    return { level, width: widthOut }
}

function buildLookup(colorMap: Map<number, string>, opacity: number): [number, number, number, number][] {
    const alphaByte = Math.round(opacity * 255)
    const out: [number, number, number, number][] = []
    for (let label = 0; label <= 255; label++) {
        if (label === 0) out.push([0, 0, 0, 0])
        else {
            const hex = colorMap.get(label) ?? DEFAULT_LABEL_COLOR
            const [r, g, b] = hexToRgb(hex)
            out.push([r, g, b, alphaByte])
        }
    }
    return out
}

function colorMapKey(colorMap: Map<number, string>): string {
    let s = ''
    colorMap.forEach((v, k) => {
        s += `${k}:${v};`
    })
    return s
}

export const CanvasRenderer = forwardRef<CanvasRendererHandle, CanvasRendererProps>(function CanvasRenderer(
    {
        ctSliceUrl,
        segmentationSliceUrl,
        overlayMode,
        overlayOpacity,
        overlayVisible,
        colorMap,
        predictionSliceUrl = null,
        predictionOpacity = 0.5,
        predictionVisible = false,
        predictionColor = DEFAULT_PRED_COLOR,
        overlayLayers: overlayLayersProp,
        zoom,
        pan,
        windowLevel,
        windowWidth,
        width = 512,
        height = 512,
        onSliceDimensions,
    },
    ref
) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null)
    const patchTempCanvasRef = useRef<HTMLCanvasElement | null>(null)
    const ctImageRef = useRef<HTMLImageElement | null>(null)
    const ctLoadIdRef = useRef(0)
    const layerImageRefs = useRef<(HTMLImageElement | null)[]>([])
    const layerLoadIdRef = useRef<number[]>([])
    const layerCacheRef = useRef<{ key: string; canvas: HTMLCanvasElement }[]>([])

    const overlayLayers = useMemo((): OverlayLayerSpec[] => {
        if (overlayLayersProp && overlayLayersProp.length > 0)
            return overlayLayersProp
        const predColorMap = new Map<number, string>()
        for (let i = 1; i <= 255; i++) predColorMap.set(i, predictionColor)
        return [
            { url: segmentationSliceUrl, colorMap, opacity: overlayOpacity, visible: overlayVisible },
            { url: predictionSliceUrl ?? null, colorMap: predColorMap, opacity: predictionOpacity, visible: predictionVisible },
        ]
    }, [
        overlayLayersProp,
        segmentationSliceUrl,
        predictionSliceUrl,
        colorMap,
        predictionColor,
        overlayOpacity,
        overlayVisible,
        predictionOpacity,
        predictionVisible,
    ])

    const getPatchCanvas = useCallback((w: number, h: number) => {
        let c = patchTempCanvasRef.current
        if (!c || c.width !== w || c.height !== h) {
            c = document.createElement('canvas')
            c.width = w
            c.height = h
            patchTempCanvasRef.current = c
        }
        return c
    }, [])

    const layerLookups = useMemo(
        () => overlayLayers.map((l) => buildLookup(l.colorMap, l.opacity)),
        [overlayLayers]
    )
    const layerKeys = useMemo(
        () =>
            overlayLayers.map((l) =>
                l.url ? `${l.url}|${l.opacity}|${colorMapKey(l.colorMap)}` : ''
            ),
        [overlayLayers]
    )

    useImperativeHandle(
        ref,
        () => ({
            getLevelAtPoint(canvasX: number, canvasY: number): number | null {
                const ctImg = ctImageRef.current
                if (!ctImg) return null
                return getLevelAtPointImpl(ctImg, canvasX, canvasY, width, height, zoom, pan, windowLevel, windowWidth, getPatchCanvas)
            },
            getWindowAtPoint(canvasX: number, canvasY: number): { level: number; width: number } | null {
                const ctImg = ctImageRef.current
                if (!ctImg) return null
                return getWindowAtPointImpl(ctImg, canvasX, canvasY, width, height, zoom, pan, windowLevel, windowWidth, getPatchCanvas)
            },
            getImagePoint(canvasX: number, canvasY: number): { x: number; y: number } | null {
                const ctImg = ctImageRef.current
                if (!ctImg) return null
                return canvasToImagePoint(ctImg, canvasX, canvasY, width, height, zoom, pan)
            },
            get canvas() {
                return canvasRef.current
            },
        }),
        [width, height, zoom, pan, windowLevel, windowWidth, getPatchCanvas]
    )

    const renderCanvas = useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const ctx = canvas.getContext('2d', { alpha: false })
        if (!ctx) return

        // Create or resize offscreen canvas for double-buffering
        if (!offscreenCanvasRef.current) {
            offscreenCanvasRef.current = document.createElement('canvas')
        }
        const offscreenCanvas = offscreenCanvasRef.current
        if (offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
            offscreenCanvas.width = width
            offscreenCanvas.height = height
        }
        const offscreenCtx = offscreenCanvas.getContext('2d', { alpha: false })
        if (!offscreenCtx) return
        offscreenCtx.fillStyle = '#000000'
        offscreenCtx.fillRect(0, 0, width, height)
        offscreenCtx.save()
        offscreenCtx.translate(width / 2, height / 2)
        offscreenCtx.scale(zoom, zoom)
        offscreenCtx.translate(pan.x, pan.y)
        offscreenCtx.translate(-width / 2, -height / 2)

        const ctImg = ctImageRef.current
        let refImg: HTMLImageElement | null = ctImg
        if (!refImg && layerImageRefs.current.length) {
            for (let i = 0; i < layerImageRefs.current.length; i++) {
                if (layerImageRefs.current[i]) {
                    refImg = layerImageRefs.current[i]
                    break
                }
            }
        }
        const srcW = refImg ? (refImg.naturalWidth || refImg.width) : 0
        const srcH = refImg ? (refImg.naturalHeight || refImg.height) : 0
        const scale = srcW > 0 && srcH > 0
            ? Math.min(width / srcW, height / srcH)
            : 1
        const drawW = srcW * scale
        const drawH = srcH * scale
        const drawX = (width - drawW) / 2
        const drawY = (height - drawH) / 2

        if (ctImg) {
            offscreenCtx.drawImage(ctImg, 0, 0, srcW, srcH, drawX, drawY, drawW, drawH)
        }

        let anyCrisp = false
        overlayLayers.forEach((layer, idx) => {
            const img = layerImageRefs.current[idx]
            if (layer.visible && img) anyCrisp = true
        })
        if (anyCrisp) offscreenCtx.imageSmoothingEnabled = false

        if (layerCacheRef.current.length < overlayLayers.length) {
            layerCacheRef.current.length = overlayLayers.length
        }
        overlayLayers.forEach((layer, idx) => {
            if (!layer.visible || !layer.url) return
            const img = layerImageRefs.current[idx]
            if (!img) return
            const sw = img.naturalWidth || img.width
            const sh = img.naturalHeight || img.height
            const lookup = layerLookups[idx] ?? layerLookups[0]
            const key = layerKeys[idx] ?? ''
            let cache = layerCacheRef.current[idx]
            if (!cache || cache.key !== key || cache.canvas.width !== sw || cache.canvas.height !== sh) {
                const temp = document.createElement('canvas')
                temp.width = sw
                temp.height = sh
                const tCtx = temp.getContext('2d', { willReadFrequently: true })
                if (!tCtx) return
                tCtx.drawImage(img, 0, 0)
                const data = tCtx.getImageData(0, 0, sw, sh)
                const d = data.data
                for (let i = 0; i < d.length; i += 4) {
                    const label = d[i]
                    const [r, g, b, a] = lookup[label] ?? lookup[0]
                    d[i] = r
                    d[i + 1] = g
                    d[i + 2] = b
                    d[i + 3] = a
                }
                tCtx.putImageData(data, 0, 0)
                cache = { key, canvas: temp }
                layerCacheRef.current[idx] = cache
            }
            offscreenCtx.drawImage(cache.canvas, 0, 0, sw, sh, drawX, drawY, drawW, drawH)
        })

        if (anyCrisp) offscreenCtx.imageSmoothingEnabled = true
        offscreenCtx.restore()
        ctx.drawImage(offscreenCanvas, 0, 0)
    }, [width, height, zoom, pan, overlayLayers, layerLookups, layerKeys])

    // Load CT image
    useEffect(() => {
        ctLoadIdRef.current += 1
        const loadId = ctLoadIdRef.current
        if (!ctSliceUrl) {
            ctImageRef.current = null
            return
        }
        const img = new Image()
        img.onload = () => {
            if (loadId !== ctLoadIdRef.current) return
            ctImageRef.current = img
            onSliceDimensions?.({ width: img.naturalWidth, height: img.naturalHeight })
            renderCanvas()
        }
        img.onerror = () => {
            if (loadId !== ctLoadIdRef.current) return
            console.error('Failed to load CT slice')
            ctImageRef.current = null
        }
        img.src = ctSliceUrl
    }, [ctSliceUrl, renderCanvas, onSliceDimensions])

    // Load overlay layer images
    useEffect(() => {
        const n = overlayLayers.length
        while (layerImageRefs.current.length < n) {
            layerImageRefs.current.push(null)
        }
        layerImageRefs.current.length = n
        while (layerLoadIdRef.current.length < n) {
            layerLoadIdRef.current.push(0)
        }
        layerLoadIdRef.current.length = n
        overlayLayers.forEach((layer, i) => {
            layerLoadIdRef.current[i] += 1
            const loadId = layerLoadIdRef.current[i]
            if (!layer.url) {
                layerImageRefs.current[i] = null
                return
            }
            layerImageRefs.current[i] = null
            const img = new Image()
            img.onload = () => {
                if (loadId !== layerLoadIdRef.current[i]) return
                layerImageRefs.current[i] = img
                renderCanvas()
            }
            img.onerror = () => {
                if (loadId !== layerLoadIdRef.current[i]) return
                layerImageRefs.current[i] = null
                renderCanvas()
            }
            img.src = layer.url
        })
    }, [overlayLayers, renderCanvas])

    // Render canvas whenever parameters change
    useEffect(() => {
        renderCanvas()
    }, [renderCanvas])

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="border border-gray-300 dark:border-gray-700"
            style={{ imageRendering: 'pixelated' }}
        />
    )
})
