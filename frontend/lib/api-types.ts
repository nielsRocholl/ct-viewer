// API Type Definitions

export interface VolumeMetadata {
    volume_id: string
    file_name: string
    dimensions: [number, number, number]
    spacing: [number, number, number]
    origin: [number, number, number]
    direction: number[]
    pixel_type: string
    number_of_components: number
    size_bytes: number
    loaded_at: string
}

export interface CreatePairRequest {
    ct_volume_id: string
    seg_volume_id?: string
    auto_resample?: boolean
}

export interface CreatePairResponse {
    pair_id: string
    compatible: boolean
    resampled: boolean
    ct_metadata: VolumeMetadata
    seg_metadata?: VolumeMetadata
}

export interface PairMetadata {
    pair_id: string
    ct_metadata: VolumeMetadata
    seg_metadata?: VolumeMetadata
    seg_metadatas?: VolumeMetadata[]
    seg_stats?: SegmentationStats[]
}

export interface AddSegmentRequest {
    seg_volume_id: string
    auto_resample?: boolean
}

export interface IndexToPhysicalRequest {
    slice_index: number
    orientation: 'axial' | 'sagittal' | 'coronal'
}

export interface IndexToPhysicalResponse {
    physical_position: number
}

export interface PhysicalToIndexRequest {
    physical_position: number
    orientation: 'axial' | 'sagittal' | 'coronal'
}

export interface PhysicalToIndexResponse {
    slice_index: number
}

export interface CTSliceParams {
    volume_id: string
    slice_index: number
    orientation?: 'axial' | 'sagittal' | 'coronal'
    window_level?: number
    window_width?: number
    format?: 'png'
}

export interface SegmentationSliceParams {
    volume_id: string
    slice_index: number
    orientation?: 'axial' | 'sagittal' | 'coronal'
    mode?: 'filled' | 'boundary'
    format?: 'png'
}

export interface WindowFromRoiParams {
    volume_id: string
    slice_index: number
    orientation?: 'axial' | 'sagittal' | 'coronal'
    center_x: number
    center_y: number
    radius_mm?: number
}

export interface WindowFromRoiResponse {
    level: number
    width: number
}

export interface RegisterDatasetRequest {
    images_dir: string
    labels_dir?: string
    preds_dir?: string
    segmentations?: SegmentationDir[]
}

export interface RegisterDatasetResponse {
    dataset_id: string
    case_count: number
    case_ids: string[]
}

export interface OpenCaseRequest {
    case_index?: number
    case_id?: string
}

export interface OpenCaseResponse {
    case_id: string
    case_index: number
    image_volume_id: string
    image_metadata: VolumeMetadata
    label_volume_id: string | null
    label_metadata: VolumeMetadata | null
    label_all_background?: boolean | null
    pred_volume_id: string | null
    pred_metadata: VolumeMetadata | null
    seg_volume_ids?: SegmentationVolumeInfo[]
    warnings?: string[]
}

export interface SegmentationDir {
    path: string
    role?: 'gt' | 'pred'
    name?: string
}

export interface SegmentationVolumeInfo {
    volume_id: string
    role?: 'gt' | 'pred'
    name?: string
    all_background?: boolean | null
    component_count?: number | null
    multi_label?: boolean | null
    nonzero_label_count?: number | null
    label_values?: number[] | null
}

export interface SegmentationStats {
    all_background: boolean
    component_count: number
    multi_label: boolean
    nonzero_label_count: number
    label_values?: number[] | null
}

export interface GetCasesResponse {
    case_count: number
    case_ids: string[]
}

export interface GlobalIntensityStats {
    minimum: number
    maximum: number
    mean: number
    sigma: number
}

export interface PerLabelStatistics {
    label: number
    voxel_count: number
    volume_mm3: number
    ct_mean: number
    ct_sigma: number
    ct_min: number
    ct_max: number
}

export interface CaseStatisticsRequest {
    case_index: number
    seg_index?: number
    include_global_ct_intensity?: boolean
    include_lesion_connected_components?: boolean
    include_label_segmentation_stats?: boolean
    include_per_label_ct_intensity?: boolean
    include_file_metadata?: boolean
}

export interface CaseStatisticsResponse {
    case_id: string
    skipped: boolean
    warning?: string | null
    geometry_match: boolean
    ct: VolumeMetadata
    seg: VolumeMetadata
    volumes_mm3: number[]
    max_component_mm3?: number | null
    global_intensity?: GlobalIntensityStats | null
    label_values: number[]
    multi_label: boolean
    per_label: PerLabelStatistics[]
    ct_file_meta: Record<string, string>
    seg_file_meta: Record<string, string>
}

export interface DiceResponse {
    dice: number
}

export interface FirstSliceWithMaskResponse {
    slice_index: number
}

export interface DatasetDecisionRequest {
    case_id: string
    decision: 'accept' | 'reject'
}

export interface DatasetDecisionResponse {
    next_case_id: string | null
    next_case_index: number | null
    case_count: number
    stats: {
        accepted: number
        rejected: number
        remaining: number
    }
}
