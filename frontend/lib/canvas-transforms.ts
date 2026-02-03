/**
 * Canvas coordinate transformation utilities
 * These functions handle zoom and pan transformations for the canvas renderer
 */

export interface Point {
    x: number
    y: number
}

export interface Transform {
    zoom: number
    pan: Point
}

/**
 * Apply canvas transformation to convert canvas coordinates to image coordinates
 * This is the forward transformation used during rendering
 * 
 * @param canvasPoint - Point in canvas space
 * @param transform - Zoom and pan transformation
 * @param canvasSize - Canvas dimensions
 * @returns Point in image space
 */
export function canvasToImage(
    canvasPoint: Point,
    transform: Transform,
    canvasSize: { width: number; height: number }
): Point {
    const { zoom, pan } = transform
    const { width, height } = canvasSize

    // Reverse the transformation pipeline:
    // 1. Translate from canvas origin to center
    let x = canvasPoint.x - width / 2
    let y = canvasPoint.y - height / 2

    // 2. Reverse zoom
    x = x / zoom
    y = y / zoom

    // 3. Reverse pan
    x = x - pan.x
    y = y - pan.y

    // 4. Translate back from center to image origin
    x = x + width / 2
    y = y + height / 2

    return { x, y }
}

/**
 * Apply inverse transformation to convert image coordinates to canvas coordinates
 * This is the inverse of canvasToImage
 * 
 * @param imagePoint - Point in image space
 * @param transform - Zoom and pan transformation
 * @param canvasSize - Canvas dimensions
 * @returns Point in canvas space
 */
export function imageToCanvas(
    imagePoint: Point,
    transform: Transform,
    canvasSize: { width: number; height: number }
): Point {
    const { zoom, pan } = transform
    const { width, height } = canvasSize

    // Apply the transformation pipeline (same as in canvas rendering):
    // 1. Translate to center
    let x = imagePoint.x - width / 2
    let y = imagePoint.y - height / 2

    // 2. Apply pan
    x = x + pan.x
    y = y + pan.y

    // 3. Apply zoom
    x = x * zoom
    y = y * zoom

    // 4. Translate back from center
    x = x + width / 2
    y = y + height / 2

    return { x, y }
}

/**
 * Compose two transformations
 * Useful for testing transformation properties
 */
export function composeTransforms(t1: Transform, t2: Transform): Transform {
    return {
        zoom: t1.zoom * t2.zoom,
        pan: {
            x: t1.pan.x + t2.pan.x / t1.zoom,
            y: t1.pan.y + t2.pan.y / t1.zoom,
        },
    }
}

/**
 * Get identity transformation (no zoom, no pan)
 */
export function identityTransform(): Transform {
    return {
        zoom: 1,
        pan: { x: 0, y: 0 },
    }
}
