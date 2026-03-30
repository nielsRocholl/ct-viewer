"""Tests for Slice Extractor Service"""

import pytest
import numpy as np
import SimpleITK as sitk
from io import BytesIO
from PIL import Image

from services.slice_extractor import SliceExtractorService, SliceExtractionError


@pytest.fixture
def slice_extractor():
    """Create a SliceExtractorService instance"""
    return SliceExtractorService()


def create_test_ct_volume(size=(10, 10, 10), spacing=(1.0, 1.0, 1.0)) -> sitk.Image:
    """Create a test CT volume with varying intensities"""
    volume = sitk.Image(size, sitk.sitkInt16)
    volume.SetSpacing(spacing)
    volume.SetOrigin((0.0, 0.0, 0.0))
    
    # Fill with gradient intensities
    arr = np.zeros(size, dtype=np.int16)
    for z in range(size[2]):
        arr[:, :, z] = z * 100 - 500  # Range from -500 to 400
    
    volume = sitk.GetImageFromArray(arr.transpose(2, 1, 0))
    volume.SetSpacing(spacing)
    volume.SetOrigin((0.0, 0.0, 0.0))
    
    return volume


def create_test_segmentation_volume(size=(10, 10, 10)) -> sitk.Image:
    """Create a test segmentation volume with multiple labels"""
    volume = sitk.Image(size, sitk.sitkUInt8)
    volume.SetSpacing((1.0, 1.0, 1.0))
    volume.SetOrigin((0.0, 0.0, 0.0))
    
    # Create segmentation with different labels
    arr = np.zeros(size, dtype=np.uint8)
    
    # Label 1: left half
    arr[:5, :, :] = 1
    
    # Label 2: right half
    arr[5:, :, :] = 2
    
    volume = sitk.GetImageFromArray(arr.transpose(2, 1, 0))
    volume.SetSpacing((1.0, 1.0, 1.0))
    volume.SetOrigin((0.0, 0.0, 0.0))
    
    return volume


def test_extract_ct_slice_axial(slice_extractor):
    """Test extracting an axial CT slice"""
    volume = create_test_ct_volume()
    
    # Extract middle slice
    png_bytes = slice_extractor.extract_ct_slice(
        volume=volume,
        slice_index=5,
        orientation='axial',
        window_level=0,
        window_width=400
    )
    
    # Verify PNG was created
    assert isinstance(png_bytes, bytes)
    assert len(png_bytes) > 0
    
    # Verify it's a valid PNG
    image = Image.open(BytesIO(png_bytes))
    assert image.format == 'PNG'
    assert image.size == (10, 10)


def test_extract_ct_slice_with_window_level(slice_extractor):
    """Test window/level transformation"""
    volume = create_test_ct_volume()
    
    # Extract with specific window/level
    png_bytes = slice_extractor.extract_ct_slice(
        volume=volume,
        slice_index=5,
        orientation='axial',
        window_level=100,
        window_width=200
    )
    
    # Decode and verify
    image = Image.open(BytesIO(png_bytes))
    arr = np.array(image)
    
    # All values should be in [0, 255] range
    assert arr.min() >= 0
    assert arr.max() <= 255


def test_extract_ct_slice_invalid_index(slice_extractor):
    """Test error handling for invalid slice index"""
    volume = create_test_ct_volume(size=(10, 10, 10))
    
    # Try to extract out-of-range slice
    with pytest.raises(SliceExtractionError, match="out of range"):
        slice_extractor.extract_ct_slice(
            volume=volume,
            slice_index=20,  # Out of range
            orientation='axial'
        )


def test_extract_segmentation_slice_filled(slice_extractor):
    """Test extracting a filled segmentation slice"""
    volume = create_test_segmentation_volume()
    
    # Extract middle slice
    png_bytes = slice_extractor.extract_segmentation_slice(
        volume=volume,
        slice_index=5,
        orientation='axial',
        mode='filled'
    )
    
    # Verify PNG was created
    assert isinstance(png_bytes, bytes)
    assert len(png_bytes) > 0
    
    # Verify it's a valid PNG
    image = Image.open(BytesIO(png_bytes))
    assert image.format == 'PNG'
    assert image.size == (10, 10)
    
    # Verify labels are preserved
    arr = np.array(image)
    unique_labels = np.unique(arr)
    assert 1 in unique_labels
    assert 2 in unique_labels


def test_extract_segmentation_slice_boundary(slice_extractor):
    """Test extracting boundary-only segmentation slice"""
    volume = create_test_segmentation_volume()
    
    # Extract middle slice with boundary mode
    png_bytes = slice_extractor.extract_segmentation_slice(
        volume=volume,
        slice_index=5,
        orientation='axial',
        mode='boundary'
    )
    
    # Verify PNG was created
    assert isinstance(png_bytes, bytes)
    assert len(png_bytes) > 0
    
    # Decode and verify boundaries
    image = Image.open(BytesIO(png_bytes))
    arr = np.array(image)
    
    # Boundary should have fewer non-zero pixels than filled
    boundary_pixels = np.count_nonzero(arr)
    assert boundary_pixels > 0  # Should have some boundary pixels
    assert boundary_pixels < 100  # Should be less than full filled area


def test_boundary_extraction_detects_interfaces(slice_extractor):
    """Test that boundary extraction correctly identifies label interfaces"""
    # Create a simple segmentation with clear boundary
    arr = np.zeros((10, 10), dtype=np.uint8)
    arr[:5, :] = 1  # Top half is label 1
    arr[5:, :] = 2  # Bottom half is label 2
    
    # Extract boundaries
    boundary = slice_extractor._extract_boundaries(arr)
    
    # Verify boundary is at the interface (row 4 and 5)
    # Row 4 (last row of label 1) should have boundaries
    assert np.any(boundary[4, :] > 0)
    
    # Row 5 (first row of label 2) should have boundaries
    assert np.any(boundary[5, :] > 0)
    
    # Middle of each region should not be part of the contour (thick outline reaches +1 px from edges)
    assert np.all(boundary[2, 2:-2] == 0)  # Middle of label 1
    assert np.all(boundary[7, 2:-2] == 0)  # Middle of label 2


def test_window_level_transformation(slice_extractor):
    """Test window/level math"""
    # Create array with known values
    arr = np.array([[-500, -250, 0, 250, 500]], dtype=np.float32)
    
    # Apply window: level=0, width=400 (range: -200 to 200)
    windowed = slice_extractor._apply_window_level(arr, window_level=0, window_width=400)
    
    # Values outside window should be clipped
    assert windowed[0, 0] == 0    # -500 clipped to -200, maps to 0
    assert windowed[0, 4] == 255  # 500 clipped to 200, maps to 255
    
    # Value at window center should map to middle
    assert windowed[0, 2] == 127 or windowed[0, 2] == 128  # 0 maps to ~127.5


def test_extract_slice_orientations(slice_extractor):
    """Test extracting slices in different orientations"""
    volume = create_test_ct_volume(size=(10, 12, 14))
    
    # Axial (Z axis)
    png_axial = slice_extractor.extract_ct_slice(
        volume=volume, slice_index=7, orientation='axial'
    )
    image_axial = Image.open(BytesIO(png_axial))
    assert image_axial.size == (10, 12)  # X, Y dimensions
    
    # Sagittal (X axis)
    png_sagittal = slice_extractor.extract_ct_slice(
        volume=volume, slice_index=5, orientation='sagittal'
    )
    image_sagittal = Image.open(BytesIO(png_sagittal))
    assert image_sagittal.size == (12, 14)  # Y, Z dimensions
    
    # Coronal (Y axis)
    png_coronal = slice_extractor.extract_ct_slice(
        volume=volume, slice_index=6, orientation='coronal'
    )
    image_coronal = Image.open(BytesIO(png_coronal))
    assert image_coronal.size == (10, 14)  # X, Z dimensions


def test_extract_segmentation_invalid_index(slice_extractor):
    """Test error handling for invalid segmentation slice index"""
    volume = create_test_segmentation_volume(size=(10, 10, 10))
    
    # Try to extract out-of-range slice
    with pytest.raises(SliceExtractionError, match="out of range"):
        slice_extractor.extract_segmentation_slice(
            volume=volume,
            slice_index=15,  # Out of range
            orientation='axial'
        )


def test_boundary_extraction_preserves_labels(slice_extractor):
    """Test that boundary extraction preserves label values"""
    # Create segmentation with multiple labels
    arr = np.zeros((10, 10), dtype=np.uint8)
    arr[2:5, 2:5] = 3  # Label 3 in center
    arr[6:9, 6:9] = 7  # Label 7 in corner
    
    # Extract boundaries
    boundary = slice_extractor._extract_boundaries(arr)
    
    # Verify label values are preserved in boundaries
    unique_boundary_labels = np.unique(boundary[boundary > 0])
    assert 3 in unique_boundary_labels
    assert 7 in unique_boundary_labels


def test_boundary_extraction_ignores_background(slice_extractor):
    """Test that background (label 0) is not marked as boundary"""
    # Create segmentation with label surrounded by background
    arr = np.zeros((10, 10), dtype=np.uint8)
    arr[4:6, 4:6] = 1  # Small label in center
    
    # Extract boundaries
    boundary = slice_extractor._extract_boundaries(arr)
    
    # Background should remain 0
    assert boundary[0, 0] == 0
    assert boundary[9, 9] == 0
    
    # Only the label should have boundaries
    assert np.all(boundary[boundary > 0] == 1)
