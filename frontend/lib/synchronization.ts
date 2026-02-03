import { indexToPhysical, physicalToIndex } from './api-client'
import type { VolumeMetadata } from './api-types'

export const AXIS_MAP = { axial: 2, sagittal: 0, coronal: 1 } as const

export function physicalToIndexFromMetadata(
    physicalPosition: number,
    metadata: VolumeMetadata,
    orientation: 'axial' | 'sagittal' | 'coronal' = 'axial'
): number {
    const axis = AXIS_MAP[orientation]
    const sliceIndex = Math.round((physicalPosition - metadata.origin[axis]) / metadata.spacing[axis])
    const maxIndex = metadata.dimensions[axis] - 1
    return Math.max(0, Math.min(sliceIndex, maxIndex))
}

export async function convertIndexToPhysical(
    pairId: string,
    sliceIndex: number,
    orientation: 'axial' | 'sagittal' | 'coronal' = 'axial'
): Promise<number> {
    return (await indexToPhysical(pairId, { slice_index: sliceIndex, orientation })).physical_position
}

export async function convertPhysicalToIndex(
    pairId: string,
    physicalPosition: number,
    orientation: 'axial' | 'sagittal' | 'coronal' = 'axial'
): Promise<number> {
    return (await physicalToIndex(pairId, { physical_position: physicalPosition, orientation })).slice_index
}

export async function synchronizeAllPairs(
    pairIds: string[],
    physicalPosition: number,
    orientation: 'axial' | 'sagittal' | 'coronal' = 'axial'
): Promise<Map<string, number>> {
    const sliceIndices = new Map<string, number>()

    await Promise.all(
        pairIds.map(async (pairId) => {
            try {
                const sliceIndex = await convertPhysicalToIndex(
                    pairId,
                    physicalPosition,
                    orientation
                )
                sliceIndices.set(pairId, sliceIndex)
            } catch (error) {
                console.error(`Failed to synchronize pair ${pairId}:`, error)
                // Skip this pair if conversion fails
            }
        })
    )

    return sliceIndices
}

export async function getPhysicalPositionForPair(
    pairId: string,
    sliceIndex: number,
    orientation: 'axial' | 'sagittal' | 'coronal' = 'axial'
): Promise<number> {
    return convertIndexToPhysical(pairId, sliceIndex, orientation)
}
