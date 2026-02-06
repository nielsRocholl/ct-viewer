// TanStack Query Hooks for API

import { useMutation, useQuery, useQueryClient, useQueries } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
    uploadVolume,
    getVolumeMetadata,
    deleteVolume,
    createPair,
    getPairMetadata,
    deletePair,
    addSegmentToPair,
    fetchCTSlice,
    fetchSegmentationSlice,
    indexToPhysical,
    physicalToIndex,
} from './api-client'
import {
    VolumeMetadata,
    CreatePairRequest,
    CreatePairResponse,
    PairMetadata,
    AddSegmentRequest,
    IndexToPhysicalRequest,
    IndexToPhysicalResponse,
    PhysicalToIndexRequest,
    PhysicalToIndexResponse,
    CTSliceParams,
    SegmentationSliceParams,
} from './api-types'

// Query Keys
export const queryKeys = {
    volumes: ['volumes'] as const,
    volume: (id: string) => ['volumes', id] as const,
    pairs: ['pairs'] as const,
    pair: (id: string) => ['pairs', id] as const,
    ctSlice: (params: CTSliceParams) => ['ct-slice', params] as const,
    segSlice: (params: SegmentationSliceParams) => ['seg-slice', params] as const,
}

// Volume Hooks

export function useUploadVolume() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: (file: File) => uploadVolume(file),
        onSuccess: (data) => {
            // Invalidate volumes list and cache the new volume metadata
            queryClient.invalidateQueries({ queryKey: queryKeys.volumes })
            queryClient.setQueryData(queryKeys.volume(data.volume_id), data)
        },
    })
}

export function useVolumeMetadata(volumeId: string | null) {
    return useQuery({
        queryKey: volumeId ? queryKeys.volume(volumeId) : ['volumes', 'null'],
        queryFn: () => {
            if (!volumeId) throw new Error('Volume ID is required')
            return getVolumeMetadata(volumeId)
        },
        enabled: !!volumeId,
    })
}

export function useDeleteVolume() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: (volumeId: string) => deleteVolume(volumeId),
        onSuccess: (_, volumeId) => {
            // Remove from cache and invalidate volumes list
            queryClient.removeQueries({ queryKey: queryKeys.volume(volumeId) })
            queryClient.invalidateQueries({ queryKey: queryKeys.volumes })
            toast.success('Volume deleted', {
                description: 'Volume removed from cache',
            })
        },
        onError: (error: Error) => {
            toast.error('Failed to delete volume', {
                description: error.message,
            })
        },
    })
}

// Pair Hooks

export function useCreatePair() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: (request: CreatePairRequest) => createPair(request),
        onSuccess: (data) => {
            // Invalidate pairs list and cache the new pair metadata
            queryClient.invalidateQueries({ queryKey: queryKeys.pairs })
            queryClient.setQueryData(queryKeys.pair(data.pair_id), {
                pair_id: data.pair_id,
                ct_metadata: data.ct_metadata,
                seg_metadata: data.seg_metadata,
            })
        },
    })
}

export function usePairMetadata(pairId: string | null) {
    return useQuery({
        queryKey: pairId ? queryKeys.pair(pairId) : ['pairs', 'null'],
        queryFn: () => {
            if (!pairId) throw new Error('Pair ID is required')
            return getPairMetadata(pairId)
        },
        enabled: !!pairId,
    })
}

export function useDeletePair() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: (pairId: string) => deletePair(pairId),
        onSuccess: (_, pairId) => {
            queryClient.removeQueries({ queryKey: queryKeys.pair(pairId) })
            queryClient.invalidateQueries({ queryKey: queryKeys.pairs })
            toast.success('Pair deleted', {
                description: 'Pair removed successfully',
            })
        },
        onError: (error: Error) => {
            toast.error('Failed to delete pair', {
                description: error.message,
            })
        },
    })
}

export function useAddSegmentToPair() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: ({ pairId, request }: { pairId: string; request: AddSegmentRequest }) =>
            addSegmentToPair(pairId, request),
        onSuccess: (data) => {
            queryClient.setQueryData(queryKeys.pair(data.pair_id), data)
            queryClient.invalidateQueries({ queryKey: queryKeys.pairs })
        },
        onError: (error: Error) => {
            toast.error('Failed to add mask', { description: error.message })
        },
    })
}

// Slice Hooks

export function useCTSlice(params: CTSliceParams | null) {
    return useQuery({
        queryKey: params ? queryKeys.ctSlice(params) : ['ct-slice', 'null'],
        queryFn: () => {
            if (!params) throw new Error('CT slice parameters are required')
            return fetchCTSlice(params)
        },
        enabled: !!params,
        staleTime: 5 * 60 * 1000, // 5 minutes - slices don't change
        gcTime: 10 * 60 * 1000, // 10 minutes - keep in cache longer
        retry: 2,
        retryDelay: 1000,
        placeholderData: (previousData) => previousData,
    })
}

export function useSegmentationSlice(params: SegmentationSliceParams | null) {
    return useQuery({
        queryKey: params ? queryKeys.segSlice(params) : ['seg-slice', 'null'],
        queryFn: () => {
            if (!params) throw new Error('Segmentation slice parameters are required')
            return fetchSegmentationSlice(params)
        },
        enabled: !!params,
        staleTime: 5 * 60 * 1000, // 5 minutes - slices don't change
        gcTime: 10 * 60 * 1000, // 10 minutes - keep in cache longer
        retry: 2,
        retryDelay: 1000,
    })
}

export function useSegmentationSlices(paramsList: (SegmentationSliceParams | null)[]) {
    return useQueries({
        queries: paramsList.map((params, idx) =>
            params
                ? {
                    queryKey: queryKeys.segSlice(params),
                    queryFn: () => fetchSegmentationSlice(params),
                    enabled: true,
                    staleTime: 5 * 60 * 1000,
                    gcTime: 10 * 60 * 1000,
                    retry: 2,
                    retryDelay: 1000,
                }
                : {
                    queryKey: ['seg-slice', 'null', idx],
                    queryFn: async () => {
                        throw new Error('Segmentation slice parameters are required')
                    },
                    enabled: false,
                }
        ),
    })
}

export function useVolumeMetadatas(volumeIds: (string | null)[]) {
    return useQueries({
        queries: volumeIds.map((id, idx) =>
            id
                ? {
                    queryKey: queryKeys.volume(id),
                    queryFn: () => getVolumeMetadata(id),
                    enabled: true,
                    staleTime: 5 * 60 * 1000,
                    gcTime: 10 * 60 * 1000,
                }
                : {
                    queryKey: ['volume', 'null', idx],
                    queryFn: async () => {
                        throw new Error('Volume ID is required')
                    },
                    enabled: false,
                }
        ),
    })
}

// Synchronization Hooks

export function useIndexToPhysical(pairId: string | null) {
    return useMutation({
        mutationFn: (request: IndexToPhysicalRequest) => {
            if (!pairId) throw new Error('Pair ID is required')
            return indexToPhysical(pairId, request)
        },
    })
}

export function usePhysicalToIndex(pairId: string | null) {
    return useMutation({
        mutationFn: (request: PhysicalToIndexRequest) => {
            if (!pairId) throw new Error('Pair ID is required')
            return physicalToIndex(pairId, request)
        },
    })
}
