/**
 * Property-based tests for canvas coordinate transformations
 * 
 * Feature: ct-segmentation-viewer, Property: Coordinate Transformation Correctness
 * 
 * These tests verify that zoom/pan transformations are mathematically correct
 * and that inverse transformations properly round-trip.
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    canvasToImage,
    imageToCanvas,
    identityTransform,
    type Point,
    type Transform,
} from './canvas-transforms'

describe('Canvas Coordinate Transformations', () => {
    // Arbitraries for property-based testing
    const pointArbitrary = fc.record({
        x: fc.double({ min: -10000, max: 10000, noNaN: true }),
        y: fc.double({ min: -10000, max: 10000, noNaN: true }),
    })

    const transformArbitrary = fc.record({
        zoom: fc.double({ min: 0.1, max: 10, noNaN: true }),
        pan: fc.record({
            x: fc.double({ min: -1000, max: 1000, noNaN: true }),
            y: fc.double({ min: -1000, max: 1000, noNaN: true }),
        }),
    })

    const canvasSizeArbitrary = fc.record({
        width: fc.integer({ min: 100, max: 2048 }),
        height: fc.integer({ min: 100, max: 2048 }),
    })

    describe('Property 1: Round-trip transformation (canvas → image → canvas)', () => {
        it('should preserve coordinates when applying forward then inverse transformation', () => {
            fc.assert(
                fc.property(
                    pointArbitrary,
                    transformArbitrary,
                    canvasSizeArbitrary,
                    (canvasPoint, transform, canvasSize) => {
                        // Apply forward transformation: canvas → image
                        const imagePoint = canvasToImage(canvasPoint, transform, canvasSize)

                        // Apply inverse transformation: image → canvas
                        const resultPoint = imageToCanvas(imagePoint, transform, canvasSize)

                        // The result should be very close to the original point
                        // Using a small epsilon for floating-point comparison
                        const epsilon = 1e-10
                        expect(Math.abs(resultPoint.x - canvasPoint.x)).toBeLessThan(epsilon)
                        expect(Math.abs(resultPoint.y - canvasPoint.y)).toBeLessThan(epsilon)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 2: Round-trip transformation (image → canvas → image)', () => {
        it('should preserve coordinates when applying inverse then forward transformation', () => {
            fc.assert(
                fc.property(
                    pointArbitrary,
                    transformArbitrary,
                    canvasSizeArbitrary,
                    (imagePoint, transform, canvasSize) => {
                        // Apply inverse transformation: image → canvas
                        const canvasPoint = imageToCanvas(imagePoint, transform, canvasSize)

                        // Apply forward transformation: canvas → image
                        const resultPoint = canvasToImage(canvasPoint, transform, canvasSize)

                        // The result should be very close to the original point
                        const epsilon = 1e-10
                        expect(Math.abs(resultPoint.x - imagePoint.x)).toBeLessThan(epsilon)
                        expect(Math.abs(resultPoint.y - imagePoint.y)).toBeLessThan(epsilon)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 3: Identity transformation preserves coordinates', () => {
        it('should not change coordinates when zoom=1 and pan=(0,0)', () => {
            fc.assert(
                fc.property(
                    pointArbitrary,
                    canvasSizeArbitrary,
                    (point, canvasSize) => {
                        const identity = identityTransform()

                        // Apply identity transformation
                        const imagePoint = canvasToImage(point, identity, canvasSize)
                        const resultPoint = imageToCanvas(imagePoint, identity, canvasSize)

                        // Should be exactly the same (or very close due to floating point)
                        const epsilon = 1e-10
                        expect(Math.abs(resultPoint.x - point.x)).toBeLessThan(epsilon)
                        expect(Math.abs(resultPoint.y - point.y)).toBeLessThan(epsilon)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 4: Zoom scales distances from center', () => {
        it('should scale distances from canvas center proportionally to zoom factor', () => {
            fc.assert(
                fc.property(
                    pointArbitrary,
                    fc.double({ min: 0.1, max: 10, noNaN: true }),
                    canvasSizeArbitrary,
                    (point, zoom, canvasSize) => {
                        const transform: Transform = { zoom, pan: { x: 0, y: 0 } }
                        const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 }

                        // Calculate distance from center in canvas space
                        const canvasDistX = point.x - center.x
                        const canvasDistY = point.y - center.y

                        // Transform to image space
                        const imagePoint = canvasToImage(point, transform, canvasSize)

                        // Calculate distance from center in image space
                        const imageDistX = imagePoint.x - center.x
                        const imageDistY = imagePoint.y - center.y

                        // The ratio of distances should equal 1/zoom (inverse scaling)
                        if (Math.abs(canvasDistX) > 1e-6) {
                            const ratioX = imageDistX / canvasDistX
                            expect(Math.abs(ratioX - 1 / zoom)).toBeLessThan(1e-6)
                        }

                        if (Math.abs(canvasDistY) > 1e-6) {
                            const ratioY = imageDistY / canvasDistY
                            expect(Math.abs(ratioY - 1 / zoom)).toBeLessThan(1e-6)
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 5: Pan translates coordinates uniformly', () => {
        it('should translate all points by the same amount', () => {
            fc.assert(
                fc.property(
                    pointArbitrary,
                    pointArbitrary,
                    fc.record({
                        x: fc.double({ min: -1000, max: 1000, noNaN: true }),
                        y: fc.double({ min: -1000, max: 1000, noNaN: true }),
                    }),
                    canvasSizeArbitrary,
                    (point1, point2, pan, canvasSize) => {
                        const transform: Transform = { zoom: 1, pan }

                        // Transform both points
                        const image1 = canvasToImage(point1, transform, canvasSize)
                        const image2 = canvasToImage(point2, transform, canvasSize)

                        // Calculate the difference between transformed points
                        const transformedDiffX = image1.x - image2.x
                        const transformedDiffY = image1.y - image2.y

                        // Calculate the difference between original points
                        const originalDiffX = point1.x - point2.x
                        const originalDiffY = point1.y - point2.y

                        // The differences should be the same (pan doesn't change relative positions)
                        const epsilon = 1e-10
                        expect(Math.abs(transformedDiffX - originalDiffX)).toBeLessThan(epsilon)
                        expect(Math.abs(transformedDiffY - originalDiffY)).toBeLessThan(epsilon)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 6: Center point is invariant under pan (zoom=1)', () => {
        it('should keep center point at center when only panning with zoom=1', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        x: fc.double({ min: -1000, max: 1000, noNaN: true }),
                        y: fc.double({ min: -1000, max: 1000, noNaN: true }),
                    }),
                    canvasSizeArbitrary,
                    (pan, canvasSize) => {
                        const transform: Transform = { zoom: 1, pan }
                        const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 }

                        // Transform center point
                        const imageCenter = canvasToImage(center, transform, canvasSize)

                        // Center should be offset by pan amount
                        const epsilon = 1e-10
                        expect(Math.abs(imageCenter.x - (center.x - pan.x))).toBeLessThan(epsilon)
                        expect(Math.abs(imageCenter.y - (center.y - pan.y))).toBeLessThan(epsilon)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 7: Transformation is linear (superposition)', () => {
        it('should satisfy linearity: transform(a*p1 + b*p2) = a*transform(p1) + b*transform(p2) for zoom-only', () => {
            fc.assert(
                fc.property(
                    pointArbitrary,
                    pointArbitrary,
                    fc.double({ min: -10, max: 10, noNaN: true }),
                    fc.double({ min: -10, max: 10, noNaN: true }),
                    fc.double({ min: 0.1, max: 10, noNaN: true }),
                    canvasSizeArbitrary,
                    (p1, p2, a, b, zoom, canvasSize) => {
                        // For zoom-only transformation (no pan), it should be linear
                        const transform: Transform = { zoom, pan: { x: 0, y: 0 } }
                        const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 }

                        // Calculate a*p1 + b*p2 (relative to center)
                        const combinedX = center.x + a * (p1.x - center.x) + b * (p2.x - center.x)
                        const combinedY = center.y + a * (p1.y - center.y) + b * (p2.y - center.y)
                        const combined = { x: combinedX, y: combinedY }

                        // Transform the combined point
                        const transformedCombined = canvasToImage(combined, transform, canvasSize)

                        // Transform individual points and combine
                        const t1 = canvasToImage(p1, transform, canvasSize)
                        const t2 = canvasToImage(p2, transform, canvasSize)
                        const combinedTransformed = {
                            x: center.x + a * (t1.x - center.x) + b * (t2.x - center.x),
                            y: center.y + a * (t1.y - center.y) + b * (t2.y - center.y),
                        }

                        // Should be equal (within floating point tolerance)
                        const epsilon = 1e-6
                        expect(Math.abs(transformedCombined.x - combinedTransformed.x)).toBeLessThan(epsilon)
                        expect(Math.abs(transformedCombined.y - combinedTransformed.y)).toBeLessThan(epsilon)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
