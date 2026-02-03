"""Property-Based Tests for File Size Validation

**Feature: ct-segmentation-viewer, Property 18: File Size Validation**
**Validates: Requirements 21.1, 21.2**

Property: For any file upload attempt, the system should validate the file size 
against configured limits and reject oversized files with appropriate error messages.
"""

import pytest
import numpy as np
import SimpleITK as sitk
from pathlib import Path
import tempfile
import os
from hypothesis import given, strategies as st, settings, assume
from hypothesis import HealthCheck
from fastapi.testclient import TestClient
from unittest.mock import patch

from main import app, MAX_FILE_SIZE_MB, MAX_FILE_SIZE_BYTES


@pytest.fixture
def client():
    """Create a test client for the FastAPI app"""
    return TestClient(app)


@pytest.fixture
def temp_dir():
    """Create a temporary directory for test files"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


def create_test_volume_file(file_path: Path, target_size_mb: float):
    """Create a test volume file with approximately the target size in MB
    
    Args:
        file_path: Path where the file should be created
        target_size_mb: Target file size in megabytes
    """
    # For efficiency, create a small volume and pad the file to reach target size
    # This avoids the overhead of creating and compressing huge arrays
    
    # Create a minimal valid volume
    dimensions = (10, 10, 10)
    arr = np.random.randint(-1000, 1000, size=dimensions, dtype=np.int16)
    volume = sitk.GetImageFromArray(arr.transpose(2, 1, 0))
    volume.SetSpacing((1.0, 1.0, 1.0))
    volume.SetOrigin((0.0, 0.0, 0.0))
    
    # Write to file
    sitk.WriteImage(volume, str(file_path))
    
    # Get current file size
    current_size = os.path.getsize(file_path)
    target_bytes = int(target_size_mb * 1024 * 1024)
    
    # If we need to make it larger, append padding bytes
    if target_bytes > current_size:
        padding_size = target_bytes - current_size
        with open(file_path, 'ab') as f:
            # Write padding in chunks to avoid memory issues
            chunk_size = 1024 * 1024  # 1 MB chunks
            remaining = padding_size
            while remaining > 0:
                write_size = min(chunk_size, remaining)
                f.write(b'\x00' * write_size)
                remaining -= write_size
    
    # Return actual file size
    return os.path.getsize(file_path)


# Strategy for file sizes below the limit
# Generate sizes from 0.1 MB to just under the limit
# Use smaller range for efficiency
file_size_below_limit = st.floats(
    min_value=0.1,
    max_value=min(100.0, float(MAX_FILE_SIZE_MB) - 1.0),
    allow_nan=False,
    allow_infinity=False
)

# Strategy for file sizes above the limit
# Generate sizes from just over the limit to limit + 100 MB
file_size_above_limit = st.floats(
    min_value=float(MAX_FILE_SIZE_MB) + 1.0,
    max_value=float(MAX_FILE_SIZE_MB) + 100.0,
    allow_nan=False,
    allow_infinity=False
)

# Strategy for file formats
file_formats = st.sampled_from(['.nii.gz', '.nii', '.mha'])


@settings(
    max_examples=20,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow]
)
@given(
    file_size_mb=file_size_below_limit,
    file_format=file_formats
)
def test_property_file_size_validation_accepts_valid_sizes(
    client,
    temp_dir,
    file_size_mb,
    file_format
):
    """
    Property 18a: File Size Validation - Accept Valid Sizes
    
    For any file upload with size below the configured limit, the system should
    accept the file and process it successfully.
    
    This property verifies Requirement 21.1:
    WHEN a user attempts to upload a file, THEN the System SHALL verify 
    the file size does not exceed the configured limit.
    """
    # Skip if file size is too close to limit (within 0.5 MB) to avoid flakiness
    # due to compression variations
    assume(file_size_mb < MAX_FILE_SIZE_MB - 0.5)
    
    # Create a test file with the specified size
    file_path = temp_dir / f"test_volume{file_format}"
    actual_size_bytes = create_test_volume_file(file_path, file_size_mb)
    actual_size_mb = actual_size_bytes / (1024 * 1024)
    
    # Verify the file is actually below the limit
    assume(actual_size_bytes < MAX_FILE_SIZE_BYTES)
    
    # Upload the file
    with open(file_path, 'rb') as f:
        response = client.post(
            "/api/volumes/upload",
            files={"file": (file_path.name, f, "application/octet-stream")}
        )
    
    # The upload should succeed (status 200)
    assert response.status_code == 200, \
        f"Upload should succeed for file size {actual_size_mb:.2f} MB " \
        f"(limit: {MAX_FILE_SIZE_MB} MB), got status {response.status_code}: {response.text}"
    
    # Verify response contains volume metadata
    data = response.json()
    assert "volume_id" in data, "Response should contain volume_id"
    assert "dimensions" in data, "Response should contain dimensions"
    assert "spacing" in data, "Response should contain spacing"
    assert "origin" in data, "Response should contain origin"
    
    # Clean up - delete the uploaded volume
    volume_id = data["volume_id"]
    client.delete(f"/api/volumes/{volume_id}")


@settings(
    max_examples=20,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow]
)
@given(
    file_size_mb=file_size_above_limit,
    file_format=file_formats
)
def test_property_file_size_validation_rejects_oversized_files(
    client,
    temp_dir,
    file_size_mb,
    file_format
):
    """
    Property 18b: File Size Validation - Reject Oversized Files
    
    For any file upload with size exceeding the configured limit, the system should
    reject the file with an appropriate error message indicating the size limit.
    
    This property verifies Requirements 21.1 and 21.2:
    21.1: WHEN a user attempts to upload a file, THEN the System SHALL verify 
          the file size does not exceed the configured limit.
    21.2: IF a file exceeds the size limit, THEN the System SHALL reject the upload 
          and display an error message indicating the size limit.
    """
    # Create a test file with the specified size
    file_path = temp_dir / f"test_large_volume{file_format}"
    actual_size_bytes = create_test_volume_file(file_path, file_size_mb)
    actual_size_mb = actual_size_bytes / (1024 * 1024)
    
    # Verify the file is actually above the limit
    assume(actual_size_bytes > MAX_FILE_SIZE_BYTES)
    
    # Upload the file
    with open(file_path, 'rb') as f:
        response = client.post(
            "/api/volumes/upload",
            files={"file": (file_path.name, f, "application/octet-stream")}
        )
    
    # The upload should be rejected (status 413 - Payload Too Large)
    assert response.status_code == 413, \
        f"Upload should be rejected for file size {actual_size_mb:.2f} MB " \
        f"(limit: {MAX_FILE_SIZE_MB} MB), got status {response.status_code}"
    
    # Verify the error message mentions the size limit (Requirement 21.2)
    error_data = response.json()
    error_message = error_data.get("detail", "")
    
    assert "size" in error_message.lower(), \
        f"Error message should mention 'size': {error_message}"
    assert "exceeds" in error_message.lower() or "limit" in error_message.lower(), \
        f"Error message should mention 'exceeds' or 'limit': {error_message}"
    
    # Verify the error message includes the actual limit value
    assert str(MAX_FILE_SIZE_MB) in error_message or f"{MAX_FILE_SIZE_MB}" in error_message, \
        f"Error message should include the size limit ({MAX_FILE_SIZE_MB} MB): {error_message}"


@settings(
    max_examples=10,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    file_size_mb=st.floats(
        min_value=float(MAX_FILE_SIZE_MB) - 0.5,
        max_value=float(MAX_FILE_SIZE_MB) + 0.5,
        allow_nan=False,
        allow_infinity=False
    ),
    file_format=file_formats
)
def test_property_file_size_validation_boundary_cases(
    client,
    temp_dir,
    file_size_mb,
    file_format
):
    """
    Property 18c: File Size Validation - Boundary Cases
    
    For files near the size limit boundary, the system should correctly
    accept files just under the limit and reject files just over the limit.
    
    This tests the precision of the size validation logic.
    """
    # Create a test file with the specified size
    file_path = temp_dir / f"test_boundary_volume{file_format}"
    actual_size_bytes = create_test_volume_file(file_path, file_size_mb)
    actual_size_mb = actual_size_bytes / (1024 * 1024)
    
    # Upload the file
    with open(file_path, 'rb') as f:
        response = client.post(
            "/api/volumes/upload",
            files={"file": (file_path.name, f, "application/octet-stream")}
        )
    
    # Verify the response matches the expected behavior based on actual size
    if actual_size_bytes <= MAX_FILE_SIZE_BYTES:
        # Should accept
        assert response.status_code == 200, \
            f"Upload should succeed for file size {actual_size_mb:.2f} MB " \
            f"(limit: {MAX_FILE_SIZE_MB} MB), got status {response.status_code}: {response.text}"
        
        # Clean up
        data = response.json()
        volume_id = data["volume_id"]
        client.delete(f"/api/volumes/{volume_id}")
    else:
        # Should reject
        assert response.status_code == 413, \
            f"Upload should be rejected for file size {actual_size_mb:.2f} MB " \
            f"(limit: {MAX_FILE_SIZE_MB} MB), got status {response.status_code}"
        
        # Verify error message
        error_data = response.json()
        error_message = error_data.get("detail", "")
        assert "size" in error_message.lower() and "exceeds" in error_message.lower(), \
            f"Error message should mention size limit: {error_message}"


@pytest.mark.parametrize("limit_mb,test_size_mb", [
    (100, 50),    # Test with 50 MB file, 100 MB limit
    (500, 250),   # Test with 250 MB file, 500 MB limit
    (1000, 500),  # Test with 500 MB file, 1000 MB limit
    (2048, 1000), # Test with 1000 MB file, 2048 MB limit
])
def test_property_file_size_validation_respects_configured_limit(client, temp_dir, limit_mb, test_size_mb):
    """
    Property 18d: File Size Validation - Respects Configured Limit
    
    For any configured file size limit, the system should enforce that limit correctly.
    
    This verifies Requirement 21.3:
    WHEN the System is deployed, THEN the System SHALL allow administrators 
    to configure the maximum file size.
    """
    # Create a test file smaller than the limit
    file_path = temp_dir / "test_small.nii.gz"
    actual_size_bytes = create_test_volume_file(file_path, test_size_mb)
    
    # Mock the MAX_FILE_SIZE_BYTES to test different limits
    with patch('main.MAX_FILE_SIZE_BYTES', limit_mb * 1024 * 1024):
        with open(file_path, 'rb') as f:
            response = client.post(
                "/api/volumes/upload",
                files={"file": (file_path.name, f, "application/octet-stream")}
            )
        
        # Since our test file is smaller than the limit, it should be accepted
        assert response.status_code == 200, \
            f"File ({test_size_mb} MB) should be accepted with limit {limit_mb} MB"
        
        # Clean up
        data = response.json()
        volume_id = data["volume_id"]
        client.delete(f"/api/volumes/{volume_id}")
    
    # Now test with a file larger than the limit
    large_file_path = temp_dir / "test_large.nii.gz"
    large_size_mb = limit_mb + 10.0
    large_size_bytes = create_test_volume_file(large_file_path, large_size_mb)
    
    # Verify the file is actually larger than the limit
    if large_size_bytes > limit_mb * 1024 * 1024:
        with patch('main.MAX_FILE_SIZE_BYTES', limit_mb * 1024 * 1024):
            with open(large_file_path, 'rb') as f:
                response = client.post(
                    "/api/volumes/upload",
                    files={"file": (large_file_path.name, f, "application/octet-stream")}
                )
            
            # Should be rejected
            assert response.status_code == 413, \
                f"Large file ({large_size_mb} MB) should be rejected with limit {limit_mb} MB"
