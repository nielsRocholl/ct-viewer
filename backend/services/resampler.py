"""Resampler Service

Resamples segmentation volumes to match CT geometry using SimpleITK.
Uses nearest-neighbor interpolation to preserve label values.
"""

import logging
from typing import Optional

import SimpleITK as sitk

logger = logging.getLogger(__name__)


class ResamplingError(Exception):
    """Raised when resampling fails"""
    pass


class ResamplerService:
    """Service for resampling volumes to match reference geometry"""
    
    def __init__(self):
        logger.info("ResamplerService initialized")
    
    def resample_to_reference(
        self,
        moving_volume: sitk.Image,
        reference_volume: sitk.Image,
        interpolator: Optional[int] = None
    ) -> sitk.Image:
        """Resample moving volume to match reference geometry
        
        Uses nearest-neighbor interpolation by default to preserve label values
        in segmentation masks.
        
        Args:
            moving_volume: The volume to be resampled (typically segmentation)
            reference_volume: The reference volume (typically CT)
            interpolator: Optional SimpleITK interpolator constant
                         (default: sitk.sitkNearestNeighbor)
            
        Returns:
            Resampled SimpleITK Image matching reference geometry
            
        Raises:
            ResamplingError: If resampling fails
        """
        if interpolator is None:
            interpolator = sitk.sitkNearestNeighbor
        
        try:
            # Log resampling operation
            logger.info(
                f"Resampling volume: "
                f"from size={moving_volume.GetSize()}, "
                f"spacing={moving_volume.GetSpacing()}, "
                f"origin={moving_volume.GetOrigin()} "
                f"to size={reference_volume.GetSize()}, "
                f"spacing={reference_volume.GetSpacing()}, "
                f"origin={reference_volume.GetOrigin()}"
            )
            
            # Create resampler
            resampler = sitk.ResampleImageFilter()
            
            # Set reference geometry
            resampler.SetSize(reference_volume.GetSize())
            resampler.SetOutputSpacing(reference_volume.GetSpacing())
            resampler.SetOutputOrigin(reference_volume.GetOrigin())
            resampler.SetOutputDirection(reference_volume.GetDirection())
            
            # Set interpolation method
            resampler.SetInterpolator(interpolator)
            
            # Set default pixel value (for regions outside moving volume)
            resampler.SetDefaultPixelValue(0)
            
            # Execute resampling
            resampled_volume = resampler.Execute(moving_volume)
            
            logger.info(
                f"Resampling completed successfully: "
                f"output size={resampled_volume.GetSize()}, "
                f"spacing={resampled_volume.GetSpacing()}"
            )
            
            return resampled_volume
            
        except Exception as e:
            logger.error(f"Resampling failed: {e}")
            raise ResamplingError(f"Failed to resample volume: {str(e)}")
    
    def resample_segmentation_to_ct(
        self,
        segmentation: sitk.Image,
        ct_volume: sitk.Image
    ) -> sitk.Image:
        """Convenience method to resample segmentation to match CT geometry
        
        Always uses nearest-neighbor interpolation to preserve label values.
        
        Args:
            segmentation: The segmentation mask to resample
            ct_volume: The CT volume providing reference geometry
            
        Returns:
            Resampled segmentation matching CT geometry
            
        Raises:
            ResamplingError: If resampling fails
        """
        logger.info("Resampling segmentation to match CT geometry")
        return self.resample_to_reference(
            moving_volume=segmentation,
            reference_volume=ct_volume,
            interpolator=sitk.sitkNearestNeighbor
        )
