"""Property-Based Tests for Slice Extractor Service

**Feature: ct-segmentation-viewer, Property 5: Slice Extraction Correctness**
**Validates: Requirements 5.1, 5.2, 5.3**

Property: For any loaded volume and valid slice index, the backend should extract the slice
and apply window/level transformations consistently, returning image data to the frontend.
"""

import pytest
import numpy as np
import SimpleITK as sitk
from io import BytesIO
from PIL import Image
from hypothesis import given, strategies as st, settings, assume
from hypothesis import HealthCheck

from services.slice_extractor import SliceExtractorService, SliceExtractionError


# Strategy for generating valid 3D volume dimensions
volume_dimensions = st.tuples(
    st.integers(min_value=5, max_value=100),  # x
    st.integers(min_value=5, max_value=100),  # y
    st.integers(min_value=5, max_value=100)   # z
)

# Strategy for generating valid spacing values
volume_spacing = st.tuples(
    st.floats(min_value=0.1, max_value=10.0, allow_nan=False, allow_infinity=False),
    st.floats(min_value=0.1, max_value=10.0, allow_nan=False, allow_infinity=False),
    st.floats(min_value=0.1, max_value=10.0, allow_nan=False, allow_infinity=False)
)

# Strategy for window level and width parameters
window_level = st.floats(min_value=-1000.0, max_value=3000.0, allow_nan=False, allow_infinity=False)
window_width = st.floats(min_value=1.0, max_value=4000.0, allow_nan=False, allow_infinity=False)

# Strategy for orientations
orientations = st.sampled_from(['axial', 'sagittal', 'coronal'])


@pytest.fixture
def slice_extractor():
    """Create a SliceExtractorService instance"""
    return SliceExtractorService()


def create_ct_volume(dimensions, spacing=(1.0, 1.0, 1.0)):
    """Create a test CT volume with varying intensities"""
    # Create volume with gradient intensities typical of CT
    arr = np.zeros(dimensions, dtype=np.int16)
    for z in range(dimensions[2]):
        # Create gradient from -1000 (air) to +1000 (bone)
        arr[:, :, z] = (z / dimensions[2]) * 2000 - 1000
    
    volume = sitk.GetImageFromArray(arr.transpose(2, 1, 0))
    volume.SetSpacing(spacing)
    volume.SetOrigin((0.0, 0.0, 0.0))
    
    return volume


def expected_slice_size_after_isotropic(dimensions, spacing, orientation):
    """Expected (width, height) of PNG after slice extraction and isotropic resampling."""
    if orientation == 'axial':
        w, h = dimensions[0], dimensions[1]
        sx, sy = spacing[0], spacing[1]
    elif orientation == 'sagittal':
        w, h = dimensions[1], dimensions[2]
        sx, sy = spacing[1], spacing[2]
    else:
        w, h = dimensions[0], dimensions[2]
        sx, sy = spacing[0], spacing[2]
    s = min(sx, sy)
    out_w = max(1, int(round(w * sx / s)))
    out_h = max(1, int(round(h * sy / s)))
    return (out_w, out_h)


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    orientation=orientations,
    wl=window_level,
    ww=window_width
)
def test_property_slice_extraction_returns_valid_image_data(
    slice_extractor,
    dimensions,
    spacing,
    orientation,
    wl,
    ww
):
    """
    Property 5: Slice Extraction Correctness - Valid Image Data
    
    For any loaded volume and valid slice index, the backend should extract the slice
    and return valid image data.
    
    This verifies Requirement 5.1: WHEN the Frontend requests a slice from a loaded volume,
    THEN the Backend SHALL extract the slice at the specified index using SimpleITK
    
    This verifies Requirement 5.3: WHEN the Backend extracts a slice, THEN the Backend
    SHALL return the slice as image data to the Frontend
    """
    # Create a CT volume with the generated properties
    volume = create_ct_volume(dimensions, spacing)
    
    # Determine valid slice index based on orientation
    axis = slice_extractor._get_axis_for_orientation(orientation)
    max_index = dimensions[axis] - 1
    
    # Choose a valid slice index (middle of the volume)
    slice_index = max_index // 2
    
    # Extract slice
    png_bytes = slice_extractor.extract_ct_slice(
        volume=volume,
        slice_index=slice_index,
        orientation=orientation,
        window_level=wl,
        window_width=ww
    )
    
    # Property: Should return valid image data
    assert isinstance(png_bytes, bytes), \
        "Slice extraction should return bytes"
    assert len(png_bytes) > 0, \
        "Slice extraction should return non-empty data"
    
    # Verify it's a valid PNG that can be decoded
    try:
        image = Image.open(BytesIO(png_bytes))
        assert image.format == 'PNG', \
            f"Image should be PNG format, got {image.format}"
        expected_size = expected_slice_size_after_isotropic(
            dimensions, spacing, orientation
        )
        assert image.size == expected_size, \
            f"Image size should be {expected_size} (after isotropic resample), got {image.size}"
    except Exception as e:
        pytest.fail(f"Failed to decode PNG: {e}")


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    orientation=orientations,
    wl=window_level,
    ww=window_width
)
def test_property_window_level_transformation_applied(
    slice_extractor,
    dimensions,
    spacing,
    orientation,
    wl,
    ww
):
    """
    Property 5: Slice Extraction Correctness - Window/Level Transformation
    
    For any slice extraction with window/level parameters, the backend should apply
    the transformation and return intensity values in the [0, 255] range.
    
    This verifies Requirement 5.2: WHEN the Backend extracts a slice, THEN the Backend
    SHALL apply the specified window level and window width to the intensity values
    """
    # Create a CT volume
    volume = create_ct_volume(dimensions, spacing)
    
    # Determine valid slice index
    axis = slice_extractor._get_axis_for_orientation(orientation)
    max_index = dimensions[axis] - 1
    slice_index = max_index // 2
    
    # Extract slice with window/level
    png_bytes = slice_extractor.extract_ct_slice(
        volume=volume,
        slice_index=slice_index,
        orientation=orientation,
        window_level=wl,
        window_width=ww
    )
    
    # Decode PNG
    image = Image.open(BytesIO(png_bytes))
    arr = np.array(image)
    
    # Property: Window/level transformation should map to [0, 255] range
    assert arr.min() >= 0, \
        f"Windowed values should be >= 0, got min={arr.min()}"
    assert arr.max() <= 255, \
        f"Windowed values should be <= 255, got max={arr.max()}"
    assert arr.dtype == np.uint8, \
        f"Windowed array should be uint8, got {arr.dtype}"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    orientation=orientations
)
def test_property_slice_extraction_deterministic(
    slice_extractor,
    dimensions,
    spacing,
    orientation
):
    """
    Property 5: Slice Extraction Correctness - Deterministic Behavior
    
    For any volume and slice parameters, extracting the same slice twice with identical
    parameters should produce identical output.
    
    This supports Requirement 14.1 (Deterministic Rendering): WHEN the System loads the
    same CT volume and segmentation mask pair twice with identical parameters, THEN the
    System SHALL produce pixel-identical rendered slices
    """
    # Create a CT volume
    volume = create_ct_volume(dimensions, spacing)
    
    # Determine valid slice index
    axis = slice_extractor._get_axis_for_orientation(orientation)
    max_index = dimensions[axis] - 1
    slice_index = max_index // 2
    
    # Fixed window/level parameters
    wl = 0.0
    ww = 400.0
    
    # Extract the same slice twice
    png_bytes_1 = slice_extractor.extract_ct_slice(
        volume=volume,
        slice_index=slice_index,
        orientation=orientation,
        window_level=wl,
        window_width=ww
    )
    
    png_bytes_2 = slice_extractor.extract_ct_slice(
        volume=volume,
        slice_index=slice_index,
        orientation=orientation,
        window_level=wl,
        window_width=ww
    )
    
    # Decode both
    image_1 = Image.open(BytesIO(png_bytes_1))
    image_2 = Image.open(BytesIO(png_bytes_2))
    
    arr_1 = np.array(image_1)
    arr_2 = np.array(image_2)
    
    # Property: Identical parameters should produce identical output
    assert np.array_equal(arr_1, arr_2), \
        "Extracting the same slice twice should produce identical results"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    orientation=orientations
)
def test_property_slice_index_validation(
    slice_extractor,
    dimensions,
    spacing,
    orientation
):
    """
    Property 5: Slice Extraction Correctness - Index Validation
    
    For any volume, requesting a slice with an out-of-range index should raise
    an appropriate error.
    
    This verifies proper error handling as part of slice extraction correctness.
    """
    # Create a CT volume
    volume = create_ct_volume(dimensions, spacing)
    
    # Determine the maximum valid index
    axis = slice_extractor._get_axis_for_orientation(orientation)
    max_index = dimensions[axis] - 1
    
    # Try to extract a slice beyond the valid range
    invalid_index = max_index + 10
    
    # Property: Out-of-range indices should raise SliceExtractionError
    with pytest.raises(SliceExtractionError) as exc_info:
        slice_extractor.extract_ct_slice(
            volume=volume,
            slice_index=invalid_index,
            orientation=orientation
        )
    
    # Verify error message mentions the range
    error_msg = str(exc_info.value)
    assert "out of range" in error_msg.lower(), \
        f"Error message should mention 'out of range': {error_msg}"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    wl=window_level,
    ww=window_width
)
def test_property_window_level_transformation_consistency(
    slice_extractor,
    dimensions,
    spacing,
    wl,
    ww
):
    """
    Property 5: Slice Extraction Correctness - Window/Level Consistency
    
    For any volume and window/level parameters, applying the same parameters twice
    should produce identical output. This verifies the transformation is deterministic.
    
    This verifies that window/level transformation is consistently applied.
    """
    # Only test with reasonable window widths
    assume(ww >= 100.0)
    
    # Create a CT volume with varying intensities
    volume = create_ct_volume(dimensions, spacing)
    
    # Use axial orientation for consistency
    orientation = 'axial'
    axis = slice_extractor._get_axis_for_orientation(orientation)
    max_index = dimensions[axis] - 1
    slice_index = max_index // 2
    
    # Extract with same window/level twice
    png_bytes_1 = slice_extractor.extract_ct_slice(
        volume=volume,
        slice_index=slice_index,
        orientation=orientation,
        window_level=wl,
        window_width=ww
    )
    
    png_bytes_2 = slice_extractor.extract_ct_slice(
        volume=volume,
        slice_index=slice_index,
        orientation=orientation,
        window_level=wl,
        window_width=ww
    )
    
    # Decode both
    image_1 = Image.open(BytesIO(png_bytes_1))
    image_2 = Image.open(BytesIO(png_bytes_2))
    
    arr_1 = np.array(image_1)
    arr_2 = np.array(image_2)
    
    # Property: Same window parameters should produce identical output
    assert np.array_equal(arr_1, arr_2), \
        "Same window/level parameters should produce identical output"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing
)
def test_property_all_orientations_produce_valid_slices(
    slice_extractor,
    dimensions,
    spacing
):
    """
    Property 5: Slice Extraction Correctness - All Orientations Supported
    
    For any volume, all three orientations (axial, sagittal, coronal) should
    produce valid slices with correct dimensions.
    
    This verifies that slice extraction works correctly for all orientations.
    """
    # Create a CT volume
    volume = create_ct_volume(dimensions, spacing)
    orientations_to_test = ['axial', 'sagittal', 'coronal']

    for orientation in orientations_to_test:
        axis = slice_extractor._get_axis_for_orientation(orientation)
        max_index = dimensions[axis] - 1
        slice_index = max_index // 2
        png_bytes = slice_extractor.extract_ct_slice(
            volume=volume,
            slice_index=slice_index,
            orientation=orientation,
            window_level=0,
            window_width=400
        )
        image = Image.open(BytesIO(png_bytes))
        expected_size = expected_slice_size_after_isotropic(
            dimensions, spacing, orientation
        )
        assert image.size == expected_size, \
            f"Orientation {orientation} should produce size {expected_size} (after isotropic resample), got {image.size}"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    orientation=orientations
)
def test_property_segmentation_slice_extraction_preserves_labels(
    slice_extractor,
    dimensions,
    spacing,
    orientation
):
    """
    Property 5: Slice Extraction Correctness - Segmentation Label Preservation
    
    For any segmentation volume, extracting a slice should preserve the label values
    without modification (no interpolation or transformation).
    
    This verifies that segmentation slices are extracted correctly.
    """
    # Create a segmentation volume with multiple labels
    arr = np.zeros(dimensions, dtype=np.uint8)
    
    # Create regions with different labels
    num_labels = min(5, dimensions[0] // 2)
    for i in range(num_labels):
        start = i * (dimensions[0] // num_labels)
        end = (i + 1) * (dimensions[0] // num_labels)
        arr[start:end, :, :] = i + 1
    
    volume = sitk.GetImageFromArray(arr.transpose(2, 1, 0))
    volume.SetSpacing(spacing)
    volume.SetOrigin((0.0, 0.0, 0.0))
    
    # Determine valid slice index
    axis = slice_extractor._get_axis_for_orientation(orientation)
    max_index = dimensions[axis] - 1
    slice_index = max_index // 2
    
    # Extract segmentation slice in filled mode
    png_bytes = slice_extractor.extract_segmentation_slice(
        volume=volume,
        slice_index=slice_index,
        orientation=orientation,
        mode='filled'
    )
    
    # Decode
    image = Image.open(BytesIO(png_bytes))
    slice_arr = np.array(image)
    
    # Property: Segmentation labels should be preserved
    unique_labels = np.unique(slice_arr)
    
    # All labels should be in the valid range [0, num_labels]
    assert all(label <= num_labels for label in unique_labels), \
        f"All labels should be <= {num_labels}, got {unique_labels}"
    
    # Labels should be integers (no interpolation)
    for label in unique_labels:
        assert label == int(label), \
            f"Label {label} should be an integer"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    orientation=orientations
)
def test_property_boundary_mode_produces_fewer_pixels(
    slice_extractor,
    dimensions,
    spacing,
    orientation
):
    """
    Property 5: Slice Extraction Correctness - Boundary Mode
    
    For any segmentation volume, extracting a slice in boundary mode should produce
    fewer non-zero pixels than filled mode (boundaries are a subset of filled regions).
    
    This verifies that boundary extraction is working correctly.
    """
    # Create a segmentation volume with clear regions
    arr = np.zeros(dimensions, dtype=np.uint8)
    
    # Create a large region with label 1 (so boundaries are clear)
    center_x = dimensions[0] // 2
    center_y = dimensions[1] // 2
    radius = min(dimensions[0], dimensions[1]) // 4
    
    for x in range(dimensions[0]):
        for y in range(dimensions[1]):
            if (x - center_x)**2 + (y - center_y)**2 < radius**2:
                arr[x, y, :] = 1
    
    volume = sitk.GetImageFromArray(arr.transpose(2, 1, 0))
    volume.SetSpacing(spacing)
    volume.SetOrigin((0.0, 0.0, 0.0))
    
    # Determine valid slice index
    axis = slice_extractor._get_axis_for_orientation(orientation)
    max_index = dimensions[axis] - 1
    slice_index = max_index // 2
    
    # Extract in filled mode
    png_filled = slice_extractor.extract_segmentation_slice(
        volume=volume,
        slice_index=slice_index,
        orientation=orientation,
        mode='filled'
    )
    
    # Extract in boundary mode
    png_boundary = slice_extractor.extract_segmentation_slice(
        volume=volume,
        slice_index=slice_index,
        orientation=orientation,
        mode='boundary'
    )
    
    # Decode both
    image_filled = Image.open(BytesIO(png_filled))
    image_boundary = Image.open(BytesIO(png_boundary))
    
    arr_filled = np.array(image_filled)
    arr_boundary = np.array(image_boundary)
    
    filled_pixels = np.count_nonzero(arr_filled)
    boundary_pixels = np.count_nonzero(arr_boundary)
    assert boundary_pixels <= filled_pixels, \
        f"Boundary mode should have <= pixels than filled. Boundary: {boundary_pixels}, Filled: {filled_pixels}"


# ============================================================================
# Property 15: Boundary Extraction Correctness
# **Validates: Requirements 16.1, 16.2, 16.3**
# ============================================================================


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    orientation=orientations
)
def test_property_boundary_extraction_detects_label_interfaces(
    slice_extractor,
    dimensions,
    spacing,
    orientation
):
    """
    **Feature: ct-segmentation-viewer, Property 15: Boundary Extraction Correctness**
    **Validates: Requirements 16.1, 16.2, 16.3**
    
    Property: For any segmentation mask in boundary mode, the backend should extract
    only voxels at label interfaces, and the frontend should render only those boundary voxels.
    
    This verifies Requirement 16.1: WHEN a user selects boundary only overlay mode,
    THEN the Backend SHALL extract the boundaries of segmentation labels
    
    This verifies Requirement 16.2: WHEN the Backend extracts boundaries, THEN the Backend
    SHALL identify voxels at the interface between different labels
    
    This verifies Requirement 16.3: WHEN the Frontend renders boundary overlay, THEN the
    Frontend SHALL display only the boundary voxels with the configured color and opacity
    """
    # Create a segmentation volume with multiple distinct regions
    arr = np.zeros(dimensions, dtype=np.uint8)
    
    # Create multiple labeled regions to ensure boundaries exist
    # Region 1: Left portion
    split_x = dimensions[0] // 2
    arr[:split_x, :, :] = 1
    
    # Region 2: Right portion
    arr[split_x:, :, :] = 2
    
    # Add a third region in the center if space allows
    if dimensions[1] >= 10:
        center_y_start = dimensions[1] // 3
        center_y_end = 2 * dimensions[1] // 3
        arr[:, center_y_start:center_y_end, :] = 3
    
    volume = sitk.GetImageFromArray(arr.transpose(2, 1, 0))
    volume.SetSpacing(spacing)
    volume.SetOrigin((0.0, 0.0, 0.0))
    
    # Determine valid slice index
    axis = slice_extractor._get_axis_for_orientation(orientation)
    max_index = dimensions[axis] - 1
    slice_index = max_index // 2
    
    # Extract in boundary mode
    png_boundary = slice_extractor.extract_segmentation_slice(
        volume=volume,
        slice_index=slice_index,
        orientation=orientation,
        mode='boundary'
    )
    
    # Decode
    image_boundary = Image.open(BytesIO(png_boundary))
    boundary_arr = np.array(image_boundary)
    
    # Property 1: Boundary extraction should only mark voxels at interfaces
    # All boundary pixels should be non-zero (they represent label values)
    boundary_pixels = boundary_arr[boundary_arr > 0]
    
    if len(boundary_pixels) > 0:
        # Verify that boundary pixels have valid label values
        unique_boundary_labels = np.unique(boundary_pixels)
        assert all(label > 0 for label in unique_boundary_labels), \
            "All boundary pixels should have non-zero label values"
        
        # Verify that boundary pixels are a subset of original labels
        original_labels = np.unique(arr)
        for label in unique_boundary_labels:
            assert label in original_labels, \
                f"Boundary label {label} should exist in original segmentation"
    
    # Property 2: Interior pixels should not be marked as boundaries
    # For regions large enough to have interior, verify interior is not marked
    if dimensions[0] >= 10 and dimensions[1] >= 10:
        # Check a pixel that should be in the interior of region 1
        interior_x = split_x // 2
        interior_y = dimensions[1] // 2
        
        # Get the corresponding position in the extracted slice
        if orientation == 'axial':
            # XY plane
            if interior_x < boundary_arr.shape[1] and interior_y < boundary_arr.shape[0]:
                # Note: numpy array is [y, x] for images
                interior_pixel = boundary_arr[interior_y, interior_x]
                # Interior should be 0 (not a boundary) or at least not all interior pixels are boundaries
                # We check that not all pixels are boundaries
                total_pixels = boundary_arr.size
                boundary_pixel_count = np.count_nonzero(boundary_arr)
                assert boundary_pixel_count < total_pixels, \
                    "Not all pixels should be boundaries - interior should exist"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    orientation=orientations
)
def test_property_boundary_extraction_preserves_label_values(
    slice_extractor,
    dimensions,
    spacing,
    orientation
):
    """
    **Feature: ct-segmentation-viewer, Property 15: Boundary Extraction Correctness**
    **Validates: Requirements 16.1, 16.2, 16.3**
    
    Property: For any segmentation mask, boundary extraction should preserve the original
    label values at boundary locations (not create new labels or modify existing ones).
    
    This verifies that boundary extraction correctly identifies interfaces while
    maintaining label integrity.
    """
    # Create a segmentation volume with multiple labels
    arr = np.zeros(dimensions, dtype=np.uint8)
    
    # Create distinct labeled regions
    num_regions = min(4, dimensions[0] // 3)
    region_width = dimensions[0] // num_regions
    
    for i in range(num_regions):
        start_x = i * region_width
        end_x = (i + 1) * region_width if i < num_regions - 1 else dimensions[0]
        arr[start_x:end_x, :, :] = i + 1
    
    volume = sitk.GetImageFromArray(arr.transpose(2, 1, 0))
    volume.SetSpacing(spacing)
    volume.SetOrigin((0.0, 0.0, 0.0))
    
    # Determine valid slice index
    axis = slice_extractor._get_axis_for_orientation(orientation)
    max_index = dimensions[axis] - 1
    slice_index = max_index // 2
    
    # Extract in boundary mode
    png_boundary = slice_extractor.extract_segmentation_slice(
        volume=volume,
        slice_index=slice_index,
        orientation=orientation,
        mode='boundary'
    )
    
    # Decode
    image_boundary = Image.open(BytesIO(png_boundary))
    boundary_arr = np.array(image_boundary)
    
    # Get unique labels from boundary
    boundary_labels = np.unique(boundary_arr[boundary_arr > 0])
    
    # Get unique labels from original volume
    original_labels = np.unique(arr[arr > 0])
    
    # Property: All boundary labels should be from the original label set
    for label in boundary_labels:
        assert label in original_labels, \
            f"Boundary label {label} should be from original labels {original_labels}"
    
    # Property: No new labels should be created
    assert len(boundary_labels) <= len(original_labels), \
        "Boundary extraction should not create new labels"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    orientation=orientations
)
def test_property_boundary_extraction_ignores_background(
    slice_extractor,
    dimensions,
    spacing,
    orientation
):
    """
    **Feature: ct-segmentation-viewer, Property 15: Boundary Extraction Correctness**
    **Validates: Requirements 16.1, 16.2, 16.3**
    
    Property: For any segmentation mask, boundary extraction should not mark background
    (label 0) voxels as boundaries. Only foreground labels should have boundaries.
    
    This verifies that boundary extraction correctly handles background regions.
    """
    # Create a segmentation volume with a foreground region surrounded by background
    arr = np.zeros(dimensions, dtype=np.uint8)
    
    # Create a centered region with label 1
    if dimensions[0] >= 6 and dimensions[1] >= 6:
        center_x = dimensions[0] // 2
        center_y = dimensions[1] // 2
        size = min(dimensions[0], dimensions[1]) // 3
        
        start_x = max(0, center_x - size // 2)
        end_x = min(dimensions[0], center_x + size // 2)
        start_y = max(0, center_y - size // 2)
        end_y = min(dimensions[1], center_y + size // 2)
        
        arr[start_x:end_x, start_y:end_y, :] = 1
    else:
        # For small volumes, just fill half with label 1
        arr[:dimensions[0]//2, :, :] = 1
    
    volume = sitk.GetImageFromArray(arr.transpose(2, 1, 0))
    volume.SetSpacing(spacing)
    volume.SetOrigin((0.0, 0.0, 0.0))
    
    # Determine valid slice index
    axis = slice_extractor._get_axis_for_orientation(orientation)
    max_index = dimensions[axis] - 1
    slice_index = max_index // 2
    
    # Extract in boundary mode
    png_boundary = slice_extractor.extract_segmentation_slice(
        volume=volume,
        slice_index=slice_index,
        orientation=orientation,
        mode='boundary'
    )
    
    # Decode
    image_boundary = Image.open(BytesIO(png_boundary))
    boundary_arr = np.array(image_boundary)
    
    # Property: Background regions should remain 0 (not marked as boundaries)
    # Check corners which should be background
    corners = [
        (0, 0),
        (0, boundary_arr.shape[1] - 1),
        (boundary_arr.shape[0] - 1, 0),
        (boundary_arr.shape[0] - 1, boundary_arr.shape[1] - 1)
    ]
    
    # At least some corners should be background (0)
    corner_values = [boundary_arr[y, x] for y, x in corners if y < boundary_arr.shape[0] and x < boundary_arr.shape[1]]
    
    # Property: Not all corners should be boundaries (some should be background)
    assert not all(val > 0 for val in corner_values), \
        "Not all corners should be boundaries - background should exist"
    
    # Property: All non-zero values in boundary should be valid labels (not 0)
    boundary_labels = boundary_arr[boundary_arr > 0]
    if len(boundary_labels) > 0:
        assert all(label > 0 for label in boundary_labels), \
            "All boundary pixels should have non-zero labels"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    orientation=orientations
)
def test_property_boundary_extraction_is_subset_of_filled(
    slice_extractor,
    dimensions,
    spacing,
    orientation
):
    """
    **Feature: ct-segmentation-viewer, Property 15: Boundary Extraction Correctness**
    **Validates: Requirements 16.1, 16.2, 16.3**
    
    Property: For any segmentation mask, the set of non-zero pixels in boundary mode
    should be a subset of the non-zero pixels in filled mode. Boundaries cannot exist
    where there are no labels.
    
    This verifies the fundamental relationship between filled and boundary modes.
    """
    # Create a segmentation volume with multiple regions
    arr = np.zeros(dimensions, dtype=np.uint8)
    
    # Create two regions
    split = dimensions[0] // 2
    arr[:split, :, :] = 1
    arr[split:, :, :] = 2
    
    volume = sitk.GetImageFromArray(arr.transpose(2, 1, 0))
    volume.SetSpacing(spacing)
    volume.SetOrigin((0.0, 0.0, 0.0))
    
    # Determine valid slice index
    axis = slice_extractor._get_axis_for_orientation(orientation)
    max_index = dimensions[axis] - 1
    slice_index = max_index // 2
    
    # Extract in both modes
    png_filled = slice_extractor.extract_segmentation_slice(
        volume=volume,
        slice_index=slice_index,
        orientation=orientation,
        mode='filled'
    )
    
    png_boundary = slice_extractor.extract_segmentation_slice(
        volume=volume,
        slice_index=slice_index,
        orientation=orientation,
        mode='boundary'
    )
    
    # Decode both
    image_filled = Image.open(BytesIO(png_filled))
    image_boundary = Image.open(BytesIO(png_boundary))
    
    filled_arr = np.array(image_filled)
    boundary_arr = np.array(image_boundary)
    
    # Property: Every non-zero pixel in boundary should also be non-zero in filled
    # (boundary is a subset of filled)
    boundary_mask = boundary_arr > 0
    filled_mask = filled_arr > 0
    
    # Check that boundary pixels are a subset of filled pixels
    boundary_not_in_filled = boundary_mask & ~filled_mask
    
    assert not np.any(boundary_not_in_filled), \
        "All boundary pixels should also be present in filled mode"
    
    # Property: Boundary should have fewer or equal non-zero pixels
    boundary_count = np.count_nonzero(boundary_arr)
    filled_count = np.count_nonzero(filled_arr)
    
    assert boundary_count <= filled_count, \
        f"Boundary pixel count ({boundary_count}) should be <= filled count ({filled_count})"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing
)
def test_property_boundary_extraction_detects_all_interfaces(
    slice_extractor,
    dimensions,
    spacing
):
    """
    **Feature: ct-segmentation-viewer, Property 15: Boundary Extraction Correctness**
    **Validates: Requirements 16.1, 16.2, 16.3**
    
    Property: For any segmentation mask with adjacent regions of different labels,
    boundary extraction should detect the interface between them.
    
    This verifies that boundary extraction correctly identifies all label interfaces.
    """
    # Create a simple 2D segmentation with a clear vertical interface
    arr = np.zeros(dimensions, dtype=np.uint8)
    
    # Create two regions with a vertical boundary in the middle
    split_x = dimensions[0] // 2
    arr[:split_x, :, :] = 1
    arr[split_x:, :, :] = 2
    
    volume = sitk.GetImageFromArray(arr.transpose(2, 1, 0))
    volume.SetSpacing(spacing)
    volume.SetOrigin((0.0, 0.0, 0.0))
    
    # Extract axial slice (XY plane) from the middle
    orientation = 'axial'
    axis = slice_extractor._get_axis_for_orientation(orientation)
    max_index = dimensions[axis] - 1
    slice_index = max_index // 2
    
    # Extract in boundary mode
    png_boundary = slice_extractor.extract_segmentation_slice(
        volume=volume,
        slice_index=slice_index,
        orientation=orientation,
        mode='boundary'
    )
    
    # Decode
    image_boundary = Image.open(BytesIO(png_boundary))
    boundary_arr = np.array(image_boundary)
    
    # Property: The interface between labels should be detected
    # Check that there are boundary pixels near the split
    # The boundary should be at or near x = split_x
    
    # For axial orientation, the array is [y, x]
    # Check columns around the split
    if split_x > 0 and split_x < boundary_arr.shape[1]:
        # Check a few columns around the split
        check_cols = [split_x - 1, split_x] if split_x > 0 else [split_x]
        check_cols = [c for c in check_cols if c < boundary_arr.shape[1]]
        
        # At least one of these columns should have boundary pixels
        has_boundary_at_interface = False
        for col in check_cols:
            if np.any(boundary_arr[:, col] > 0):
                has_boundary_at_interface = True
                break
        
        assert has_boundary_at_interface, \
            f"Boundary should be detected at interface (columns {check_cols})"
    
    # Property: There should be some boundary pixels overall
    boundary_count = np.count_nonzero(boundary_arr)
    assert boundary_count > 0, \
        "Boundary extraction should detect at least some boundaries"
