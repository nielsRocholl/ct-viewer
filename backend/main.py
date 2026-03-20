from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, Dict
import asyncio
import logging
import os
import sys
import tempfile
import uuid
import time
import traceback
from datetime import datetime

from services.volume_loader import VolumeLoaderService, VolumeLoadError, VolumeMetadata
from services.geometry_validator import GeometryValidatorService, GeometryMismatchError
from services.slice_extractor import SliceExtractorService, SliceExtractionError
from services.resampler import ResamplerService, ResamplingError
from services.cache_manager import CacheManager
from services.dataset_service import scan_dataset
from services.dataset_case_statistics import compute_case_statistics

# Configure comprehensive logging
_log_path = os.environ.get('MANGOCT_LOG_PATH', 'backend.log')
_handlers = [logging.StreamHandler(sys.stdout)]
if _log_path:
    try:
        _handlers.append(logging.FileHandler(_log_path, mode='a'))
    except OSError:
        pass
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s',
    handlers=_handlers,
)

logger = logging.getLogger(__name__)

app = FastAPI(
    title="CT Segmentation Viewer API",
    description="Backend API for CT volume and segmentation mask viewing",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "null"],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize services
volume_loader = VolumeLoaderService()
geometry_validator = GeometryValidatorService()
slice_extractor = SliceExtractorService()
resampler = ResamplerService()
cache_manager = CacheManager(max_memory_mb=int(os.getenv("MAX_CACHE_SIZE_MB", "4096")))
# LRU PNG slice cache (same CacheManager budget as configured max MB).
_SLICE_CACHE_ENABLED = os.getenv("SLICE_PNG_CACHE", "1").lower() in ("1", "true", "yes")
_SLICE_HTTP_CACHE = {"Cache-Control": "private, max-age=86400"}

# Configuration
MAX_FILE_SIZE_MB = int(os.getenv("MAX_FILE_SIZE_MB", "2048"))  # 2GB default
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

# In-memory storage for pairs
pairs_storage: Dict[str, dict] = {}

# In-memory storage for datasets: dataset_id -> { case_ids, cases, last_opened_volume_ids }
datasets_storage: Dict[str, dict] = {}

VALID_ORIENTATIONS = ("axial", "sagittal", "coronal")
AXIS_MAP = {"axial": 2, "sagittal": 0, "coronal": 1}


def _ct_slice_cache_key(
    volume_id: str, slice_index: int, orientation: str, window_level: float, window_width: float
) -> str:
    return f"slice:ct:{volume_id}:{orientation}:{slice_index}:{window_level:.6g}:{window_width:.6g}"


def _seg_slice_cache_key(volume_id: str, slice_index: int, orientation: str, mode: str) -> str:
    return f"slice:seg:{volume_id}:{orientation}:{slice_index}:{mode}"


def unload_volume_cascade(volume_id: str) -> None:
    if _SLICE_CACHE_ENABLED:
        n = cache_manager.evict_prefix(f"slice:ct:{volume_id}:")
        n += cache_manager.evict_prefix(f"slice:seg:{volume_id}:")
        if n:
            logger.debug("Evicted %d cached PNG slice(s) for volume %s", n, volume_id)
    volume_loader.unload_volume(volume_id)


def _err(status_code: int, error: str, message: str, detail: str | None = None) -> JSONResponse:
    body = {"error": error, "message": message}
    if detail is not None:
        body["detail"] = detail
    return JSONResponse(status_code=status_code, content=body)


def _check_orientation(orientation: str) -> None:
    if orientation not in VALID_ORIENTATIONS:
        raise HTTPException(status_code=400, detail=f"Invalid orientation: {orientation}. Must be axial, sagittal, or coronal")


def _check_seg_mode(mode: str) -> None:
    if mode not in ("filled", "boundary"):
        raise HTTPException(status_code=400, detail=f"Invalid mode: {mode}. Must be filled or boundary")


def _get_pair_axis_metadata(pair_id: str, orientation: str):
    """Return (metadata, axis) for pair's CT volume. Raises HTTPException if pair or orientation invalid."""
    if pair_id not in pairs_storage:
        raise HTTPException(status_code=404, detail=f"Pair not found: {pair_id}")
    if orientation not in AXIS_MAP:
        raise HTTPException(status_code=400, detail=f"Invalid orientation: {orientation}")
    pair = pairs_storage[pair_id]
    metadata = volume_loader.get_metadata(pair["ct_volume_id"])
    return metadata, AXIS_MAP[orientation]


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception in {request.method} {request.url.path}: {exc}", exc_info=True)
    return _err(500, "Internal server error", "An unexpected error occurred.", str(exc) if os.getenv("DEBUG", "false").lower() == "true" else None)


@app.exception_handler(VolumeLoadError)
async def volume_load_error_handler(request: Request, exc: VolumeLoadError):
    logger.warning(f"Volume load error in {request.url.path}: {exc}")
    return _err(400, "Volume load error", str(exc))


@app.exception_handler(SliceExtractionError)
async def slice_extraction_error_handler(request: Request, exc: SliceExtractionError):
    logger.warning(f"Slice extraction error in {request.url.path}: {exc}")
    return _err(400, "Slice extraction error", str(exc))


@app.exception_handler(GeometryMismatchError)
async def geometry_mismatch_error_handler(request: Request, exc: GeometryMismatchError):
    logger.warning(f"Geometry mismatch error in {request.url.path}: {exc}")
    return _err(400, "Geometry mismatch", str(exc))


@app.exception_handler(ResamplingError)
async def resampling_error_handler(request: Request, exc: ResamplingError):
    logger.error(f"Resampling error in {request.url.path}: {exc}", exc_info=True)
    return _err(500, "Resampling error", str(exc))


# Pydantic models for request/response
class VolumeMetadataResponse(BaseModel):
    volume_id: str
    file_name: str
    dimensions: tuple[int, int, int]
    spacing: tuple[float, float, float]
    origin: tuple[float, float, float]
    direction: tuple[float, ...]
    pixel_type: str
    number_of_components: int
    size_bytes: int
    loaded_at: datetime


class CreatePairRequest(BaseModel):
    ct_volume_id: str
    seg_volume_id: Optional[str] = None
    auto_resample: bool = False


class CreatePairResponse(BaseModel):
    pair_id: str
    compatible: bool
    resampled: bool
    ct_metadata: VolumeMetadataResponse
    seg_metadata: Optional[VolumeMetadataResponse] = None


class SegmentationStats(BaseModel):
    all_background: bool
    component_count: int
    multi_label: bool
    nonzero_label_count: int
    label_values: Optional[list[int]] = None


class PairMetadataResponse(BaseModel):
    pair_id: str
    ct_metadata: VolumeMetadataResponse
    seg_metadata: Optional[VolumeMetadataResponse] = None
    seg_metadatas: list[VolumeMetadataResponse]
    seg_stats: list[SegmentationStats] = []


class AddSegmentRequest(BaseModel):
    seg_volume_id: str
    auto_resample: bool = False


class PhysicalToIndexRequest(BaseModel):
    physical_position: float
    orientation: str = "axial"


class PhysicalToIndexResponse(BaseModel):
    slice_index: int


class IndexToPhysicalRequest(BaseModel):
    slice_index: int
    orientation: str = "axial"


class IndexToPhysicalResponse(BaseModel):
    physical_position: float


class SegmentationDir(BaseModel):
    path: str
    role: Optional[str] = None  # "gt" | "pred"
    name: Optional[str] = None


class RegisterDatasetRequest(BaseModel):
    images_dir: str
    labels_dir: Optional[str] = None
    preds_dir: Optional[str] = None
    segmentations: Optional[list[SegmentationDir]] = None


class RegisterDatasetResponse(BaseModel):
    dataset_id: str
    case_count: int
    case_ids: list[str]


class OpenCaseRequest(BaseModel):
    case_index: Optional[int] = None
    case_id: Optional[str] = None


class SegmentationVolumeInfo(BaseModel):
    volume_id: str
    role: Optional[str] = None
    name: Optional[str] = None
    all_background: Optional[bool] = None
    component_count: Optional[int] = None
    multi_label: Optional[bool] = None
    nonzero_label_count: Optional[int] = None
    label_values: Optional[list[int]] = None


class OpenCaseResponse(BaseModel):
    case_id: str
    case_index: int
    image_volume_id: str
    image_metadata: VolumeMetadataResponse
    label_volume_id: Optional[str] = None
    label_metadata: Optional[VolumeMetadataResponse] = None
    label_all_background: Optional[bool] = None  # True if label volume has no foreground voxels
    pred_volume_id: Optional[str] = None
    pred_metadata: Optional[VolumeMetadataResponse] = None
    seg_volume_ids: list[SegmentationVolumeInfo] = []
    warnings: list[str] = []


class GetCasesResponse(BaseModel):
    case_count: int
    case_ids: list[str]


class GlobalIntensityStats(BaseModel):
    minimum: float
    maximum: float
    mean: float
    sigma: float


class PerLabelStatistics(BaseModel):
    label: int
    voxel_count: int
    volume_mm3: float
    ct_mean: float
    ct_sigma: float
    ct_min: float
    ct_max: float


class CaseStatisticsRequest(BaseModel):
    case_index: int
    seg_index: int = 0
    include_global_ct_intensity: bool = True
    include_lesion_connected_components: bool = True
    include_label_segmentation_stats: bool = True
    include_per_label_ct_intensity: bool = True
    include_file_metadata: bool = True


class CaseStatisticsResponse(BaseModel):
    case_id: str
    skipped: bool
    warning: Optional[str] = None
    geometry_match: bool
    ct: VolumeMetadataResponse
    seg: VolumeMetadataResponse
    volumes_mm3: list[float]
    max_component_mm3: Optional[float] = None
    global_intensity: Optional[GlobalIntensityStats] = None
    label_values: list[int]
    multi_label: bool
    per_label: list[PerLabelStatistics]
    ct_file_meta: dict[str, str]
    seg_file_meta: dict[str, str]


class DatasetDecisionRequest(BaseModel):
    case_id: str
    decision: str  # "accept" | "reject"


class DatasetDecisionResponse(BaseModel):
    next_case_id: Optional[str] = None
    next_case_index: Optional[int] = None
    case_count: int
    stats: dict


def metadata_to_response(metadata: VolumeMetadata) -> VolumeMetadataResponse:
    return VolumeMetadataResponse(
        volume_id=metadata.volume_id,
        file_name=metadata.file_name,
        dimensions=metadata.dimensions,
        spacing=metadata.spacing,
        origin=metadata.origin,
        direction=metadata.direction,
        pixel_type=metadata.pixel_type,
        number_of_components=metadata.number_of_components,
        size_bytes=metadata.size_bytes,
        loaded_at=metadata.loaded_at
    )


@app.get("/")
async def root():
    return {"message": "CT Segmentation Viewer API"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


# Volume Management Endpoints

@app.post("/api/volumes/upload", response_model=VolumeMetadataResponse)
async def upload_volume(file: UploadFile = File(...)):
    """Upload CT or segmentation volume (.nii, .nii.gz, .mha, .mhd). Returns metadata and volume ID."""
    start_time = time.time()
    
    try:
        # Validate file size
        file.file.seek(0, 2)  # Seek to end
        file_size = file.file.tell()
        file.file.seek(0)  # Reset to beginning
        
        logger.info(
            f"Volume upload started: {file.filename}, size: {file_size / (1024**2):.2f} MB"
        )
        
        if file_size > MAX_FILE_SIZE_BYTES:
            logger.warning(
                f"File size validation failed: {file_size / (1024**2):.2f} MB exceeds "
                f"limit of {MAX_FILE_SIZE_MB} MB"
            )
            raise HTTPException(
                status_code=413,
                detail=f"File size ({file_size / (1024**2):.2f} MB) exceeds "
                       f"maximum allowed size ({MAX_FILE_SIZE_MB} MB)"
            )
        
        # Determine appropriate suffix for temporary file
        filename = file.filename or "upload"
        if filename.endswith('.nii.gz'):
            suffix = '.nii.gz'
        else:
            suffix = os.path.splitext(filename)[1]
        
        # Save uploaded file to temporary location
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_file:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                tmp_file.write(chunk)
            tmp_path = tmp_file.name
        
        try:
            # Load volume
            load_start = time.time()
            metadata = await volume_loader.load_volume(tmp_path)
            load_time = time.time() - load_start
            
            logger.info(
                f"Volume loaded successfully: {metadata.volume_id}, "
                f"load_time={load_time:.3f}s, "
                f"dimensions={metadata.dimensions}, "
                f"size={metadata.size_bytes / (1024**2):.2f}MB"
            )
            
            cache_stats = cache_manager.get_stats()
            logger.info(
                f"Slice PNG cache after load: "
                f"entries={cache_stats['volume_count']}, "
                f"memory_used={cache_stats['memory_used_mb']:.2f}MB, "
                f"memory_limit={cache_stats['memory_limit_mb']}MB"
            )
            
            total_time = time.time() - start_time
            logger.info(f"Volume upload completed in {total_time:.3f}s")
            
            return metadata_to_response(metadata)
            
        finally:
            # Clean up temporary file
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
                
    except VolumeLoadError as e:
        logger.error(f"Volume load error: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error during upload: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@app.get("/api/volumes/{volume_id}/metadata", response_model=VolumeMetadataResponse)
async def get_volume_metadata(volume_id: str):
    """Retrieve metadata for a loaded volume"""
    try:
        metadata = volume_loader.get_metadata(volume_id)
        return metadata_to_response(metadata)
    except VolumeLoadError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/api/volumes/{volume_id}", status_code=204)
async def delete_volume(volume_id: str):
    """Unload a volume from cache"""
    try:
        unload_volume_cascade(volume_id)
        logger.info(f"Deleted volume: {volume_id}")
        return Response(status_code=204)
    except Exception as e:
        logger.error(f"Error deleting volume {volume_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))



# Pair Management Endpoints

@app.post("/api/pairs", response_model=CreatePairResponse)
async def create_pair(request: CreatePairRequest):
    """Create CT-segmentation pair; optionally CT-only (no seg). Validate geometry when seg present."""
    try:
        logger.info(
            f"Creating pair: ct={request.ct_volume_id}, seg={request.seg_volume_id}, "
            f"auto_resample={request.auto_resample}"
        )
        ct_metadata = volume_loader.get_metadata(request.ct_volume_id)
        resampled = False
        seg_metadata = None

        if request.seg_volume_id:
            seg_metadata = volume_loader.get_metadata(request.seg_volume_id)
            validation_result = geometry_validator.validate_geometry(ct_metadata, seg_metadata)
            if not validation_result.compatible:
                if request.auto_resample:
                    logger.info(f"Geometry mismatch detected, resampling segmentation {request.seg_volume_id}")
                    ct_volume = volume_loader.get_volume(request.ct_volume_id)
                    seg_volume = volume_loader.get_volume(request.seg_volume_id)
                    try:
                        resample_start = time.time()
                        resampled_seg = resampler.resample_segmentation_to_ct(seg_volume, ct_volume)
                        resample_time = time.time() - resample_start
                        volume_loader.replace_volume(request.seg_volume_id, resampled_seg)
                        seg_metadata = volume_loader.get_metadata(request.seg_volume_id)
                        resampled = True
                        logger.info(
                            f"Successfully resampled segmentation {request.seg_volume_id} "
                            f"in {resample_time:.3f}s"
                        )
                    except ResamplingError as e:
                        logger.error(f"Resampling failed: {e}", exc_info=True)
                        raise HTTPException(status_code=500, detail=f"Resampling failed: {str(e)}")
                else:
                    error_message = geometry_validator.format_validation_error(validation_result)
                    logger.warning(f"Pair creation rejected due to geometry mismatch: {error_message}")
                    raise HTTPException(status_code=400, detail=error_message)

        pair_id = str(uuid.uuid4())
        seg_ids = [request.seg_volume_id] if request.seg_volume_id else []
        pairs_storage[pair_id] = {
            "pair_id": pair_id,
            "ct_volume_id": request.ct_volume_id,
            "seg_volume_id": request.seg_volume_id,
            "seg_volume_ids": seg_ids,
            "resampled": resampled,
            "created_at": datetime.now(),
        }
        logger.info(f"Created pair {pair_id}: CT={request.ct_volume_id}, Seg={request.seg_volume_id or 'none'}")
        return CreatePairResponse(
            pair_id=pair_id,
            compatible=True,
            resampled=resampled,
            ct_metadata=metadata_to_response(ct_metadata),
            seg_metadata=metadata_to_response(seg_metadata) if seg_metadata else None,
        )
        
    except VolumeLoadError as e:
        logger.error(f"Volume not found during pair creation: {e}", exc_info=True)
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating pair: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


MAX_SEG_VOLUMES_PER_PAIR = 10


def _pair_seg_volume_ids(pair: dict) -> list:
    ids = pair.get("seg_volume_ids")
    if ids is not None:
        return ids
    sid = pair.get("seg_volume_id")
    return [sid] if sid else []


@app.get("/api/pairs/{pair_id}", response_model=PairMetadataResponse)
async def get_pair_metadata(pair_id: str):
    """Retrieve metadata for a CT-segmentation pair (CT-only pairs have no seg_metadata)."""
    if pair_id not in pairs_storage:
        raise HTTPException(status_code=404, detail=f"Pair not found: {pair_id}")
    try:
        pair = pairs_storage[pair_id]
        ct_metadata = volume_loader.get_metadata(pair["ct_volume_id"])
        seg_ids = _pair_seg_volume_ids(pair)
        seg_metadatas = [metadata_to_response(volume_loader.get_metadata(sid)) for sid in seg_ids]
        first_seg = seg_metadatas[0] if seg_metadatas else None
        seg_stats = [SegmentationStats(**volume_loader.get_label_stats(sid)) for sid in seg_ids]
        return PairMetadataResponse(
            pair_id=pair_id,
            ct_metadata=metadata_to_response(ct_metadata),
            seg_metadata=first_seg,
            seg_metadatas=seg_metadatas,
            seg_stats=seg_stats,
        )
    except VolumeLoadError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/pairs/{pair_id}/segments", response_model=PairMetadataResponse)
async def add_segment_to_pair(pair_id: str, request: AddSegmentRequest):
    """Add a segmentation volume to an existing pair (max 10)."""
    if pair_id not in pairs_storage:
        raise HTTPException(status_code=404, detail=f"Pair not found: {pair_id}")
    pair = pairs_storage[pair_id]
    seg_ids = _pair_seg_volume_ids(pair)
    if len(seg_ids) >= MAX_SEG_VOLUMES_PER_PAIR:
        raise HTTPException(
            status_code=400,
            detail=f"Pair already has {MAX_SEG_VOLUMES_PER_PAIR} segments; maximum is {MAX_SEG_VOLUMES_PER_PAIR}"
        )
    try:
        ct_metadata = volume_loader.get_metadata(pair["ct_volume_id"])
        seg_metadata = volume_loader.get_metadata(request.seg_volume_id)
        validation_result = geometry_validator.validate_geometry(ct_metadata, seg_metadata)
        resampled = False
        if not validation_result.compatible:
            if request.auto_resample:
                ct_volume = volume_loader.get_volume(pair["ct_volume_id"])
                seg_volume = volume_loader.get_volume(request.seg_volume_id)
                resampled_seg = resampler.resample_segmentation_to_ct(seg_volume, ct_volume)
                volume_loader.replace_volume(request.seg_volume_id, resampled_seg)
                seg_metadata = volume_loader.get_metadata(request.seg_volume_id)
                resampled = True
            else:
                error_message = geometry_validator.format_validation_error(validation_result)
                raise HTTPException(status_code=400, detail=error_message)
        seg_ids = list(seg_ids) + [request.seg_volume_id]
        pair["seg_volume_ids"] = seg_ids
        pair["seg_volume_id"] = seg_ids[0]
        seg_metadatas = [metadata_to_response(volume_loader.get_metadata(sid)) for sid in seg_ids]
        seg_stats = [SegmentationStats(**volume_loader.get_label_stats(sid)) for sid in seg_ids]
        return PairMetadataResponse(
            pair_id=pair_id,
            ct_metadata=metadata_to_response(ct_metadata),
            seg_metadata=seg_metadatas[0],
            seg_metadatas=seg_metadatas,
            seg_stats=seg_stats,
        )
    except VolumeLoadError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise


@app.delete("/api/pairs/{pair_id}", status_code=204)
async def delete_pair(pair_id: str):
    """Delete pair (volumes remain in cache)."""
    if pair_id not in pairs_storage:
        raise HTTPException(status_code=404, detail=f"Pair not found: {pair_id}")
    del pairs_storage[pair_id]
    logger.info(f"Deleted pair: {pair_id}")
    return Response(status_code=204)


# Dataset Inspection Endpoints

@app.post("/api/datasets", response_model=RegisterDatasetResponse)
async def register_dataset(request: RegisterDatasetRequest):
    """Register a dataset from server-side folders; scan only, no volume loading."""
    try:
        segmentations: list[dict] = []
        if request.segmentations:
            for seg in request.segmentations:
                role = seg.role.lower().strip() if seg.role else None
                if role and role not in ("gt", "pred"):
                    raise HTTPException(status_code=400, detail="segmentation role must be gt or pred")
                segmentations.append({"path": seg.path, "role": role, "name": seg.name})
        else:
            if request.labels_dir:
                segmentations.append({"path": request.labels_dir, "role": "gt", "name": "Label"})
            if request.preds_dir:
                segmentations.append({"path": request.preds_dir, "role": "pred", "name": "Prediction"})

        case_ids, cases = scan_dataset(
            request.images_dir,
            labels_dir=request.labels_dir,
            preds_dir=request.preds_dir,
            segmentations=segmentations,
        )
        dataset_id = str(uuid.uuid4())
        images_dir = request.images_dir
        labels_dir = request.labels_dir
        preds_dir = request.preds_dir
        rejected_images_dir = f"{images_dir}_rejected"
        rejected_labels_dir = f"{labels_dir}_rejected" if labels_dir else None
        rejected_preds_dir = f"{preds_dir}_rejected" if preds_dir else None
        rejected_segmentations = [
            f"{seg['path']}_rejected" if seg.get("path") else None for seg in segmentations
        ]
        clean_log_path = os.path.join(images_dir, "clean_log.jsonl")
        datasets_storage[dataset_id] = {
            "case_ids": case_ids,
            "cases": cases,
            "last_opened_volume_ids": [],
            "images_dir": images_dir,
            "labels_dir": labels_dir,
            "preds_dir": preds_dir,
            "rejected_images_dir": rejected_images_dir,
            "rejected_labels_dir": rejected_labels_dir,
            "rejected_preds_dir": rejected_preds_dir,
            "segmentations": segmentations,
            "rejected_segmentations": rejected_segmentations,
            "decisions": {},
            "clean_log_path": clean_log_path,
        }
        logger.info(f"Registered dataset {dataset_id}: {len(case_ids)} cases")
        return RegisterDatasetResponse(
            dataset_id=dataset_id,
            case_count=len(case_ids),
            case_ids=case_ids,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/datasets/{dataset_id}/cases", response_model=GetCasesResponse)
async def get_dataset_cases(dataset_id: str):
    """Return case count and case_ids for a dataset."""
    if dataset_id not in datasets_storage:
        raise HTTPException(status_code=404, detail=f"Dataset not found: {dataset_id}")
    ds = datasets_storage[dataset_id]
    return GetCasesResponse(case_count=len(ds["case_ids"]), case_ids=ds["case_ids"])


@app.post("/api/datasets/{dataset_id}/cases/statistics", response_model=CaseStatisticsResponse)
async def dataset_case_statistics(dataset_id: str, body: CaseStatisticsRequest):
    """Load CT + one segmentation; return combined case statistics; unload both."""
    if dataset_id not in datasets_storage:
        raise HTTPException(status_code=404, detail=f"Dataset not found: {dataset_id}")
    ds = datasets_storage[dataset_id]
    case_ids = ds["case_ids"]
    cases = ds["cases"]
    if body.case_index < 0 or body.case_index >= len(case_ids):
        raise HTTPException(status_code=400, detail="case_index out of range")
    case_id = case_ids[body.case_index]
    entry = cases[case_id]
    image_path = entry.get("image")
    if not image_path:
        raise HTTPException(status_code=400, detail="No image path for case")
    segs = entry.get("segs", [])
    if body.seg_index < 0 or body.seg_index >= len(segs):
        raise HTTPException(status_code=400, detail="seg_index out of range")
    seg_entry = segs[body.seg_index]
    seg_path = seg_entry.get("path")
    if not seg_path:
        raise HTTPException(status_code=400, detail="No segmentation path for this case and seg_index")

    ct_meta = await volume_loader.load_volume(image_path)
    seg_meta = await volume_loader.load_volume(seg_path)
    ct_id, seg_id = ct_meta.volume_id, seg_meta.volume_id
    try:
        ct_img = volume_loader.get_volume(ct_id)
        seg_img = volume_loader.get_volume(seg_id)
        raw = compute_case_statistics(
            ct_img,
            seg_img,
            ct_meta,
            seg_meta,
            include_global_ct_intensity=body.include_global_ct_intensity,
            include_lesion_connected_components=body.include_lesion_connected_components,
            include_label_segmentation_stats=body.include_label_segmentation_stats,
            include_per_label_ct_intensity=body.include_per_label_ct_intensity,
            include_file_metadata=body.include_file_metadata,
        )
        gi = raw.get("global_intensity")
        return CaseStatisticsResponse(
            case_id=case_id,
            skipped=raw["skipped"],
            warning=raw["warning"],
            geometry_match=raw["geometry_match"],
            ct=metadata_to_response(raw["ct_meta"]),
            seg=metadata_to_response(raw["seg_meta"]),
            volumes_mm3=raw["volumes_mm3"],
            max_component_mm3=raw["max_component_mm3"],
            global_intensity=(
                GlobalIntensityStats(
                    minimum=gi["minimum"],
                    maximum=gi["maximum"],
                    mean=gi["mean"],
                    sigma=gi["sigma"],
                )
                if gi
                else None
            ),
            label_values=raw["label_values"],
            multi_label=raw["multi_label"],
            per_label=[PerLabelStatistics(**row) for row in raw["per_label"]],
            ct_file_meta=raw["ct_file_meta"],
            seg_file_meta=raw["seg_file_meta"],
        )
    finally:
        unload_volume_cascade(ct_id)
        unload_volume_cascade(seg_id)


@app.post("/api/datasets/{dataset_id}/open-case", response_model=OpenCaseResponse)
async def open_dataset_case(dataset_id: str, body: OpenCaseRequest):
    """Load volumes for a case on demand; unload previous case volumes."""
    if dataset_id not in datasets_storage:
        raise HTTPException(status_code=404, detail=f"Dataset not found: {dataset_id}")
    ds = datasets_storage[dataset_id]
    case_ids = ds["case_ids"]
    cases = ds["cases"]

    if body.case_index is not None:
        if body.case_index < 0 or body.case_index >= len(case_ids):
            raise HTTPException(status_code=400, detail="case_index out of range")
        case_id = case_ids[body.case_index]
        case_index = body.case_index
    elif body.case_id is not None:
        if body.case_id not in cases:
            raise HTTPException(status_code=404, detail=f"Case not found: {body.case_id}")
        case_id = body.case_id
        case_index = case_ids.index(case_id)
    else:
        raise HTTPException(status_code=400, detail="Provide case_index or case_id")

    for vid in ds.get("last_opened_volume_ids", []):
        try:
            unload_volume_cascade(vid)
        except Exception:
            pass
    ds["last_opened_volume_ids"] = []

    entry = cases[case_id]
    warnings: list[str] = []
    image_path = entry["image"]
    image_meta = await volume_loader.load_volume(image_path)
    ds["last_opened_volume_ids"].append(image_meta.volume_id)

    label_meta = None
    pred_meta = None
    label_all_background = None
    seg_infos: list[SegmentationVolumeInfo] = []
    segs = entry.get("segs", [])
    for i, seg in enumerate(segs):
        path = seg.get("path")
        role = seg.get("role")
        name = seg.get("name")
        label = name or role or f"Segmentation {i + 1}"
        if not path:
            warnings.append(f"Missing segmentation for {label}")
            continue
        meta = await volume_loader.load_volume(path)
        ds["last_opened_volume_ids"].append(meta.volume_id)
        all_bg = None
        seg_stats = None
        try:
            seg_stats = volume_loader.get_label_stats(meta.volume_id)
            all_bg = seg_stats.get("all_background")
        except Exception as e:
            logger.warning(f"Could not check segmentation stats: {e}")
            all_bg = None
        try:
            validation = geometry_validator.validate_geometry(image_meta, meta)
            if not validation.compatible:
                warnings.append(f"{label}: {geometry_validator.format_validation_error(validation)}")
        except Exception as e:
            warnings.append(f"{label} geometry check failed: {e}")
        if role == "gt" and label_meta is None:
            label_meta = meta
            label_all_background = all_bg
        if role == "pred" and pred_meta is None:
            pred_meta = meta
        seg_infos.append(
            SegmentationVolumeInfo(
                volume_id=meta.volume_id,
                role=role,
                name=name,
                all_background=all_bg,
                component_count=seg_stats["component_count"] if seg_stats else None,
                multi_label=seg_stats["multi_label"] if seg_stats else None,
                nonzero_label_count=seg_stats["nonzero_label_count"] if seg_stats else None,
                label_values=seg_stats.get("label_values") if seg_stats else None,
            )
        )

    return OpenCaseResponse(
        case_id=case_id,
        case_index=case_index,
        image_volume_id=image_meta.volume_id,
        image_metadata=metadata_to_response(image_meta),
        label_volume_id=label_meta.volume_id if label_meta else None,
        label_metadata=metadata_to_response(label_meta) if label_meta else None,
        label_all_background=label_all_background,
        pred_volume_id=pred_meta.volume_id if pred_meta else None,
        pred_metadata=metadata_to_response(pred_meta) if pred_meta else None,
        seg_volume_ids=seg_infos,
        warnings=warnings,
    )


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _move_file(src: str, dst_dir: str) -> str:
    _ensure_dir(dst_dir)
    name = os.path.basename(src)
    dst = os.path.join(dst_dir, name)
    try:
        os.rename(src, dst)
    except OSError:
        import shutil
        shutil.move(src, dst)
    return dst


@app.post("/api/datasets/{dataset_id}/decision", response_model=DatasetDecisionResponse)
async def submit_dataset_decision(dataset_id: str, body: DatasetDecisionRequest):
    if dataset_id not in datasets_storage:
        raise HTTPException(status_code=404, detail=f"Dataset not found: {dataset_id}")
    ds = datasets_storage[dataset_id]
    case_id = body.case_id
    decision = body.decision.lower().strip()
    if decision not in ("accept", "reject"):
        raise HTTPException(status_code=400, detail="decision must be accept or reject")
    if case_id not in ds["cases"]:
        raise HTTPException(status_code=404, detail=f"Case not found: {case_id}")

    entry = ds["cases"][case_id]
    ds["decisions"][case_id] = decision
    moved = {}

    if decision == "reject":
        try:
            moved["image"] = _move_file(entry["image"], ds["rejected_images_dir"])
            segs = entry.get("segs", [])
            rej_segs = ds.get("rejected_segmentations", [])
            for seg, rej_dir in zip(segs, rej_segs):
                path = seg.get("path")
                if path and rej_dir:
                    moved[path] = _move_file(path, rej_dir)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to move rejected files: {e}")
        ds["cases"].pop(case_id, None)
        if case_id in ds["case_ids"]:
            ds["case_ids"].remove(case_id)

    log_path = ds.get("clean_log_path")
    if log_path:
        try:
            import json
            with open(log_path, "a") as f:
                f.write(
                    json.dumps(
                        {
                            "time": datetime.now().isoformat(),
                            "case_id": case_id,
                            "decision": decision,
                            "moved": moved,
                        }
                    )
                    + "\n"
                )
        except Exception as e:
            logger.warning(f"Failed to write clean log: {e}")

    case_ids = ds["case_ids"]
    next_case_id = None
    next_case_index = None
    if case_ids:
        if decision == "accept" and case_id in case_ids:
            cur = case_ids.index(case_id)
            idx = cur + 1
            if idx >= len(case_ids):
                idx = None
        else:
            idx = case_ids.index(case_id) if case_id in case_ids else 0
        if idx is not None:
            next_case_index = idx
            next_case_id = case_ids[idx]

    stats = {
        "accepted": sum(1 for d in ds["decisions"].values() if d == "accept"),
        "rejected": sum(1 for d in ds["decisions"].values() if d == "reject"),
        "remaining": len(case_ids),
    }
    return DatasetDecisionResponse(
        next_case_id=next_case_id,
        next_case_index=next_case_index,
        case_count=len(case_ids),
        stats=stats,
    )


# Slice Extraction Endpoints

@app.get("/api/slices/ct/{volume_id}")
async def get_ct_slice(
    volume_id: str,
    slice_index: int = Query(..., description="Slice index to extract"),
    orientation: str = Query("axial", description="Slice orientation: axial, sagittal, or coronal"),
    window_level: float = Query(0, description="Window level for CT display"),
    window_width: float = Query(400, description="Window width for CT display"),
    format: str = Query("png", description="Output format: png or raw")
):
    """Extract CT slice as PNG with window/level."""
    start_time = time.time()
    try:
        _check_orientation(orientation)
        logger.debug(
            f"CT slice request: volume={volume_id}, index={slice_index}, "
            f"orientation={orientation}, window_level={window_level}, window_width={window_width}"
        )
        cache_key = _ct_slice_cache_key(volume_id, slice_index, orientation, window_level, window_width)
        if _SLICE_CACHE_ENABLED:
            cached = cache_manager.get(cache_key)
            if cached is not None:
                latency = time.time() - start_time
                logger.debug(
                    "CT slice cache hit: volume=%s index=%s latency=%.2fms",
                    volume_id,
                    slice_index,
                    latency * 1000,
                )
                return Response(
                    content=cached, media_type="image/png", headers=dict(_SLICE_HTTP_CACHE)
                )

        volume = volume_loader.get_volume(volume_id)

        def _extract():
            return slice_extractor.extract_ct_slice(
                volume=volume,
                slice_index=slice_index,
                orientation=orientation,
                window_level=window_level,
                window_width=window_width,
            )

        slice_bytes = await asyncio.to_thread(_extract)
        if _SLICE_CACHE_ENABLED:
            cache_manager.put(cache_key, slice_bytes, len(slice_bytes))

        latency = time.time() - start_time
        logger.info(f"CT slice generated: volume={volume_id}, index={slice_index}, orientation={orientation}, latency={latency*1000:.2f}ms")
        return Response(content=slice_bytes, media_type="image/png", headers=dict(_SLICE_HTTP_CACHE))
    except VolumeLoadError as e:
        logger.error(f"Volume not found for slice extraction: {e}", exc_info=True)
        raise HTTPException(status_code=404, detail=str(e))
    except SliceExtractionError as e:
        logger.error(f"Slice extraction failed: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error extracting CT slice: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/slices/ct/{volume_id}/window-from-roi")
async def get_window_from_roi(
    volume_id: str,
    slice_index: int = Query(..., description="Slice index"),
    orientation: str = Query("axial", description="Slice orientation"),
    center_x: float = Query(..., description="ROI center x (slice pixel)"),
    center_y: float = Query(..., description="ROI center y (slice pixel)"),
    radius_mm: float = Query(20.0, description="ROI radius in mm"),
):
    """Compute window level/width from robust percentiles (p5/p95) in a local ROI of raw HU."""
    try:
        _check_orientation(orientation)
        volume = volume_loader.get_volume(volume_id)
        level, width = slice_extractor.window_from_roi(
            volume=volume,
            slice_index=slice_index,
            orientation=orientation,
            center_x=center_x,
            center_y=center_y,
            radius_mm=radius_mm,
        )
        return JSONResponse(content={"level": level, "width": width})
    except VolumeLoadError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except SliceExtractionError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/slices/segmentation/{volume_id}")
async def get_segmentation_slice(
    volume_id: str,
    slice_index: int = Query(..., description="Slice index to extract"),
    orientation: str = Query("axial", description="Slice orientation: axial, sagittal, or coronal"),
    mode: str = Query("filled", description="Rendering mode: filled or boundary"),
    format: str = Query("png", description="Output format: png or raw")
):
    """Extract segmentation slice as PNG (mode: filled or boundary)."""
    start_time = time.time()
    try:
        _check_orientation(orientation)
        _check_seg_mode(mode)
        logger.debug(
            f"Segmentation slice request: volume={volume_id}, index={slice_index}, "
            f"orientation={orientation}, mode={mode}"
        )
        cache_key = _seg_slice_cache_key(volume_id, slice_index, orientation, mode)
        if _SLICE_CACHE_ENABLED:
            cached = cache_manager.get(cache_key)
            if cached is not None:
                latency = time.time() - start_time
                logger.debug(
                    "Seg slice cache hit: volume=%s index=%s latency=%.2fms",
                    volume_id,
                    slice_index,
                    latency * 1000,
                )
                return Response(
                    content=cached, media_type="image/png", headers=dict(_SLICE_HTTP_CACHE)
                )

        volume = volume_loader.get_volume(volume_id)

        def _extract():
            return slice_extractor.extract_segmentation_slice(
                volume=volume,
                slice_index=slice_index,
                orientation=orientation,
                mode=mode,
            )

        slice_bytes = await asyncio.to_thread(_extract)
        if _SLICE_CACHE_ENABLED:
            cache_manager.put(cache_key, slice_bytes, len(slice_bytes))

        latency = time.time() - start_time
        logger.info(f"Segmentation slice generated: volume={volume_id}, index={slice_index}, orientation={orientation}, mode={mode}, latency={latency*1000:.2f}ms")
        return Response(content=slice_bytes, media_type="image/png", headers=dict(_SLICE_HTTP_CACHE))
    except VolumeLoadError as e:
        logger.error(f"Volume not found for slice extraction: {e}", exc_info=True)
        raise HTTPException(status_code=404, detail=str(e))
    except SliceExtractionError as e:
        logger.error(f"Slice extraction failed: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error extracting segmentation slice: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/volumes/dice")
async def get_dice(
    gt_volume_id: str = Query(..., description="Ground truth volume ID"),
    pred_volume_id: str = Query(..., description="Prediction volume ID"),
):
    """Compute image-level DICE between GT and prediction segmentation volumes."""
    import numpy as np
    import SimpleITK as sitk
    try:
        gt = volume_loader.get_volume(gt_volume_id)
        pred = volume_loader.get_volume(pred_volume_id)
        gt_meta = volume_loader.get_metadata(gt_volume_id)
        pred_meta = volume_loader.get_metadata(pred_volume_id)
        if not geometry_validator.validate_geometry(gt_meta, pred_meta).compatible:
            pred = resampler.resample_to_reference(pred, gt, sitk.sitkNearestNeighbor)
        ga = (np.asarray(sitk.GetArrayFromImage(gt)) != 0).astype(bool)
        pa = (np.asarray(sitk.GetArrayFromImage(pred)) != 0).astype(bool)
        inter = np.sum(ga & pa)
        denom = np.sum(ga) + np.sum(pa)
        dice = 2.0 * inter / denom if denom > 0 else 1.0
        return {"dice": round(float(dice), 4)}
    except VolumeLoadError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ResamplingError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/slices/segmentation/{volume_id}/first-slice-index")
async def get_first_slice_with_mask(
    volume_id: str,
    orientation: str = Query("axial", description="Slice orientation: axial, sagittal, or coronal"),
    middle: bool = Query(False, description="If true, return the middle slice of the mask extent instead of the first"),
):
    """Return the first (or middle) slice index along the given orientation that contains segmentation foreground."""
    try:
        _check_orientation(orientation)
        volume = volume_loader.get_volume(volume_id)
        if middle:
            slice_index = slice_extractor.middle_slice_with_foreground(volume, orientation)
        else:
            slice_index = slice_extractor.first_slice_with_foreground(volume, orientation)
        return {"slice_index": slice_index}
    except VolumeLoadError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except SliceExtractionError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/slices/segmentation/{volume_id}/slice-for-component")
async def get_slice_for_component(
    volume_id: str,
    orientation: str = Query("axial", description="Slice orientation: axial, sagittal, or coronal"),
    component_index: int = Query(..., ge=1, description="1-based component index (ordered by size)"),
):
    """Return slice index at centroid of the given connected component."""
    try:
        _check_orientation(orientation)
        volume = volume_loader.get_volume(volume_id)
        stats = volume_loader.get_label_stats(volume_id)
        max_comp = stats.get("component_count", 0)
        if component_index > max_comp:
            raise HTTPException(
                status_code=400,
                detail=f"component_index {component_index} out of range [1, {max_comp}]",
            )
        slice_index = slice_extractor.middle_slice_for_component(volume, orientation, component_index)
        return {"slice_index": slice_index}
    except VolumeLoadError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except SliceExtractionError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/pairs/{pair_id}/physical-to-index", response_model=PhysicalToIndexResponse)
async def physical_to_index(pair_id: str, request: PhysicalToIndexRequest):
    """Convert physical position to slice index."""
    try:
        metadata, axis = _get_pair_axis_metadata(pair_id, request.orientation)
        slice_index = int(round((request.physical_position - metadata.origin[axis]) / metadata.spacing[axis]))
        max_index = metadata.dimensions[axis] - 1
        slice_index = max(0, min(slice_index, max_index))
        return PhysicalToIndexResponse(slice_index=slice_index)
    except VolumeLoadError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error converting physical to index: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/pairs/{pair_id}/index-to-physical", response_model=IndexToPhysicalResponse)
async def index_to_physical(pair_id: str, request: IndexToPhysicalRequest):
    """Convert slice index to physical position."""
    try:
        metadata, axis = _get_pair_axis_metadata(pair_id, request.orientation)
        max_index = metadata.dimensions[axis] - 1
        if request.slice_index < 0 or request.slice_index > max_index:
            raise HTTPException(status_code=400, detail=f"Slice index {request.slice_index} out of range [0, {max_index}]")
        physical_position = metadata.origin[axis] + request.slice_index * metadata.spacing[axis]
        return IndexToPhysicalResponse(physical_position=physical_position)
    except VolumeLoadError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error converting index to physical: {e}")
        raise HTTPException(status_code=500, detail=str(e))
