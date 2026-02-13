import type { VolumeMetadata } from '@/lib/api-types'

export type HealthStatus = 'green' | 'orange' | 'red'

export interface HealthDetail {
    label: string
    status: HealthStatus
    message: string
}

function tupleDiff(a: number[], b: number[]): number {
    if (a.length !== b.length) return Number.POSITIVE_INFINITY
    let max = 0
    for (let i = 0; i < a.length; i += 1) {
        const d = Math.abs(a[i] - b[i])
        if (d > max) max = d
    }
    return max
}

function geometryCompatible(ct: VolumeMetadata, seg: VolumeMetadata, tol = 1e-3): boolean {
    if (ct.dimensions.join(',') !== seg.dimensions.join(',')) return false
    if (tupleDiff(ct.spacing, seg.spacing) > tol) return false
    if (tupleDiff(ct.origin, seg.origin) > tol) return false
    if (tupleDiff(ct.direction, seg.direction) > tol) return false
    return true
}

function directionOrthoWarning(direction: number[], tol = 1e-2): boolean {
    if (direction.length !== 9) return true
    const a = direction
    const r0 = [a[0], a[1], a[2]]
    const r1 = [a[3], a[4], a[5]]
    const r2 = [a[6], a[7], a[8]]
    const dot01 = r0[0] * r1[0] + r0[1] * r1[1] + r0[2] * r1[2]
    const dot02 = r0[0] * r2[0] + r0[1] * r2[1] + r0[2] * r2[2]
    const dot12 = r1[0] * r2[0] + r1[1] * r2[1] + r1[2] * r2[2]
    const n0 = Math.hypot(r0[0], r0[1], r0[2])
    const n1 = Math.hypot(r1[0], r1[1], r1[2])
    const n2 = Math.hypot(r2[0], r2[1], r2[2])
    if (Math.abs(n0 - 1) > tol || Math.abs(n1 - 1) > tol || Math.abs(n2 - 1) > tol) return true
    if (Math.abs(dot01) > tol || Math.abs(dot02) > tol || Math.abs(dot12) > tol) return true
    return false
}

export function computePairHealth(
    ctMetadata: VolumeMetadata | undefined,
    segMetas: VolumeMetadata[] | undefined,
    ctSliceError: Error | null,
    segErrors: (Error | null)[],
    maskEmptyKnown?: boolean
): { status: HealthStatus; details: HealthDetail[] } {
    const details: HealthDetail[] = []

    if (ctSliceError) {
        details.push({
            label: 'CT slice',
            status: 'red',
            message: `CT slice error: ${ctSliceError.message}`,
        })
    } else {
        details.push({
            label: 'CT slice',
            status: ctMetadata ? 'green' : 'red',
            message: ctMetadata ? 'CT slice accessible' : 'CT slice unavailable',
        })
    }

    if (ctMetadata) {
        const dimsValid = ctMetadata.dimensions.every((v) => v > 0)
        details.push({
            label: 'CT dimensions',
            status: dimsValid ? 'green' : 'red',
            message: dimsValid ? 'Dimensions are valid' : 'Invalid dimensions',
        })

        const spacingValid = ctMetadata.spacing.every((v) => v > 0)
        details.push({
            label: 'CT spacing',
            status: spacingValid ? 'green' : 'red',
            message: spacingValid ? 'Spacing is valid' : 'Invalid spacing values',
        })

        const spacing = ctMetadata.spacing
        const minSpacing = Math.min(...spacing)
        const maxSpacing = Math.max(...spacing)
        const ratio = minSpacing > 0 ? maxSpacing / minSpacing : Number.POSITIVE_INFINITY
        if (ratio > 3) {
            details.push({
                label: 'CT anisotropy',
                status: 'orange',
                message: `Anisotropic spacing (ratio ${ratio.toFixed(2)})`,
            })
        } else {
            details.push({
                label: 'CT anisotropy',
                status: 'green',
                message: 'Spacing is roughly isotropic',
            })
        }

        const dirWarn = directionOrthoWarning(ctMetadata.direction)
        details.push({
            label: 'CT orientation',
            status: dirWarn ? 'orange' : 'green',
            message: dirWarn ? 'Direction not orthonormal' : 'Direction is orthonormal',
        })
    }

    const metas = segMetas ?? []
    for (let i = 0; i < Math.max(metas.length, segErrors.length); i += 1) {
        const meta = metas[i]
        const err = segErrors[i] ?? null
        if (err || !meta || !ctMetadata) {
            details.push({
                label: `Mask ${i + 1}`,
                status: 'red',
                message: err ? `Mask error: ${err.message}` : 'Mask metadata missing',
            })
            continue
        }
        if (!geometryCompatible(ctMetadata, meta)) {
            details.push({
                label: `Mask ${i + 1}`,
                status: 'red',
                message: 'Geometry mismatch',
            })
            continue
        }
        details.push({
            label: `Mask ${i + 1}`,
            status: 'green',
            message: 'Loaded and compatible',
        })
    }

    if (maskEmptyKnown === true) {
        details.push({
            label: 'Mask content',
            status: 'orange',
            message: 'Label is all background',
        })
    }

    let status: HealthStatus = 'green'
    if (details.some((d) => d.status === 'red')) status = 'red'
    else if (details.some((d) => d.status === 'orange')) status = 'orange'

    return { status, details }
}
