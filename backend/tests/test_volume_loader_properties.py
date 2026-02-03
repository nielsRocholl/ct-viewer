"""Property-Based Tests for Volume Loader Service

**Feature: ct-segmentation-viewer, Property 1: File Format Loading Consistency**
**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

Property: For any valid medical image file in supported formats (.nii, .nii.gz, .mha, .mhd),
the system should successfully load the file using SimpleITK and extract complete metadata.
"""

import pytest
import numpy as np
import SimpleITK as sitk
from pathlib import Path
import tempfile
from hypothesis import given, strategies as st, settings, assume
from hypothesis import HealthCheck

from services.volume_loader import VolumeLoaderService, VolumeLoadError


# Strategy for generating valid 3D volume dimensions
# Keep dimensions reasonable to avoid memory issues
volume_dimensions = st.tuples(
    st.integers(min_value=2, max_value=100),  # x
    st.integers(min_value=2, max_value=100),  # y
    st.integers(min_value=2, max_value=100)   # z
)

# Strategy for generating valid spacing values
# Spacing must be positive
volume_spacing = st.tuples(
    st.floats(min_value=0.1, max_value=10.0, allow_nan=False, allow_infinity=False),
    st.floats(min_value=0.1, max_value=10.0, allow_nan=False, allow_infinity=False),
    st.floats(min_value=0.1, max_value=10.0, allow_nan=False, allow_infinity=False)
)

# Strategy for generating valid origin coordinates
volume_origin = st.tuples(
    st.floats(min_value=-1000.0, max_value=1000.0, allow_nan=False, allow_infinity=False),
    st.floats(min_value=-1000.0, max_value=1000.0, allow_nan=False, allow_infinity=False),
    st.floats(min_value=-1000.0, max_value=1000.0, allow_nan=False, allow_infinity=False)
)

# Strategy for supported file formats
file_formats = st.sampled_from(['.nii', '.nii.gz', '.mha', '.mhd'])


@pytest.fixture
def volume_loader():
    """Create a VolumeLoaderService instance"""
    return VolumeLoaderService()


@pytest.fixture
def temp_dir():
    """Create a temporary directory for test files"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


def create_volume_with_properties(dimensions, spacing, origin):
    """Create a SimpleITK volume with specified properties"""
    # Create volume with random data
    volume = sitk.Image(dimensions, sitk.sitkInt16)
    volume.SetSpacing(spacing)
    volume.SetOrigin(origin)
    
    # Fill with random data
    arr = np.random.randint(-1000, 1000, size=dimensions, dtype=np.int16)
    volume = sitk.GetImageFromArray(arr.transpose(2, 1, 0))
    volume.SetSpacing(spacing)
    volume.SetOrigin(origin)
    
    return volume


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    origin=volume_origin,
    file_format=file_formats
)
@pytest.mark.asyncio
async def test_property_file_format_loading_consistency(
    volume_loader,
    temp_dir,
    dimensions,
    spacing,
    origin,
    file_format
):
    """
    Property 1: File Format Loading Consistency
    
    For any valid medical image file in supported formats (.nii, .nii.gz, .mha, .mhd),
    the system should successfully load the file using SimpleITK and extract complete metadata.
    
    This property verifies that:
    1. All supported file formats can be loaded
    2. Metadata is correctly extracted (dimensions, spacing, origin, direction)
    3. The loaded volume matches the original properties
    """
    # Create a volume with the generated properties
    volume = create_volume_with_properties(dimensions, spacing, origin)
    
    # Write to file with the specified format
    file_path = temp_dir / f"test_volume{file_format}"
    sitk.WriteImage(volume, str(file_path))
    
    # Load the volume using the service
    metadata = await volume_loader.load_volume(str(file_path))
    
    # Verify that loading succeeded and metadata is complete
    assert metadata is not None, "Metadata should not be None"
    assert metadata.volume_id is not None, "Volume ID should be assigned"
    assert metadata.file_name == f"test_volume{file_format}", "File name should match"
    
    # Verify dimensions match exactly
    assert metadata.dimensions == dimensions, \
        f"Dimensions should match: expected {dimensions}, got {metadata.dimensions}"
    
    # Verify spacing matches (with tolerance for floating point round-trip through file I/O)
    for i in range(3):
        assert abs(metadata.spacing[i] - spacing[i]) < 1e-4, \
            f"Spacing[{i}] should match: expected {spacing[i]}, got {metadata.spacing[i]}"
    
    # Verify origin matches (with tolerance for floating point round-trip through file I/O)
    for i in range(3):
        assert abs(metadata.origin[i] - origin[i]) < 1e-4, \
            f"Origin[{i}] should match: expected {origin[i]}, got {metadata.origin[i]}"
    
    # Verify direction is present and has correct length (9 elements for 3D)
    assert len(metadata.direction) == 9, \
        f"Direction should have 9 elements for 3D, got {len(metadata.direction)}"
    
    # Verify other metadata fields are present
    assert metadata.pixel_type is not None, "Pixel type should be set"
    assert metadata.number_of_components > 0, "Number of components should be positive"
    assert metadata.size_bytes > 0, "Size in bytes should be positive"
    assert metadata.loaded_at is not None, "Loaded timestamp should be set"
    
    # Verify the volume can be retrieved from cache
    retrieved_volume = volume_loader.get_volume(metadata.volume_id)
    assert retrieved_volume is not None, "Volume should be retrievable from cache"
    assert retrieved_volume.GetSize() == dimensions, "Retrieved volume dimensions should match"
    
    # Clean up
    volume_loader.unload_volume(metadata.volume_id)


# Strategy for generating invalid dimensions (non-3D)
invalid_dimensions_2d = st.tuples(
    st.integers(min_value=2, max_value=100),  # x
    st.integers(min_value=2, max_value=100)   # y (only 2D)
)

# Strategy for 2D spacing
volume_spacing_2d = st.tuples(
    st.floats(min_value=0.1, max_value=10.0, allow_nan=False, allow_infinity=False),
    st.floats(min_value=0.1, max_value=10.0, allow_nan=False, allow_infinity=False)
)

invalid_dimensions_4d = st.tuples(
    st.integers(min_value=2, max_value=50),  # x
    st.integers(min_value=2, max_value=50),  # y
    st.integers(min_value=2, max_value=50),  # z
    st.integers(min_value=2, max_value=50)   # t (4D)
)


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    origin=volume_origin,
    file_format=file_formats
)
@pytest.mark.asyncio
async def test_property_3d_volume_validation(
    volume_loader,
    temp_dir,
    dimensions,
    spacing,
    origin,
    file_format
):
    """
    **Feature: ct-segmentation-viewer, Property 2: 3D Volume Validation**
    **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
    
    Property 2: 3D Volume Validation
    
    For any loaded volume file, the system should verify it has exactly three dimensions
    and extract all spatial metadata (spacing, origin, direction, size).
    
    This property verifies that:
    1. The system verifies the volume has exactly 3 dimensions (Req 2.1)
    2. The system extracts spacing values for all three axes (Req 2.2)
    3. The system extracts origin coordinates (Req 2.3)
    4. The system extracts the direction cosine matrix (Req 2.4)
    5. The system extracts the size in voxels for all three dimensions (Req 2.5)
    """
    # Create a 3D volume with the generated properties
    volume = create_volume_with_properties(dimensions, spacing, origin)
    
    # Write to file with the specified format
    file_path = temp_dir / f"test_3d_volume{file_format}"
    sitk.WriteImage(volume, str(file_path))
    
    # Load the volume using the service
    metadata = await volume_loader.load_volume(str(file_path))
    
    # Requirement 2.1: Verify the volume has exactly three dimensions
    assert len(metadata.dimensions) == 3, \
        f"Volume should have exactly 3 dimensions, got {len(metadata.dimensions)}"
    assert all(d > 0 for d in metadata.dimensions), \
        "All dimensions should be positive"
    
    # Requirement 2.5: Verify size in voxels for all three dimensions is extracted
    assert metadata.dimensions == dimensions, \
        f"Extracted dimensions should match original: expected {dimensions}, got {metadata.dimensions}"
    
    # Requirement 2.2: Verify spacing values for all three axes are extracted
    assert len(metadata.spacing) == 3, \
        f"Spacing should have 3 values, got {len(metadata.spacing)}"
    assert all(s > 0 for s in metadata.spacing), \
        "All spacing values should be positive"
    for i in range(3):
        assert abs(metadata.spacing[i] - spacing[i]) < 1e-4, \
            f"Spacing[{i}] should match: expected {spacing[i]}, got {metadata.spacing[i]}"
    
    # Requirement 2.3: Verify origin coordinates are extracted
    assert len(metadata.origin) == 3, \
        f"Origin should have 3 coordinates, got {len(metadata.origin)}"
    for i in range(3):
        assert abs(metadata.origin[i] - origin[i]) < 1e-4, \
            f"Origin[{i}] should match: expected {origin[i]}, got {metadata.origin[i]}"
    
    # Requirement 2.4: Verify direction cosine matrix is extracted
    assert len(metadata.direction) == 9, \
        f"Direction matrix should have 9 elements for 3D, got {len(metadata.direction)}"
    # Direction should be a valid rotation matrix (orthonormal)
    # For identity matrix (default), diagonal should be 1.0
    assert all(isinstance(d, float) for d in metadata.direction), \
        "All direction values should be floats"
    
    # Verify the loaded volume is actually 3D
    retrieved_volume = volume_loader.get_volume(metadata.volume_id)
    assert retrieved_volume.GetDimension() == 3, \
        f"Retrieved volume should be 3D, got {retrieved_volume.GetDimension()}D"
    
    # Clean up
    volume_loader.unload_volume(metadata.volume_id)


@settings(
    max_examples=50,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions_2d=invalid_dimensions_2d,
    spacing=volume_spacing_2d,
    file_format=file_formats
)
@pytest.mark.asyncio
async def test_property_3d_validation_rejects_2d(
    volume_loader,
    temp_dir,
    dimensions_2d,
    spacing,
    file_format
):
    """
    Property 2 (Edge Case): 3D Volume Validation - Reject 2D volumes
    
    For any 2D volume file, the system should reject it with an appropriate error
    indicating that only 3D volumes are supported.
    
    This verifies Requirement 2.1: The system SHALL verify the volume has exactly three dimensions.
    """
    # Create a 2D volume
    volume_2d = sitk.Image(dimensions_2d, sitk.sitkInt16)
    volume_2d.SetSpacing(spacing)
    
    # Fill with random data
    arr = np.random.randint(-1000, 1000, size=dimensions_2d, dtype=np.int16)
    volume_2d = sitk.GetImageFromArray(arr.transpose(1, 0))
    volume_2d.SetSpacing(spacing)
    
    # Write to file
    file_path = temp_dir / f"test_2d_volume{file_format}"
    sitk.WriteImage(volume_2d, str(file_path))
    
    # Attempt to load the 2D volume - should fail
    with pytest.raises(VolumeLoadError) as exc_info:
        await volume_loader.load_volume(str(file_path))
    
    # Verify the error message indicates dimensionality issue
    assert "3D" in str(exc_info.value) or "dimension" in str(exc_info.value).lower(), \
        f"Error message should mention dimensionality: {exc_info.value}"
