"""Volume Loader Service

Handles loading medical image files using SimpleITK, extracting metadata,
and validating 3D dimensionality.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, Tuple

import SimpleITK as sitk

logger = logging.getLogger(__name__)


@dataclass
class VolumeMetadata:
    """Metadata for a loaded volume"""
    volume_id: str
    file_name: str
    dimensions: Tuple[int, int, int]
    spacing: Tuple[float, float, float]
    origin: Tuple[float, float, float]
    direction: Tuple[float, ...]  # 9 elements for 3D
    pixel_type: str
    number_of_components: int
    size_bytes: int
    loaded_at: datetime


class VolumeLoadError(Exception):
    """Raised when volume loading fails"""
    pass


class VolumeLoaderService:
    """Service for loading and managing medical image volumes"""
    
    SUPPORTED_EXTENSIONS = {'.nii', '.nii.gz', '.mha', '.mhd'}
    
    def __init__(self):
        self._volumes: Dict[str, sitk.Image] = {}
        self._metadata: Dict[str, VolumeMetadata] = {}
        logger.info("VolumeLoaderService initialized")
    
    async def load_volume(self, file_path: str) -> VolumeMetadata:
        """Load a medical image volume from file
        
        Args:
            file_path: Path to the volume file
            
        Returns:
            VolumeMetadata containing volume information and ID
            
        Raises:
            VolumeLoadError: If loading fails or validation fails
        """
        path = Path(file_path)
        
        # Validate file exists
        if not path.exists():
            raise VolumeLoadError(f"File not found: {file_path}")
        
        # Validate file extension (handle .nii.gz specially)
        file_str = str(path)
        if file_str.endswith('.nii.gz'):
            # .nii.gz is supported
            pass
        elif path.suffix not in self.SUPPORTED_EXTENSIONS:
            raise VolumeLoadError(
                f"Unsupported file format: {path.name}. "
                f"Supported formats: {', '.join(self.SUPPORTED_EXTENSIONS)}"
            )
        
        try:
            # Load volume using SimpleITK
            logger.info(f"Loading volume from {file_path}")
            volume = sitk.ReadImage(str(path))
            
            # Validate 3D dimensionality
            if volume.GetDimension() != 3:
                raise VolumeLoadError(
                    f"Volume must be 3D, got {volume.GetDimension()}D"
                )

            # Reorient to LPS so voxel axes align with physical axes (direction becomes identity)
            volume = sitk.DICOMOrient(volume, "LPS")

            # Extract metadata from reoriented image
            volume_id = str(uuid.uuid4())
            dimensions = volume.GetSize()
            spacing = volume.GetSpacing()
            origin = volume.GetOrigin()
            direction = volume.GetDirection()
            pixel_type = volume.GetPixelIDTypeAsString()
            number_of_components = volume.GetNumberOfComponentsPerPixel()
            
            # Calculate size in bytes (approximate)
            size_bytes = (
                dimensions[0] * dimensions[1] * dimensions[2] * 
                number_of_components * 
                self._get_pixel_size_bytes(volume.GetPixelID())
            )
            
            metadata = VolumeMetadata(
                volume_id=volume_id,
                file_name=path.name,
                dimensions=dimensions,
                spacing=spacing,
                origin=origin,
                direction=direction,
                pixel_type=pixel_type,
                number_of_components=number_of_components,
                size_bytes=size_bytes,
                loaded_at=datetime.now()
            )
            
            # Store volume and metadata
            self._volumes[volume_id] = volume
            self._metadata[volume_id] = metadata
            
            logger.info(
                f"Successfully loaded volume {volume_id}: "
                f"{dimensions[0]}x{dimensions[1]}x{dimensions[2]}, "
                f"spacing={spacing}, size={size_bytes / (1024**2):.2f}MB"
            )
            
            return metadata
            
        except RuntimeError as e:
            # SimpleITK raises RuntimeError for corrupted files
            logger.error(f"Failed to load volume from {file_path}: {e}", exc_info=True)
            raise VolumeLoadError(f"Failed to load volume: {str(e)}")
        except Exception as e:
            logger.error(f"Unexpected error loading volume from {file_path}: {e}", exc_info=True)
            raise VolumeLoadError(f"Unexpected error: {str(e)}")
    
    def get_volume(self, volume_id: str) -> sitk.Image:
        """Retrieve a cached volume by ID
        
        Args:
            volume_id: The volume identifier
            
        Returns:
            The SimpleITK Image object
            
        Raises:
            VolumeLoadError: If volume not found
        """
        if volume_id not in self._volumes:
            raise VolumeLoadError(f"Volume not found: {volume_id}")
        return self._volumes[volume_id]
    
    def get_metadata(self, volume_id: str) -> VolumeMetadata:
        """Retrieve volume metadata by ID
        
        Args:
            volume_id: The volume identifier
            
        Returns:
            VolumeMetadata for the volume
            
        Raises:
            VolumeLoadError: If volume not found
        """
        if volume_id not in self._metadata:
            raise VolumeLoadError(f"Volume metadata not found: {volume_id}")
        return self._metadata[volume_id]
    
    def unload_volume(self, volume_id: str) -> None:
        """Remove a volume from cache
        
        Args:
            volume_id: The volume identifier
        """
        if volume_id in self._volumes:
            del self._volumes[volume_id]
            logger.info(f"Unloaded volume {volume_id}")
        
        if volume_id in self._metadata:
            del self._metadata[volume_id]
    
    def list_volumes(self) -> Dict[str, VolumeMetadata]:
        """Get all loaded volume metadata
        
        Returns:
            Dictionary mapping volume IDs to metadata
        """
        return self._metadata.copy()
    
    @staticmethod
    def _get_pixel_size_bytes(pixel_id: int) -> int:
        """Get the size in bytes for a pixel type
        
        Args:
            pixel_id: SimpleITK pixel type ID
            
        Returns:
            Size in bytes
        """
        # Map SimpleITK pixel types to byte sizes
        pixel_sizes = {
            sitk.sitkUInt8: 1,
            sitk.sitkInt8: 1,
            sitk.sitkUInt16: 2,
            sitk.sitkInt16: 2,
            sitk.sitkUInt32: 4,
            sitk.sitkInt32: 4,
            sitk.sitkUInt64: 8,
            sitk.sitkInt64: 8,
            sitk.sitkFloat32: 4,
            sitk.sitkFloat64: 8,
        }
        return pixel_sizes.get(pixel_id, 4)  # Default to 4 bytes
