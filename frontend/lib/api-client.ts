// API Client Functions

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
    WindowFromRoiParams,
    WindowFromRoiResponse,
    RegisterDatasetRequest,
    RegisterDatasetResponse,
    OpenCaseRequest,
    OpenCaseResponse,
    GetCasesResponse,
    FirstSliceWithMaskResponse,
    DatasetDecisionRequest,
    DatasetDecisionResponse,
} from './api-types'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// Helper function to handle API errors
async function handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
        const errorText = await response.text()
        let errorMessage = `API Error: ${response.status} ${response.statusText}`

        try {
            const errorJson = JSON.parse(errorText)
            errorMessage = errorJson.detail || errorJson.error || errorMessage
        } catch {
            // If not JSON, use the text as is
            if (errorText) {
                errorMessage = errorText
            }
        }

        throw new Error(errorMessage)
    }

    return response.json()
}

// Volume Management

export async function uploadVolume(file: File): Promise<VolumeMetadata> {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${API_BASE_URL}/api/volumes/upload`, {
        method: 'POST',
        body: formData,
    })

    return handleResponse<VolumeMetadata>(response)
}

export async function getVolumeMetadata(volumeId: string): Promise<VolumeMetadata> {
    const response = await fetch(`${API_BASE_URL}/api/volumes/${volumeId}/metadata`)
    return handleResponse<VolumeMetadata>(response)
}

export async function deleteVolume(volumeId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/volumes/${volumeId}`, {
        method: 'DELETE',
    })

    if (!response.ok) {
        throw new Error(`Failed to delete volume: ${response.statusText}`)
    }
}

// Pair Management

export async function createPair(request: CreatePairRequest): Promise<CreatePairResponse> {
    const response = await fetch(`${API_BASE_URL}/api/pairs`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
    })

    return handleResponse<CreatePairResponse>(response)
}

export async function getPairMetadata(pairId: string): Promise<PairMetadata> {
    const response = await fetch(`${API_BASE_URL}/api/pairs/${pairId}`)
    return handleResponse<PairMetadata>(response)
}

export async function deletePair(pairId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/pairs/${pairId}`, {
        method: 'DELETE',
    })

    if (!response.ok) {
        throw new Error(`Failed to delete pair: ${response.statusText}`)
    }
}

export async function addSegmentToPair(
    pairId: string,
    request: AddSegmentRequest
): Promise<PairMetadata> {
    const response = await fetch(`${API_BASE_URL}/api/pairs/${pairId}/segments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    })
    return handleResponse<PairMetadata>(response)
}

// Slice Extraction

export async function fetchCTSlice(params: CTSliceParams): Promise<string> {
    const searchParams = new URLSearchParams({
        slice_index: params.slice_index.toString(),
    })

    if (params.orientation) {
        searchParams.append('orientation', params.orientation)
    }
    if (params.window_level !== undefined) {
        searchParams.append('window_level', params.window_level.toString())
    }
    if (params.window_width !== undefined) {
        searchParams.append('window_width', params.window_width.toString())
    }
    if (params.format) {
        searchParams.append('format', params.format)
    }

    const response = await fetch(
        `${API_BASE_URL}/api/slices/ct/${params.volume_id}?${searchParams}`
    )

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to fetch CT slice: ${errorText}`)
    }

    const blob = await response.blob()
    return URL.createObjectURL(blob)
}

export async function fetchSegmentationSlice(params: SegmentationSliceParams): Promise<string> {
    const searchParams = new URLSearchParams({
        slice_index: params.slice_index.toString(),
    })

    if (params.orientation) {
        searchParams.append('orientation', params.orientation)
    }
    if (params.mode) {
        searchParams.append('mode', params.mode)
    }
    if (params.format) {
        searchParams.append('format', params.format)
    }

    const response = await fetch(
        `${API_BASE_URL}/api/slices/segmentation/${params.volume_id}?${searchParams}`
    )

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to fetch segmentation slice: ${errorText}`)
    }

    // Return blob URL for image
    const blob = await response.blob()
    return URL.createObjectURL(blob)
}

export async function fetchWindowFromRoi(
    params: WindowFromRoiParams
): Promise<WindowFromRoiResponse> {
    const searchParams = new URLSearchParams({
        slice_index: params.slice_index.toString(),
        center_x: params.center_x.toString(),
        center_y: params.center_y.toString(),
    })
    if (params.orientation) {
        searchParams.append('orientation', params.orientation)
    }
    if (params.radius_mm !== undefined) {
        searchParams.append('radius_mm', params.radius_mm.toString())
    }
    const response = await fetch(
        `${API_BASE_URL}/api/slices/ct/${params.volume_id}/window-from-roi?${searchParams}`
    )
    return handleResponse<WindowFromRoiResponse>(response)
}

// Synchronization Helpers

export async function indexToPhysical(
    pairId: string,
    request: IndexToPhysicalRequest
): Promise<IndexToPhysicalResponse> {
    const response = await fetch(`${API_BASE_URL}/api/pairs/${pairId}/index-to-physical`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
    })

    return handleResponse<IndexToPhysicalResponse>(response)
}

export async function physicalToIndex(
    pairId: string,
    request: PhysicalToIndexRequest
): Promise<PhysicalToIndexResponse> {
    const response = await fetch(`${API_BASE_URL}/api/pairs/${pairId}/physical-to-index`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
    })

    return handleResponse<PhysicalToIndexResponse>(response)
}

// Dataset Inspection

export async function registerDataset(
    request: RegisterDatasetRequest
): Promise<RegisterDatasetResponse> {
    const response = await fetch(`${API_BASE_URL}/api/datasets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    })
    return handleResponse<RegisterDatasetResponse>(response)
}

export async function getDatasetCases(datasetId: string): Promise<GetCasesResponse> {
    const response = await fetch(`${API_BASE_URL}/api/datasets/${datasetId}/cases`)
    return handleResponse<GetCasesResponse>(response)
}

export async function openDatasetCase(
    datasetId: string,
    request: OpenCaseRequest
): Promise<OpenCaseResponse> {
    const response = await fetch(`${API_BASE_URL}/api/datasets/${datasetId}/open-case`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    })
    return handleResponse<OpenCaseResponse>(response)
}

export async function submitDatasetDecision(
    datasetId: string,
    request: DatasetDecisionRequest
): Promise<DatasetDecisionResponse> {
    const response = await fetch(`${API_BASE_URL}/api/datasets/${datasetId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    })
    return handleResponse<DatasetDecisionResponse>(response)
}

export async function fetchFirstSliceWithMask(
    volumeId: string,
    orientation: 'axial' | 'sagittal' | 'coronal' = 'axial',
    middle = false
): Promise<FirstSliceWithMaskResponse> {
    const searchParams = new URLSearchParams({ orientation })
    if (middle) searchParams.set('middle', 'true')
    const response = await fetch(
        `${API_BASE_URL}/api/slices/segmentation/${volumeId}/first-slice-index?${searchParams}`
    )
    return handleResponse<FirstSliceWithMaskResponse>(response)
}
