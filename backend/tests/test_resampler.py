"""Tests for Resampler Service"""

import pytest
import numpy as np
import SimpleITK as sitk

from services.resampler import ResamplerService, ResamplingError


@pytest.fixture
def resampler():
    """Create a ResamplerService instance"""
    return ResamplerService()


def create_test_volume(
    size=(10, 10, 10),
    spacing=(1.0, 1.0, 1.0),
    origin=(0.0, 0.0, 0.0),
    direction=None,
    pixel_type=sitk.sitkInt16
) -> sitk.Image:
    """Create a test 3D volume with specified geometry"""
    volume = sitk.Image(size, pixel_type)
    volume.SetSpacing(spacing)
    volume.SetOrigin(origin)
    
    if direction is not None:
        volume.SetDirection(direction)
    
    # Fill with some test data
    if pixel_type == sitk.sitkInt16:
        arr = np.random.randint(0, 1000, size=size, dtype=np.int16)
    else:
        arr = np.random.randint(0, 10, size=size, dtype=np.uint8)
    
    volume = sitk.GetImageFromArray(arr.transpose(2, 1, 0))
    volume.SetSpacing(spacing)
    volume.SetOrigin(origin)
    
    if direction is not None:
        volume.SetDirection(direction)
    
    return volume


def create_segmentation_volume(
    size=(10, 10, 10),
    spacing=(1.0, 1.0, 1.0),
    origin=(0.0, 0.0, 0.0),
    num_labels=3
) -> sitk.Image:
    """Create a test segmentation volume with multiple labels"""
    # Create array with random labels
    arr = np.random.randint(0, num_labels + 1, size=size, dtype=np.uint8)
    
    volume = sitk.GetImageFromArray(arr.transpose(2, 1, 0))
    volume.SetSpacing(spacing)
    volume.SetOrigin(origin)
    
    return volume


def test_resample_matching_geometry(resampler):
    """Test resampling when geometries already match"""
    # Create two volumes with identical geometry
    reference = create_test_volume(size=(10, 10, 10), spacing=(1.0, 1.0, 1.0))
    moving = create_test_volume(size=(10, 10, 10), spacing=(1.0, 1.0, 1.0))
    
    # Resample
    resampled = resampler.resample_to_reference(moving, reference)
    
    # Verify geometry matches
    assert resampled.GetSize() == reference.GetSize()
    assert resampled.GetSpacing() == reference.GetSpacing()
    assert resampled.GetOrigin() == reference.GetOrigin()
    assert resampled.GetDirection() == reference.GetDirection()


def test_resample_different_spacing(resampler):
    """Test resampling with different spacing"""
    # Create reference with 1mm spacing
    reference = create_test_volume(size=(20, 20, 20), spacing=(1.0, 1.0, 1.0))
    
    # Create moving with 2mm spacing (half the resolution)
    moving = create_test_volume(size=(10, 10, 10), spacing=(2.0, 2.0, 2.0))
    
    # Resample
    resampled = resampler.resample_to_reference(moving, reference)
    
    # Verify output matches reference geometry
    assert resampled.GetSize() == reference.GetSize()
    assert resampled.GetSpacing() == reference.GetSpacing()
    assert resampled.GetOrigin() == reference.GetOrigin()


def test_resample_different_origin(resampler):
    """Test resampling with different origin"""
    # Create reference with origin at (0, 0, 0)
    reference = create_test_volume(size=(10, 10, 10), origin=(0.0, 0.0, 0.0))
    
    # Create moving with different origin
    moving = create_test_volume(size=(10, 10, 10), origin=(10.0, 20.0, 30.0))
    
    # Resample
    resampled = resampler.resample_to_reference(moving, reference)
    
    # Verify output matches reference geometry
    assert resampled.GetSize() == reference.GetSize()
    assert resampled.GetOrigin() == reference.GetOrigin()


def test_resample_different_size(resampler):
    """Test resampling with different dimensions"""
    # Create reference with size 20x20x20
    reference = create_test_volume(size=(20, 20, 20), spacing=(1.0, 1.0, 1.0))
    
    # Create moving with size 10x10x10
    moving = create_test_volume(size=(10, 10, 10), spacing=(1.0, 1.0, 1.0))
    
    # Resample
    resampled = resampler.resample_to_reference(moving, reference)
    
    # Verify output matches reference size
    assert resampled.GetSize() == reference.GetSize()


def test_resample_segmentation_preserves_labels(resampler):
    """Test that nearest-neighbor interpolation preserves label values"""
    # Create reference CT
    reference = create_test_volume(size=(20, 20, 20), spacing=(1.0, 1.0, 1.0))
    
    # Create segmentation with specific labels
    segmentation = create_segmentation_volume(
        size=(20, 20, 20),
        spacing=(1.0, 1.0, 1.0),
        num_labels=5
    )
    
    # Get original unique labels
    seg_array = sitk.GetArrayFromImage(segmentation)
    original_labels = set(np.unique(seg_array))
    
    # Resample
    resampled = resampler.resample_segmentation_to_ct(segmentation, reference)
    
    # Get resampled labels
    resampled_array = sitk.GetArrayFromImage(resampled)
    resampled_labels = set(np.unique(resampled_array))
    
    # Verify labels are preserved (resampled should be subset of original)
    assert resampled_labels.issubset(original_labels)
    
    # Verify no new labels were introduced
    assert all(label in original_labels for label in resampled_labels)


def test_resample_with_different_interpolator(resampler):
    """Test resampling with a different interpolator"""
    reference = create_test_volume(size=(10, 10, 10))
    moving = create_test_volume(size=(10, 10, 10))
    
    # Resample with linear interpolation
    resampled = resampler.resample_to_reference(
        moving,
        reference,
        interpolator=sitk.sitkLinear
    )
    
    # Verify geometry matches
    assert resampled.GetSize() == reference.GetSize()
    assert resampled.GetSpacing() == reference.GetSpacing()


def test_resample_complex_geometry(resampler):
    """Test resampling with different spacing, origin, and size"""
    # Create reference with specific geometry
    reference = create_test_volume(
        size=(30, 40, 50),
        spacing=(0.5, 0.6, 0.7),
        origin=(10.0, 20.0, 30.0)
    )
    
    # Create moving with completely different geometry
    moving = create_test_volume(
        size=(15, 20, 25),
        spacing=(1.0, 1.2, 1.4),
        origin=(0.0, 0.0, 0.0)
    )
    
    # Resample
    resampled = resampler.resample_to_reference(moving, reference)
    
    # Verify all geometry parameters match reference
    assert resampled.GetSize() == reference.GetSize()
    assert pytest.approx(resampled.GetSpacing(), rel=1e-5) == reference.GetSpacing()
    assert pytest.approx(resampled.GetOrigin(), rel=1e-5) == reference.GetOrigin()
    assert resampled.GetDirection() == reference.GetDirection()


def test_resample_segmentation_to_ct_convenience_method(resampler):
    """Test the convenience method for resampling segmentation to CT"""
    # Create CT and segmentation with different geometries
    ct = create_test_volume(size=(20, 20, 20), spacing=(1.0, 1.0, 1.0))
    segmentation = create_segmentation_volume(
        size=(10, 10, 10),
        spacing=(2.0, 2.0, 2.0)
    )
    
    # Resample using convenience method
    resampled = resampler.resample_segmentation_to_ct(segmentation, ct)
    
    # Verify geometry matches CT
    assert resampled.GetSize() == ct.GetSize()
    assert resampled.GetSpacing() == ct.GetSpacing()
    assert resampled.GetOrigin() == ct.GetOrigin()


def test_resample_default_pixel_value(resampler):
    """Test that regions outside moving volume are filled with default value (0)"""
    # Create small moving volume
    moving = create_test_volume(size=(5, 5, 5), spacing=(1.0, 1.0, 1.0))
    
    # Create larger reference volume
    reference = create_test_volume(size=(10, 10, 10), spacing=(1.0, 1.0, 1.0))
    
    # Resample
    resampled = resampler.resample_to_reference(moving, reference)
    
    # Verify size matches reference
    assert resampled.GetSize() == reference.GetSize()
    
    # The resampled volume should have some zero values in regions
    # outside the original moving volume
    resampled_array = sitk.GetArrayFromImage(resampled)
    assert 0 in resampled_array  # Should have default value somewhere
