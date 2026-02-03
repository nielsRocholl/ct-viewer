"""Property-Based Tests for Geometry Validator Service

**Feature: ct-segmentation-viewer, Property 4: Geometry Compatibility Validation**
**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

Property: For any CT volume and segmentation mask pair, the system should verify dimensions,
spacing, origin, and direction match within tolerance (0.001), and provide explicit error
messages for mismatches.
"""

import pytest
from datetime import datetime
from hypothesis import given, strategies as st, settings, assume
from hypothesis import HealthCheck

from services.geometry_validator import (
    GeometryValidatorService,
    GeometryValidationResult
)
from services.volume_loader import VolumeMetadata


# Strategy for generating valid 3D volume dimensions
volume_dimensions = st.tuples(
    st.integers(min_value=2, max_value=512),  # x
    st.integers(min_value=2, max_value=512),  # y
    st.integers(min_value=2, max_value=200)   # z
)

# Strategy for generating valid spacing values (must be positive)
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

# Strategy for generating valid direction cosine matrices (9 elements)
# For simplicity, we'll use identity matrix and simple rotations
def generate_direction_matrix():
    """Generate valid direction matrices"""
    # Identity matrix
    identity = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)
    
    # 90-degree rotation around Z-axis
    rot_z = (0.0, 1.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0)
    
    # 90-degree rotation around X-axis
    rot_x = (1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, -1.0, 0.0)
    
    # 90-degree rotation around Y-axis
    rot_y = (0.0, 0.0, -1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0)
    
    return st.sampled_from([identity, rot_z, rot_x, rot_y])

volume_direction = generate_direction_matrix()


def create_volume_metadata(
    volume_id: str,
    file_name: str,
    dimensions,
    spacing,
    origin,
    direction,
    pixel_type: str = "int16"
):
    """Helper to create VolumeMetadata with specified properties"""
    return VolumeMetadata(
        volume_id=volume_id,
        file_name=file_name,
        dimensions=dimensions,
        spacing=spacing,
        origin=origin,
        direction=direction,
        pixel_type=pixel_type,
        number_of_components=1,
        size_bytes=dimensions[0] * dimensions[1] * dimensions[2] * 2,  # 2 bytes per int16
        loaded_at=datetime.now()
    )


@pytest.fixture
def validator():
    """Create a GeometryValidatorService instance"""
    return GeometryValidatorService(tolerance=0.001)


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    origin=volume_origin,
    direction=volume_direction
)
def test_property_geometry_compatibility_matching(
    validator,
    dimensions,
    spacing,
    origin,
    direction
):
    """
    Property 4: Geometry Compatibility Validation - Matching Geometry
    
    For any CT volume and segmentation mask with identical geometry (dimensions, spacing,
    origin, direction), the system should validate them as compatible.
    
    This verifies:
    - Requirement 4.1: Verify segmentation dimensions match CT dimensions
    - Requirement 4.2: Verify segmentation spacing matches CT spacing within tolerance
    - Requirement 4.3: Verify segmentation origin matches CT origin within tolerance
    - Requirement 4.4: Verify segmentation direction cosines match CT direction within tolerance
    """
    # Create CT and segmentation metadata with identical geometry
    ct_metadata = create_volume_metadata(
        volume_id="ct-001",
        file_name="ct.nii",
        dimensions=dimensions,
        spacing=spacing,
        origin=origin,
        direction=direction,
        pixel_type="int16"
    )
    
    seg_metadata = create_volume_metadata(
        volume_id="seg-001",
        file_name="seg.nii",
        dimensions=dimensions,
        spacing=spacing,
        origin=origin,
        direction=direction,
        pixel_type="uint8"
    )
    
    # Validate geometry
    result = validator.validate_geometry(ct_metadata, seg_metadata)
    
    # Property: Identical geometry should always be compatible
    assert result.compatible is True, \
        f"Identical geometry should be compatible. Mismatches: {result.mismatches}"
    assert len(result.mismatches) == 0, \
        f"Identical geometry should have no mismatches, got {len(result.mismatches)}"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    origin=volume_origin,
    direction=volume_direction,
    # Generate small perturbations within tolerance
    spacing_delta=st.tuples(
        st.floats(min_value=-0.0009, max_value=0.0009, allow_nan=False, allow_infinity=False),
        st.floats(min_value=-0.0009, max_value=0.0009, allow_nan=False, allow_infinity=False),
        st.floats(min_value=-0.0009, max_value=0.0009, allow_nan=False, allow_infinity=False)
    ),
    origin_delta=st.tuples(
        st.floats(min_value=-0.0009, max_value=0.0009, allow_nan=False, allow_infinity=False),
        st.floats(min_value=-0.0009, max_value=0.0009, allow_nan=False, allow_infinity=False),
        st.floats(min_value=-0.0009, max_value=0.0009, allow_nan=False, allow_infinity=False)
    ),
    direction_delta=st.floats(min_value=-0.0009, max_value=0.0009, allow_nan=False, allow_infinity=False)
)
def test_property_geometry_compatibility_within_tolerance(
    validator,
    dimensions,
    spacing,
    origin,
    direction,
    spacing_delta,
    origin_delta,
    direction_delta
):
    """
    Property 4: Geometry Compatibility Validation - Within Tolerance
    
    For any CT volume and segmentation mask with geometry differences within tolerance (0.001),
    the system should validate them as compatible.
    
    This verifies:
    - Requirement 4.2: Spacing matches within tolerance of 0.001 millimeters
    - Requirement 4.3: Origin matches within tolerance of 0.001 millimeters
    - Requirement 4.4: Direction cosines match within tolerance of 0.001
    """
    # Create CT metadata
    ct_metadata = create_volume_metadata(
        volume_id="ct-001",
        file_name="ct.nii",
        dimensions=dimensions,
        spacing=spacing,
        origin=origin,
        direction=direction
    )
    
    # Create segmentation metadata with small perturbations within tolerance
    seg_spacing = tuple(s + d for s, d in zip(spacing, spacing_delta))
    seg_origin = tuple(o + d for o, d in zip(origin, origin_delta))
    seg_direction = tuple(d + direction_delta for d in direction)
    
    # Ensure spacing remains positive
    assume(all(s > 0 for s in seg_spacing))
    
    seg_metadata = create_volume_metadata(
        volume_id="seg-001",
        file_name="seg.nii",
        dimensions=dimensions,
        spacing=seg_spacing,
        origin=seg_origin,
        direction=seg_direction
    )
    
    # Validate geometry
    result = validator.validate_geometry(ct_metadata, seg_metadata)
    
    # Property: Geometry within tolerance should be compatible
    assert result.compatible is True, \
        f"Geometry within tolerance should be compatible. Mismatches: {result.mismatches}"
    assert len(result.mismatches) == 0, \
        f"Geometry within tolerance should have no mismatches, got {len(result.mismatches)}"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    ct_dimensions=volume_dimensions,
    seg_dimensions=volume_dimensions,
    spacing=volume_spacing,
    origin=volume_origin,
    direction=volume_direction
)
def test_property_geometry_dimension_mismatch_detection(
    validator,
    ct_dimensions,
    seg_dimensions,
    spacing,
    origin,
    direction
):
    """
    Property 4: Geometry Compatibility Validation - Dimension Mismatch Detection
    
    For any CT volume and segmentation mask with different dimensions, the system should
    detect the mismatch and report it explicitly.
    
    This verifies Requirement 4.1: Verify segmentation dimensions match CT dimensions
    """
    # Only test when dimensions actually differ
    assume(ct_dimensions != seg_dimensions)
    
    # Create CT and segmentation metadata with different dimensions
    ct_metadata = create_volume_metadata(
        volume_id="ct-001",
        file_name="ct.nii",
        dimensions=ct_dimensions,
        spacing=spacing,
        origin=origin,
        direction=direction
    )
    
    seg_metadata = create_volume_metadata(
        volume_id="seg-001",
        file_name="seg.nii",
        dimensions=seg_dimensions,
        spacing=spacing,
        origin=origin,
        direction=direction
    )
    
    # Validate geometry
    result = validator.validate_geometry(ct_metadata, seg_metadata)
    
    # Property: Different dimensions should be detected as incompatible
    assert result.compatible is False, \
        f"Different dimensions should be incompatible: CT={ct_dimensions}, Seg={seg_dimensions}"
    
    # Should have at least one mismatch for dimensions
    dimension_mismatches = [m for m in result.mismatches if m.field == 'dimensions']
    assert len(dimension_mismatches) > 0, \
        "Should detect dimension mismatch"
    
    # Verify the mismatch contains correct values
    mismatch = dimension_mismatches[0]
    assert mismatch.ct_value == ct_dimensions, \
        f"Mismatch should report CT dimensions: expected {ct_dimensions}, got {mismatch.ct_value}"
    assert mismatch.seg_value == seg_dimensions, \
        f"Mismatch should report seg dimensions: expected {seg_dimensions}, got {mismatch.seg_value}"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    ct_spacing=volume_spacing,
    seg_spacing=volume_spacing,
    origin=volume_origin,
    direction=volume_direction
)
def test_property_geometry_spacing_mismatch_detection(
    validator,
    dimensions,
    ct_spacing,
    seg_spacing,
    origin,
    direction
):
    """
    Property 4: Geometry Compatibility Validation - Spacing Mismatch Detection
    
    For any CT volume and segmentation mask with spacing differences exceeding tolerance,
    the system should detect the mismatch and report it explicitly.
    
    This verifies Requirement 4.2: Verify segmentation spacing matches CT spacing within
    tolerance of 0.001 millimeters
    """
    # Calculate the maximum difference
    max_diff = max(abs(ct - seg) for ct, seg in zip(ct_spacing, seg_spacing))
    
    # Only test when spacing differs beyond tolerance
    assume(max_diff > 0.001)
    
    # Create CT and segmentation metadata with different spacing
    ct_metadata = create_volume_metadata(
        volume_id="ct-001",
        file_name="ct.nii",
        dimensions=dimensions,
        spacing=ct_spacing,
        origin=origin,
        direction=direction
    )
    
    seg_metadata = create_volume_metadata(
        volume_id="seg-001",
        file_name="seg.nii",
        dimensions=dimensions,
        spacing=seg_spacing,
        origin=origin,
        direction=direction
    )
    
    # Validate geometry
    result = validator.validate_geometry(ct_metadata, seg_metadata)
    
    # Property: Spacing beyond tolerance should be detected as incompatible
    assert result.compatible is False, \
        f"Spacing beyond tolerance should be incompatible: CT={ct_spacing}, Seg={seg_spacing}, diff={max_diff}"
    
    # Should have at least one mismatch for spacing
    spacing_mismatches = [m for m in result.mismatches if m.field == 'spacing']
    assert len(spacing_mismatches) > 0, \
        "Should detect spacing mismatch"
    
    # Verify the mismatch contains correct values
    mismatch = spacing_mismatches[0]
    assert mismatch.ct_value == ct_spacing, \
        f"Mismatch should report CT spacing: expected {ct_spacing}, got {mismatch.ct_value}"
    assert mismatch.seg_value == seg_spacing, \
        f"Mismatch should report seg spacing: expected {seg_spacing}, got {mismatch.seg_value}"
    assert mismatch.difference > 0.001, \
        f"Mismatch difference should exceed tolerance: {mismatch.difference}"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    ct_origin=volume_origin,
    seg_origin=volume_origin,
    direction=volume_direction
)
def test_property_geometry_origin_mismatch_detection(
    validator,
    dimensions,
    spacing,
    ct_origin,
    seg_origin,
    direction
):
    """
    Property 4: Geometry Compatibility Validation - Origin Mismatch Detection
    
    For any CT volume and segmentation mask with origin differences exceeding tolerance,
    the system should detect the mismatch and report it explicitly.
    
    This verifies Requirement 4.3: Verify segmentation origin matches CT origin within
    tolerance of 0.001 millimeters
    """
    # Calculate the maximum difference
    max_diff = max(abs(ct - seg) for ct, seg in zip(ct_origin, seg_origin))
    
    # Only test when origin differs beyond tolerance
    assume(max_diff > 0.001)
    
    # Create CT and segmentation metadata with different origins
    ct_metadata = create_volume_metadata(
        volume_id="ct-001",
        file_name="ct.nii",
        dimensions=dimensions,
        spacing=spacing,
        origin=ct_origin,
        direction=direction
    )
    
    seg_metadata = create_volume_metadata(
        volume_id="seg-001",
        file_name="seg.nii",
        dimensions=dimensions,
        spacing=spacing,
        origin=seg_origin,
        direction=direction
    )
    
    # Validate geometry
    result = validator.validate_geometry(ct_metadata, seg_metadata)
    
    # Property: Origin beyond tolerance should be detected as incompatible
    assert result.compatible is False, \
        f"Origin beyond tolerance should be incompatible: CT={ct_origin}, Seg={seg_origin}, diff={max_diff}"
    
    # Should have at least one mismatch for origin
    origin_mismatches = [m for m in result.mismatches if m.field == 'origin']
    assert len(origin_mismatches) > 0, \
        "Should detect origin mismatch"
    
    # Verify the mismatch contains correct values
    mismatch = origin_mismatches[0]
    assert mismatch.ct_value == ct_origin, \
        f"Mismatch should report CT origin: expected {ct_origin}, got {mismatch.ct_value}"
    assert mismatch.seg_value == seg_origin, \
        f"Mismatch should report seg origin: expected {seg_origin}, got {mismatch.seg_value}"
    assert mismatch.difference > 0.001, \
        f"Mismatch difference should exceed tolerance: {mismatch.difference}"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    origin=volume_origin,
    ct_direction=volume_direction,
    seg_direction=volume_direction
)
def test_property_geometry_direction_mismatch_detection(
    validator,
    dimensions,
    spacing,
    origin,
    ct_direction,
    seg_direction
):
    """
    Property 4: Geometry Compatibility Validation - Direction Mismatch Detection
    
    For any CT volume and segmentation mask with direction differences exceeding tolerance,
    the system should detect the mismatch and report it explicitly.
    
    This verifies Requirement 4.4: Verify segmentation direction cosines match CT direction
    cosines within tolerance of 0.001
    """
    # Calculate the maximum difference
    max_diff = max(abs(ct - seg) for ct, seg in zip(ct_direction, seg_direction))
    
    # Only test when direction differs beyond tolerance
    assume(max_diff > 0.001)
    
    # Create CT and segmentation metadata with different directions
    ct_metadata = create_volume_metadata(
        volume_id="ct-001",
        file_name="ct.nii",
        dimensions=dimensions,
        spacing=spacing,
        origin=origin,
        direction=ct_direction
    )
    
    seg_metadata = create_volume_metadata(
        volume_id="seg-001",
        file_name="seg.nii",
        dimensions=dimensions,
        spacing=spacing,
        origin=origin,
        direction=seg_direction
    )
    
    # Validate geometry
    result = validator.validate_geometry(ct_metadata, seg_metadata)
    
    # Property: Direction beyond tolerance should be detected as incompatible
    assert result.compatible is False, \
        f"Direction beyond tolerance should be incompatible: CT={ct_direction}, Seg={seg_direction}, diff={max_diff}"
    
    # Should have at least one mismatch for direction
    direction_mismatches = [m for m in result.mismatches if m.field == 'direction']
    assert len(direction_mismatches) > 0, \
        "Should detect direction mismatch"
    
    # Verify the mismatch contains correct values
    mismatch = direction_mismatches[0]
    assert mismatch.ct_value == ct_direction, \
        f"Mismatch should report CT direction: expected {ct_direction}, got {mismatch.ct_value}"
    assert mismatch.seg_value == seg_direction, \
        f"Mismatch should report seg direction: expected {seg_direction}, got {mismatch.seg_value}"
    assert mismatch.difference > 0.001, \
        f"Mismatch difference should exceed tolerance: {mismatch.difference}"


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    dimensions=volume_dimensions,
    spacing=volume_spacing,
    origin=volume_origin,
    direction=volume_direction
)
def test_property_geometry_error_message_format(
    validator,
    dimensions,
    spacing,
    origin,
    direction
):
    """
    Property 4: Geometry Compatibility Validation - Error Message Format
    
    For any geometry validation failure, the system should provide an explicit error message
    describing the mismatch.
    
    This verifies Requirement 4.5: If geometry validation fails, provide explicit error
    message describing the mismatch
    """
    # Create CT metadata
    ct_metadata = create_volume_metadata(
        volume_id="ct-001",
        file_name="ct.nii",
        dimensions=dimensions,
        spacing=spacing,
        origin=origin,
        direction=direction
    )
    
    # Create segmentation metadata with intentional mismatches
    # Change dimensions to ensure incompatibility
    seg_dimensions = (dimensions[0] // 2, dimensions[1] // 2, dimensions[2])
    
    seg_metadata = create_volume_metadata(
        volume_id="seg-001",
        file_name="seg.nii",
        dimensions=seg_dimensions,
        spacing=spacing,
        origin=origin,
        direction=direction
    )
    
    # Validate geometry
    result = validator.validate_geometry(ct_metadata, seg_metadata)
    
    # Should be incompatible
    assert result.compatible is False, "Should detect incompatibility"
    
    # Format error message
    error_message = validator.format_validation_error(result)
    
    # Property: Error message should be explicit and describe the mismatch
    assert error_message is not None, "Error message should not be None"
    assert len(error_message) > 0, "Error message should not be empty"
    assert "failed" in error_message.lower() or "mismatch" in error_message.lower(), \
        "Error message should indicate failure"
    
    # Error message should contain information about the mismatch
    assert "Dimensions" in error_message or "dimensions" in error_message, \
        "Error message should mention dimensions"
    
    # Error message should contain the actual values
    assert str(dimensions[0]) in error_message or str(seg_dimensions[0]) in error_message, \
        "Error message should contain dimension values"
