"""Tests for Geometry Validator Service"""

import pytest
from datetime import datetime

from services.geometry_validator import (
    GeometryValidatorService,
    GeometryValidationResult,
    GeometryMismatch
)
from services.volume_loader import VolumeMetadata


@pytest.fixture
def validator():
    """Create a GeometryValidatorService instance"""
    return GeometryValidatorService(tolerance=0.001)


@pytest.fixture
def ct_metadata():
    """Create sample CT metadata"""
    return VolumeMetadata(
        volume_id="ct-001",
        file_name="ct.nii",
        dimensions=(512, 512, 100),
        spacing=(0.5, 0.5, 1.0),
        origin=(0.0, 0.0, 0.0),
        direction=(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0),
        pixel_type="int16",
        number_of_components=1,
        size_bytes=52428800,
        loaded_at=datetime.now()
    )


@pytest.fixture
def seg_metadata_matching(ct_metadata):
    """Create matching segmentation metadata"""
    return VolumeMetadata(
        volume_id="seg-001",
        file_name="seg.nii",
        dimensions=ct_metadata.dimensions,
        spacing=ct_metadata.spacing,
        origin=ct_metadata.origin,
        direction=ct_metadata.direction,
        pixel_type="uint8",
        number_of_components=1,
        size_bytes=26214400,
        loaded_at=datetime.now()
    )


def test_matching_geometry(validator, ct_metadata, seg_metadata_matching):
    """Test validation with perfectly matching geometry"""
    result = validator.validate_geometry(ct_metadata, seg_metadata_matching)
    
    assert result.compatible is True
    assert len(result.mismatches) == 0


def test_dimension_mismatch(validator, ct_metadata, seg_metadata_matching):
    """Test detection of dimension mismatch"""
    # Modify segmentation dimensions
    seg_metadata_matching.dimensions = (256, 256, 100)
    
    result = validator.validate_geometry(ct_metadata, seg_metadata_matching)
    
    assert result.compatible is False
    assert len(result.mismatches) == 1
    assert result.mismatches[0].field == 'dimensions'
    assert result.mismatches[0].ct_value == (512, 512, 100)
    assert result.mismatches[0].seg_value == (256, 256, 100)


def test_spacing_mismatch_within_tolerance(validator, ct_metadata, seg_metadata_matching):
    """Test that spacing differences within tolerance are accepted"""
    # Modify spacing slightly within tolerance
    seg_metadata_matching.spacing = (0.5005, 0.5005, 1.0005)
    
    result = validator.validate_geometry(ct_metadata, seg_metadata_matching)
    
    assert result.compatible is True
    assert len(result.mismatches) == 0


def test_spacing_mismatch_exceeds_tolerance(validator, ct_metadata, seg_metadata_matching):
    """Test detection of spacing mismatch exceeding tolerance"""
    # Modify spacing beyond tolerance
    seg_metadata_matching.spacing = (0.6, 0.6, 1.0)
    
    result = validator.validate_geometry(ct_metadata, seg_metadata_matching)
    
    assert result.compatible is False
    assert len(result.mismatches) == 1
    assert result.mismatches[0].field == 'spacing'
    assert result.mismatches[0].ct_value == (0.5, 0.5, 1.0)
    assert result.mismatches[0].seg_value == (0.6, 0.6, 1.0)
    assert result.mismatches[0].difference == pytest.approx(0.1, rel=1e-5)


def test_origin_mismatch_within_tolerance(validator, ct_metadata, seg_metadata_matching):
    """Test that origin differences within tolerance are accepted"""
    # Modify origin slightly within tolerance
    seg_metadata_matching.origin = (0.0005, 0.0005, 0.0005)
    
    result = validator.validate_geometry(ct_metadata, seg_metadata_matching)
    
    assert result.compatible is True
    assert len(result.mismatches) == 0


def test_origin_mismatch_exceeds_tolerance(validator, ct_metadata, seg_metadata_matching):
    """Test detection of origin mismatch exceeding tolerance"""
    # Modify origin beyond tolerance
    seg_metadata_matching.origin = (1.0, 2.0, 3.0)
    
    result = validator.validate_geometry(ct_metadata, seg_metadata_matching)
    
    assert result.compatible is False
    assert len(result.mismatches) == 1
    assert result.mismatches[0].field == 'origin'
    assert result.mismatches[0].ct_value == (0.0, 0.0, 0.0)
    assert result.mismatches[0].seg_value == (1.0, 2.0, 3.0)
    assert result.mismatches[0].difference == pytest.approx(3.0, rel=1e-5)


def test_direction_mismatch_within_tolerance(validator, ct_metadata, seg_metadata_matching):
    """Test that direction differences within tolerance are accepted"""
    # Modify direction slightly within tolerance
    seg_metadata_matching.direction = (
        1.0005, 0.0, 0.0,
        0.0, 1.0005, 0.0,
        0.0, 0.0, 1.0005
    )
    
    result = validator.validate_geometry(ct_metadata, seg_metadata_matching)
    
    assert result.compatible is True
    assert len(result.mismatches) == 0


def test_direction_mismatch_exceeds_tolerance(validator, ct_metadata, seg_metadata_matching):
    """Test detection of direction mismatch exceeding tolerance"""
    # Modify direction beyond tolerance (rotated)
    seg_metadata_matching.direction = (
        0.0, 1.0, 0.0,
        1.0, 0.0, 0.0,
        0.0, 0.0, 1.0
    )
    
    result = validator.validate_geometry(ct_metadata, seg_metadata_matching)
    
    assert result.compatible is False
    assert len(result.mismatches) == 1
    assert result.mismatches[0].field == 'direction'
    assert result.mismatches[0].difference == pytest.approx(1.0, rel=1e-5)


def test_multiple_mismatches(validator, ct_metadata, seg_metadata_matching):
    """Test detection of multiple geometry mismatches"""
    # Modify multiple fields
    seg_metadata_matching.dimensions = (256, 256, 100)
    seg_metadata_matching.spacing = (1.0, 1.0, 2.0)
    seg_metadata_matching.origin = (10.0, 20.0, 30.0)
    
    result = validator.validate_geometry(ct_metadata, seg_metadata_matching)
    
    assert result.compatible is False
    assert len(result.mismatches) == 3
    
    # Check that all three mismatches are detected
    mismatch_fields = {m.field for m in result.mismatches}
    assert 'dimensions' in mismatch_fields
    assert 'spacing' in mismatch_fields
    assert 'origin' in mismatch_fields


def test_custom_tolerance(validator, ct_metadata, seg_metadata_matching):
    """Test validation with custom tolerance"""
    # Modify spacing to be within 0.01 but outside 0.001
    seg_metadata_matching.spacing = (0.505, 0.505, 1.005)
    
    # Should fail with default tolerance
    result = validator.validate_geometry(ct_metadata, seg_metadata_matching)
    assert result.compatible is False
    
    # Should pass with larger tolerance
    result = validator.validate_geometry(ct_metadata, seg_metadata_matching, tolerance=0.01)
    assert result.compatible is True


def test_format_validation_error_compatible(validator, ct_metadata, seg_metadata_matching):
    """Test formatting of compatible validation result"""
    result = validator.validate_geometry(ct_metadata, seg_metadata_matching)
    message = validator.format_validation_error(result)
    
    assert "compatible" in message.lower()


def test_format_validation_error_with_mismatches(validator, ct_metadata, seg_metadata_matching):
    """Test formatting of validation result with mismatches"""
    # Create mismatches
    seg_metadata_matching.dimensions = (256, 256, 100)
    seg_metadata_matching.spacing = (1.0, 1.0, 2.0)
    
    result = validator.validate_geometry(ct_metadata, seg_metadata_matching)
    message = validator.format_validation_error(result)
    
    assert "failed" in message.lower()
    assert "Dimensions" in message
    assert "Spacing" in message
    assert "512, 512, 100" in message
    assert "256, 256, 100" in message


def test_calculate_tuple_difference():
    """Test tuple difference calculation"""
    validator = GeometryValidatorService()
    
    # Test identical tuples
    diff = validator._calculate_tuple_difference((1.0, 2.0, 3.0), (1.0, 2.0, 3.0))
    assert diff == 0.0
    
    # Test different tuples
    diff = validator._calculate_tuple_difference((1.0, 2.0, 3.0), (1.5, 2.5, 3.5))
    assert diff == 0.5
    
    # Test with larger differences
    diff = validator._calculate_tuple_difference((0.0, 0.0, 0.0), (1.0, 2.0, 3.0))
    assert diff == 3.0
    
    # Test with different lengths
    diff = validator._calculate_tuple_difference((1.0, 2.0), (1.0, 2.0, 3.0))
    assert diff == float('inf')


def test_calculate_dimension_difference():
    """Test dimension difference calculation"""
    validator = GeometryValidatorService()
    
    # Test identical dimensions
    diff = validator._calculate_dimension_difference((512, 512, 100), (512, 512, 100))
    assert diff == 0.0
    
    # Test different dimensions
    diff = validator._calculate_dimension_difference((512, 512, 100), (256, 256, 100))
    assert diff == 512.0  # 256 + 256 + 0
