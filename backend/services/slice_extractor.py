"""Slice Extraction Service

Extracts 2D slices from 3D volumes using SimpleITK, applies window/level
transformations to CT slices, and encodes slices as PNG for transmission.
"""

import logging
from io import BytesIO
from typing import Literal, Tuple

import numpy as np
import SimpleITK as sitk
from PIL import Image

logger = logging.getLogger(__name__)

HU_MIN, HU_MAX = -1024.0, 3000.0
WW_MIN, WW_MAX = 50.0, 2000.0
CONTRAST_SHRINK = 0.7
PERCENTILE_LOW, PERCENTILE_HIGH = 5.0, 95.0


class SliceExtractionError(Exception):
    """Raised when slice extraction fails"""
    pass


class SliceExtractorService:
    """Service for extracting and encoding 2D slices from 3D volumes"""
    
    def __init__(self):
        logger.info("SliceExtractorService initialized")
    
    def extract_ct_slice(
        self,
        volume: sitk.Image,
        slice_index: int,
        orientation: Literal['axial', 'sagittal', 'coronal'] = 'axial',
        window_level: float = 0,
        window_width: float = 400
    ) -> bytes:
        """Extract and encode a CT slice with window/level transformation
        
        Args:
            volume: The 3D SimpleITK volume
            slice_index: Index of the slice to extract
            orientation: Slice orientation (axial, sagittal, or coronal)
            window_level: Center value of intensity range
            window_width: Range of intensity values to display
            
        Returns:
            PNG-encoded slice as bytes
            
        Raises:
            SliceExtractionError: If extraction fails
        """
        try:
            # Validate slice index
            dimensions = volume.GetSize()
            axis = self._get_axis_for_orientation(orientation)
            max_index = dimensions[axis] - 1
            
            if slice_index < 0 or slice_index > max_index:
                raise SliceExtractionError(
                    f"Slice index {slice_index} out of range [0, {max_index}] "
                    f"for {orientation} orientation"
                )
            
            # Extract slice using SimpleITK
            slice_image = self._extract_slice_by_orientation(
                volume, slice_index, orientation
            )
            
            slice_image = self._resample_slice_to_isotropic(slice_image)
            slice_array = sitk.GetArrayFromImage(slice_image)
            slice_array = self._orient_slice_for_display(slice_array, orientation)

            # Apply window/level transformation
            windowed_array = self._apply_window_level(
                slice_array, window_level, window_width
            )

            # Encode as PNG
            png_bytes = self._encode_as_png(windowed_array)
            
            logger.debug(
                f"Extracted CT slice {slice_index} ({orientation}), "
                f"window_level={window_level}, window_width={window_width}"
            )
            
            return png_bytes
            
        except SliceExtractionError:
            raise
        except Exception as e:
            logger.error(f"Failed to extract CT slice: {e}")
            raise SliceExtractionError(f"Failed to extract CT slice: {str(e)}")
    
    def extract_segmentation_slice(
        self,
        volume: sitk.Image,
        slice_index: int,
        orientation: Literal['axial', 'sagittal', 'coronal'] = 'axial',
        mode: Literal['filled', 'boundary'] = 'filled'
    ) -> bytes:
        """Extract and encode a segmentation slice
        
        Args:
            volume: The 3D SimpleITK segmentation volume
            slice_index: Index of the slice to extract
            orientation: Slice orientation (axial, sagittal, or coronal)
            mode: Rendering mode - 'filled' for full labels, 'boundary' for edges only
            
        Returns:
            PNG-encoded slice as bytes
            
        Raises:
            SliceExtractionError: If extraction fails
        """
        try:
            # Validate slice index
            dimensions = volume.GetSize()
            axis = self._get_axis_for_orientation(orientation)
            max_index = dimensions[axis] - 1
            
            if slice_index < 0 or slice_index > max_index:
                raise SliceExtractionError(
                    f"Slice index {slice_index} out of range [0, {max_index}] "
                    f"for {orientation} orientation"
                )
            
            # Extract slice using SimpleITK
            slice_image = self._extract_slice_by_orientation(
                volume, slice_index, orientation
            )
            
            slice_image = self._resample_slice_to_isotropic(
                slice_image, interpolator=sitk.sitkNearestNeighbor
            )
            slice_array = sitk.GetArrayFromImage(slice_image)
            slice_array = self._orient_slice_for_display(slice_array, orientation)

            # Apply boundary extraction if requested
            if mode == 'boundary':
                slice_array = self._extract_boundaries(slice_array)

            # Encode as PNG (preserve label values)
            png_bytes = self._encode_segmentation_as_png(slice_array)
            
            logger.debug(
                f"Extracted segmentation slice {slice_index} ({orientation}), "
                f"mode={mode}"
            )
            
            return png_bytes
            
        except SliceExtractionError:
            raise
        except Exception as e:
            logger.error(f"Failed to extract segmentation slice: {e}")
            raise SliceExtractionError(f"Failed to extract segmentation slice: {str(e)}")

    def window_from_roi(
        self,
        volume: sitk.Image,
        slice_index: int,
        orientation: Literal['axial', 'sagittal', 'coronal'],
        center_x: float,
        center_y: float,
        radius_mm: float = 20.0,
    ) -> Tuple[float, float]:
        """Compute window level and width from robust percentiles in a local ROI (raw HU)."""
        dimensions = volume.GetSize()
        axis = self._get_axis_for_orientation(orientation)
        if slice_index < 0 or slice_index >= dimensions[axis]:
            raise SliceExtractionError(
                f"Slice index {slice_index} out of range for {orientation}"
            )
        slice_image = self._extract_slice_by_orientation(
            volume, slice_index, orientation
        )
        slice_image = self._resample_slice_to_isotropic(slice_image)
        slice_array = np.asarray(sitk.GetArrayFromImage(slice_image), dtype=np.float64)
        slice_array = self._orient_slice_for_display(slice_array, orientation)
        spacing = slice_image.GetSpacing()
        size_x, size_y = slice_image.GetSize()
        sx, sy = spacing[0], spacing[1]
        rx = max(1, radius_mm / sx)
        ry = max(1, radius_mm / sy)
        x0 = max(0, int(center_x - rx))
        x1 = min(size_x, int(center_x + rx) + 1)
        y0 = max(0, int(center_y - ry))
        y1 = min(size_y, int(center_y + ry) + 1)
        if x0 >= x1 or y0 >= y1:
            raise SliceExtractionError("ROI is empty")
        roi = slice_array[y0:y1, x0:x1].ravel()
        if roi.size == 0:
            raise SliceExtractionError("ROI has no voxels")
        l_val, u_val = np.percentile(roi, [PERCENTILE_LOW, PERCENTILE_HIGH])
        l_val = float(np.clip(l_val, HU_MIN, HU_MAX))
        u_val = float(np.clip(u_val, HU_MIN, HU_MAX))
        level = (l_val + u_val) / 2.0
        width = (u_val - l_val) * CONTRAST_SHRINK
        width = float(np.clip(width, WW_MIN, WW_MAX))
        return (level, width)
    
    @staticmethod
    def _resample_slice_to_isotropic(
        slice_image: sitk.Image,
        interpolator: int = sitk.sitkLinear,
    ) -> sitk.Image:
        """Resample 2D slice to isotropic in-plane spacing so PNG aspect is correct."""
        sx, sy = slice_image.GetSpacing()
        if abs(sx - sy) < 1e-6:
            return slice_image
        w, h = slice_image.GetSize()
        s = min(sx, sy)
        out_w = max(1, int(round(w * sx / s)))
        out_h = max(1, int(round(h * sy / s)))
        out_size = [out_w, out_h]
        out_spacing = [s, s]
        resampler = sitk.ResampleImageFilter()
        resampler.SetSize(out_size)
        resampler.SetOutputSpacing(out_spacing)
        resampler.SetOutputOrigin(slice_image.GetOrigin())
        resampler.SetOutputDirection(slice_image.GetDirection())
        resampler.SetDefaultPixelValue(0)
        resampler.SetInterpolator(interpolator)
        return resampler.Execute(slice_image)

    @staticmethod
    def _orient_slice_for_display(
        slice_array: np.ndarray,
        orientation: Literal['axial', 'sagittal', 'coronal'],
    ) -> np.ndarray:
        """Flip sagittal and coronal left-right for conventional radiological display."""
        if orientation in ('sagittal', 'coronal'):
            return np.flip(slice_array, axis=0)
        return slice_array

    @staticmethod
    def _get_axis_for_orientation(orientation: str) -> int:
        """Get the axis index for a given orientation
        
        Args:
            orientation: 'axial', 'sagittal', or 'coronal'
            
        Returns:
            Axis index (0, 1, or 2)
        """
        orientation_map = {
            'axial': 2,      # Z axis
            'sagittal': 0,   # X axis
            'coronal': 1     # Y axis
        }
        return orientation_map[orientation]
    
    @staticmethod
    def _extract_slice_by_orientation(
        volume: sitk.Image,
        slice_index: int,
        orientation: str
    ) -> sitk.Image:
        """Extract a 2D slice from a 3D volume
        
        Args:
            volume: The 3D volume
            slice_index: Index along the orientation axis
            orientation: 'axial', 'sagittal', or 'coronal'
            
        Returns:
            2D SimpleITK image
        """
        size = list(volume.GetSize())
        
        if orientation == 'axial':
            # Extract Z slice (XY plane)
            size[2] = 0
            index = [0, 0, slice_index]
        elif orientation == 'sagittal':
            # Extract X slice (YZ plane)
            size[0] = 0
            index = [slice_index, 0, 0]
        elif orientation == 'coronal':
            # Extract Y slice (XZ plane)
            size[1] = 0
            index = [0, slice_index, 0]
        else:
            raise SliceExtractionError(f"Invalid orientation: {orientation}")
        
        extractor = sitk.ExtractImageFilter()
        extractor.SetSize(size)
        extractor.SetIndex(index)
        
        return extractor.Execute(volume)

    @staticmethod
    def first_slice_with_foreground(
        volume: sitk.Image,
        orientation: Literal['axial', 'sagittal', 'coronal'] = 'axial'
    ) -> int:
        """Return the first slice index (along the given orientation) that has any non-zero voxel."""
        arr = np.asarray(sitk.GetArrayFromImage(volume))
        if orientation == 'axial':
            has_fg = np.any(arr != 0, axis=(1, 2))
        elif orientation == 'sagittal':
            has_fg = np.any(arr != 0, axis=(0, 1))
        else:
            has_fg = np.any(arr != 0, axis=(0, 2))
        idx = np.flatnonzero(has_fg)
        return int(idx[0]) if idx.size else 0

    @staticmethod
    def _apply_window_level(
        array: np.ndarray,
        window_level: float,
        window_width: float
    ) -> np.ndarray:
        """Apply window/level transformation to CT data
        
        Maps intensity values to [0, 255] range based on window parameters.
        
        Args:
            array: Input intensity array
            window_level: Center of the intensity window
            window_width: Width of the intensity window
            
        Returns:
            Windowed array in [0, 255] range as uint8
        """
        # Calculate window bounds
        window_min = window_level - window_width / 2
        window_max = window_level + window_width / 2
        
        # Clip values to window range
        windowed = np.clip(array, window_min, window_max)
        
        # Normalize to [0, 255]
        if window_width > 0:
            windowed = (windowed - window_min) / window_width * 255
        else:
            windowed = np.zeros_like(windowed)
        
        return windowed.astype(np.uint8)
    
    @staticmethod
    def _extract_boundaries(label_array: np.ndarray) -> np.ndarray:
        """Extract boundaries from a segmentation label array
        
        Identifies voxels at the interface between different labels.
        
        Args:
            label_array: 2D array of segmentation labels
            
        Returns:
            Binary array where 1 indicates boundary voxels
        """
        padded = np.pad(label_array, pad_width=1, mode='constant', constant_values=0)
        center = padded[1:-1, 1:-1]
        if center.size == 0:
            return np.zeros_like(label_array, dtype=np.uint8)
        left = padded[1:-1, :-2]
        right = padded[1:-1, 2:]
        top = padded[:-2, 1:-1]
        bottom = padded[2:, 1:-1]
        diff = (left != center) | (right != center) | (top != center) | (bottom != center)
        boundary = (center != 0) & diff
        out = np.where(boundary, center, 0)
        return out.astype(label_array.dtype, copy=False)
    
    @staticmethod
    def _encode_as_png(array: np.ndarray) -> bytes:
        """Encode a numpy array as PNG bytes
        
        Args:
            array: 2D uint8 array
            
        Returns:
            PNG-encoded bytes
        """
        # Convert to PIL Image
        image = Image.fromarray(array, mode='L')
        
        # Encode as PNG
        buffer = BytesIO()
        image.save(buffer, format='PNG')
        
        return buffer.getvalue()
    
    @staticmethod
    def _encode_segmentation_as_png(array: np.ndarray) -> bytes:
        """Encode a segmentation array as PNG bytes
        
        Preserves label values by encoding as grayscale.
        
        Args:
            array: 2D array of label values
            
        Returns:
            PNG-encoded bytes
        """
        # Convert to uint8 if needed (assuming labels fit in uint8 range)
        if array.dtype != np.uint8:
            # Clip to uint8 range
            array = np.clip(array, 0, 255).astype(np.uint8)
        
        # Convert to PIL Image
        image = Image.fromarray(array, mode='L')
        
        # Encode as PNG
        buffer = BytesIO()
        image.save(buffer, format='PNG')
        
        return buffer.getvalue()
