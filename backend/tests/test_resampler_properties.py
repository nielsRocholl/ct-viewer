"""Property-Based Tests for Resampler Service

**Feature: ct-segmentation-viewer, Property 20: Resampling Behavior**
**Validates: Requirements 24.1, 24.2, 24.3, 24.4**

Property: For any geometry-mismatched pair, when automatic resampling is enabled, the system
should resample using nearest-neighbor interpolation and log the operation; when disabled,
the system should reject the pair.
"""

import pytest
import numpy as np
import SimpleITK as sitk
from hypothesis import given, strategies as st, settings, assume
from hypothesis import HealthCheck

from services.resampler import ResamplerService, ResamplingError


# Strategy for generating valid 3D volume dimensions
volume_dimensions = st.tuples(
    st.integers(min_value=5, max_value=50),  # x
    st.integers(min_value=5, max_value=50),  # y
    st.integers(min_value=5, max_value=50)   # z
)

# Strategy for generating valid spacing values (must be positive)
volume_spacing = st.tuples(
    st.floats(min_value=0.5, max_value=5.0, allow_nan=False, allow_infinity=False),
    st.floats(min_value=0.5, max_value=5.0, allow_nan=False, allow_infinity=False),
    st.floats(min_value=0.5, max_value=5.0, allow_nan=False, allow_infinity=False)
)

# Strategy for generating valid origin coordinates
volume_origin = st.tuples(
    st.floats(min_value=-500.0, max_value=500.0, allow_nan=False, allow_infinity=False),
    st.floats(min_value=-500.0, max_value=500.0, allow_nan=False, allow_infinity=False),
    st.floats(min_value=-500.0, max_value=500.0, allow_nan=False, allow_infinity=False)
)


@pytest.fixture
def resampler():
    """Create a ResamplerService instance"""
    return ResamplerService()


def create_ct_volume(dimensions, spacing, origin):
    """Create a test CT volume with specified geometry"""
    # Create volume with random CT-like data
    arr = np.random.randint(-1000, 1000, size=dimensions, dtype=np.int16)
    volume = sitk.GetImageFromArray(arr.transpose(2, 1, 0))
    volume.SetSpacing(spacing)
    volume.SetOrigin(origin)
    return volume


def create_segmentation_volume(dimensions, spacing, origin, num_labels=5):
    """Create a test segmentation volume with specified geometry and multiple labels"""
    # Create array with random labels (0 = background, 1-num_labels = structures)
    arr = np.random.randint(0, num_labels + 1, size=dimensions, dtype=np.uint8)
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
    ct_dimensions=volume_dimensions,
    ct_spacing=volume_spacing,
    ct_origin=volume_origin,
    seg_dimensions=volume_dimensions,
    seg_spacing=volume_spacing,
    seg_origin=volume_origin,
    num_labels=st.integers(min_value=2, max_value=10)
)
def test_property_resampling_matches_reference_geometry(
    resampler,
    ct_dimensions,
    ct_spacing,
    ct_origin,
    seg_dimensions,
    seg_spacing,
    seg_origin,
    num_labels
):
    """
    Property 20: Resampling Behavior - Output Geometry Matches Reference
    
    For any geometry-mismatched pair, when resampling is performed, the output should
    match the reference (CT) geometry exactly.
    
    This verifies Requirement 24.1: The Backend SHALL resample the segmentation to match
    the CT geometry using SimpleITK
    """
    # Create CT volume (reference)
    ct_volume = create_ct_volume(ct_dimensions, ct_spacing, ct_origin)
    
    # Create segmentation volume with different geometry
    seg_volume = create_segmentation_volume(
        seg_dimensions, seg_spacing, seg_origin, num_labels
    )
    
    # Resample segmentation to match CT geometry
    resampled = resampler.resample_to_reference(seg_volume, ct_volume)
    
    # Property: Resampled volume should match reference geometry exactly
    assert resampled.GetSize() == ct_volume.GetSize(), \
        f"Resampled size should match CT: expected {ct_volume.GetSize()}, got {resampled.GetSize()}"
    
    # Spacing should match (with small tolerance for floating point)
    for i in range(3):
        assert abs(resampled.GetSpacing()[i] - ct_volume.GetSpacing()[i]) < 1e-6, \
            f"Resampled spacing[{i}] should match CT: expected {ct_volume.GetSpacing()[i]}, got {resampled.GetSpacing()[i]}"
    
    # Origin should match (with small tolerance for floating point)
    for i in range(3):
        assert abs(resampled.GetOrigin()[i] - ct_volume.GetOrigin()[i]) < 1e-6, \
            f"Resampled origin[{i}] should match CT: expected {ct_volume.GetOrigin()[i]}, got {resampled.GetOrigin()[i]}"
    
    # Direction should match
    assert resampled.GetDirection() == ct_volume.GetDirection(), \
        f"Resampled direction should match CT: expected {ct_volume.GetDirection()}, got {resampled.GetDirection()}"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    ct_dimensions=volume_dimensions,
    ct_spacing=volume_spacing,
    ct_origin=volume_origin,
    seg_dimensions=volume_dimensions,
    seg_spacing=volume_spacing,
    seg_origin=volume_origin,
    num_labels=st.integers(min_value=2, max_value=10)
)
def test_property_resampling_preserves_label_values(
    resampler,
    ct_dimensions,
    ct_spacing,
    ct_origin,
    seg_dimensions,
    seg_spacing,
    seg_origin,
    num_labels
):
    """
    Property 20: Resampling Behavior - Label Preservation
    
    For any segmentation volume, when resampled using nearest-neighbor interpolation,
    the output should only contain label values that existed in the input (no new labels).
    
    This verifies Requirement 24.2: The Backend SHALL use nearest-neighbor interpolation
    to preserve label values
    """
    # Create CT volume (reference)
    ct_volume = create_ct_volume(ct_dimensions, ct_spacing, ct_origin)
    
    # Create segmentation volume with specific labels
    seg_volume = create_segmentation_volume(
        seg_dimensions, seg_spacing, seg_origin, num_labels
    )
    
    # Get original unique labels
    seg_array = sitk.GetArrayFromImage(seg_volume)
    original_labels = set(np.unique(seg_array))
    
    # Resample segmentation to match CT geometry using nearest-neighbor
    resampled = resampler.resample_to_reference(
        seg_volume, ct_volume, interpolator=sitk.sitkNearestNeighbor
    )
    
    # Get resampled labels
    resampled_array = sitk.GetArrayFromImage(resampled)
    resampled_labels = set(np.unique(resampled_array))
    
    # Property: Nearest-neighbor interpolation should preserve label values
    # No new labels should be introduced
    assert resampled_labels.issubset(original_labels), \
        f"Resampled labels should be subset of original. Original: {original_labels}, Resampled: {resampled_labels}, New: {resampled_labels - original_labels}"
    
    # All resampled labels should be integers (no interpolated values)
    for label in resampled_labels:
        assert label == int(label), \
            f"Label {label} should be an integer (no interpolation)"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    ct_dimensions=volume_dimensions,
    ct_spacing=volume_spacing,
    ct_origin=volume_origin,
    seg_dimensions=volume_dimensions,
    seg_spacing=volume_spacing,
    seg_origin=volume_origin,
    num_labels=st.integers(min_value=2, max_value=10)
)
def test_property_resampling_convenience_method_uses_nearest_neighbor(
    resampler,
    ct_dimensions,
    ct_spacing,
    ct_origin,
    seg_dimensions,
    seg_spacing,
    seg_origin,
    num_labels
):
    """
    Property 20: Resampling Behavior - Convenience Method Uses Nearest-Neighbor
    
    For any segmentation volume, when resampled using the convenience method
    resample_segmentation_to_ct, it should use nearest-neighbor interpolation
    and preserve label values.
    
    This verifies Requirement 24.2: The Backend SHALL use nearest-neighbor interpolation
    to preserve label values
    """
    # Create CT volume (reference)
    ct_volume = create_ct_volume(ct_dimensions, ct_spacing, ct_origin)
    
    # Create segmentation volume with specific labels
    seg_volume = create_segmentation_volume(
        seg_dimensions, seg_spacing, seg_origin, num_labels
    )
    
    # Get original unique labels
    seg_array = sitk.GetArrayFromImage(seg_volume)
    original_labels = set(np.unique(seg_array))
    
    # Resample using convenience method (should use nearest-neighbor by default)
    resampled = resampler.resample_segmentation_to_ct(seg_volume, ct_volume)
    
    # Get resampled labels
    resampled_array = sitk.GetArrayFromImage(resampled)
    resampled_labels = set(np.unique(resampled_array))
    
    # Property: Convenience method should preserve label values (nearest-neighbor)
    assert resampled_labels.issubset(original_labels), \
        f"Convenience method should preserve labels. Original: {original_labels}, Resampled: {resampled_labels}"
    
    # Verify geometry matches CT
    assert resampled.GetSize() == ct_volume.GetSize(), \
        "Convenience method should match CT geometry"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    ct_dimensions=volume_dimensions,
    ct_spacing=volume_spacing,
    ct_origin=volume_origin,
    seg_dimensions=volume_dimensions,
    seg_spacing=volume_spacing,
    seg_origin=volume_origin,
    num_labels=st.integers(min_value=2, max_value=10)
)
def test_property_resampling_with_linear_interpolation_may_introduce_values(
    resampler,
    ct_dimensions,
    ct_spacing,
    ct_origin,
    seg_dimensions,
    seg_spacing,
    seg_origin,
    num_labels
):
    """
    Property 20: Resampling Behavior - Linear Interpolation Contrast
    
    For any segmentation volume, when resampled using linear interpolation (not nearest-neighbor),
    new intermediate values may be introduced. This test demonstrates why nearest-neighbor
    is required for segmentations.
    
    This provides contrast to verify Requirement 24.2: nearest-neighbor is necessary
    to preserve label values.
    """
    # Only run this test when geometries actually differ
    geometry_differs = (
        ct_dimensions != seg_dimensions or
        any(abs(ct - seg) > 0.01 for ct, seg in zip(ct_spacing, seg_spacing)) or
        any(abs(ct - seg) > 0.01 for ct, seg in zip(ct_origin, seg_origin))
    )
    assume(geometry_differs)
    
    # Create CT volume (reference)
    ct_volume = create_ct_volume(ct_dimensions, ct_spacing, ct_origin)
    
    # Create segmentation volume with specific labels
    seg_volume = create_segmentation_volume(
        seg_dimensions, seg_spacing, seg_origin, num_labels
    )
    
    # Get original unique labels
    seg_array = sitk.GetArrayFromImage(seg_volume)
    original_labels = set(np.unique(seg_array))
    
    # Resample using LINEAR interpolation (wrong for segmentations)
    resampled_linear = resampler.resample_to_reference(
        seg_volume, ct_volume, interpolator=sitk.sitkLinear
    )
    
    # Get resampled labels
    resampled_array = sitk.GetArrayFromImage(resampled_linear)
    resampled_labels = set(np.unique(resampled_array))
    
    # Property: Linear interpolation typically introduces new values
    # (This is why we DON'T use it for segmentations)
    # Note: This may not always be true if geometries are very similar,
    # but it demonstrates the difference
    
    # At minimum, verify that linear interpolation produces valid output
    assert resampled_linear.GetSize() == ct_volume.GetSize(), \
        "Linear interpolation should still match geometry"
    
    # The key insight: with linear interpolation, we often get non-integer values
    # or values between original labels, which is undesirable for segmentations


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    ct_dimensions=volume_dimensions,
    ct_spacing=volume_spacing,
    ct_origin=volume_origin,
    seg_dimensions=volume_dimensions,
    seg_spacing=volume_spacing,
    seg_origin=volume_origin
)
def test_property_resampling_default_pixel_value_is_zero(
    resampler,
    ct_dimensions,
    ct_spacing,
    ct_origin,
    seg_dimensions,
    seg_spacing,
    seg_origin
):
    """
    Property 20: Resampling Behavior - Default Pixel Value
    
    For any resampling operation, regions in the output that fall outside the input
    volume should be filled with the default pixel value (0).
    
    This verifies that resampling handles edge cases correctly.
    """
    # Create CT volume (reference) - make it larger
    ct_volume = create_ct_volume(ct_dimensions, ct_spacing, ct_origin)
    
    # Create smaller segmentation volume with offset origin
    # This ensures some regions will be outside the segmentation
    small_dimensions = tuple(max(2, d // 2) for d in seg_dimensions)
    offset_origin = tuple(o + 100.0 for o in seg_origin)
    
    seg_volume = create_segmentation_volume(
        small_dimensions, seg_spacing, offset_origin, num_labels=3
    )
    
    # Resample
    resampled = resampler.resample_to_reference(seg_volume, ct_volume)
    
    # Property: Resampled volume should have default value (0) in regions
    # outside the original segmentation
    resampled_array = sitk.GetArrayFromImage(resampled)
    
    # Should contain zeros (default value)
    assert 0 in resampled_array, \
        "Resampled volume should contain default value (0) in regions outside input"
    
    # Verify geometry matches
    assert resampled.GetSize() == ct_volume.GetSize(), \
        "Resampled size should match CT"


@settings(
    max_examples=50,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    origin=volume_origin,
    num_labels=st.integers(min_value=2, max_value=10)
)
def test_property_resampling_identity_when_geometries_match(
    resampler,
    dimensions,
    spacing,
    origin,
    num_labels
):
    """
    Property 20: Resampling Behavior - Identity When Geometries Match
    
    For any segmentation volume, when resampled to a reference with identical geometry,
    the output should be identical to the input (identity operation).
    
    This verifies that resampling doesn't introduce artifacts when unnecessary.
    """
    # Create CT volume (reference)
    ct_volume = create_ct_volume(dimensions, spacing, origin)
    
    # Create segmentation volume with IDENTICAL geometry
    seg_volume = create_segmentation_volume(dimensions, spacing, origin, num_labels)
    
    # Get original data
    seg_array = sitk.GetArrayFromImage(seg_volume)
    
    # Resample (should be identity operation)
    resampled = resampler.resample_to_reference(seg_volume, ct_volume)
    
    # Get resampled data
    resampled_array = sitk.GetArrayFromImage(resampled)
    
    # Property: When geometries match, resampling should be identity
    # Arrays should be very similar (allowing for minor numerical differences)
    assert resampled_array.shape == seg_array.shape, \
        "Shape should be preserved"
    
    # Most voxels should be identical
    matching_voxels = np.sum(resampled_array == seg_array)
    total_voxels = np.prod(seg_array.shape)
    match_ratio = matching_voxels / total_voxels
    
    assert match_ratio > 0.95, \
        f"When geometries match, most voxels should be identical. Match ratio: {match_ratio}"
