"""Tests for Volume Loader Service"""

import pytest
import numpy as np
import SimpleITK as sitk
from pathlib import Path
import tempfile
import os

from services.volume_loader import VolumeLoaderService, VolumeLoadError


@pytest.fixture
def volume_loader():
    """Create a VolumeLoaderService instance"""
    return VolumeLoaderService()


@pytest.fixture
def temp_dir():
    """Create a temporary directory for test files"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


def create_test_volume(size=(10, 10, 10), spacing=(1.0, 1.0, 1.0), 
                       origin=(0.0, 0.0, 0.0)) -> sitk.Image:
    """Create a test 3D volume"""
    volume = sitk.Image(size, sitk.sitkInt16)
    volume.SetSpacing(spacing)
    volume.SetOrigin(origin)
    
    # Fill with some test data
    arr = np.random.randint(0, 1000, size=size, dtype=np.int16)
    volume = sitk.GetImageFromArray(arr.transpose(2, 1, 0))
    volume.SetSpacing(spacing)
    volume.SetOrigin(origin)
    
    return volume


@pytest.mark.asyncio
async def test_load_nii_volume(volume_loader, temp_dir):
    """Test loading a .nii file"""
    # Create test volume
    volume = create_test_volume()
    file_path = temp_dir / "test_volume.nii"
    sitk.WriteImage(volume, str(file_path))
    
    # Load volume
    metadata = await volume_loader.load_volume(str(file_path))
    
    # Verify metadata
    assert metadata.volume_id is not None
    assert metadata.file_name == "test_volume.nii"
    assert metadata.dimensions == (10, 10, 10)
    assert metadata.spacing == (1.0, 1.0, 1.0)
    assert metadata.origin == (0.0, 0.0, 0.0)
    assert len(metadata.direction) == 9
    assert metadata.pixel_type is not None


@pytest.mark.asyncio
async def test_load_nii_gz_volume(volume_loader, temp_dir):
    """Test loading a .nii.gz file"""
    volume = create_test_volume()
    file_path = temp_dir / "test_volume.nii.gz"
    sitk.WriteImage(volume, str(file_path))
    
    metadata = await volume_loader.load_volume(str(file_path))
    
    assert metadata.file_name == "test_volume.nii.gz"
    assert metadata.dimensions == (10, 10, 10)


@pytest.mark.asyncio
async def test_load_mha_volume(volume_loader, temp_dir):
    """Test loading a .mha file"""
    volume = create_test_volume()
    file_path = temp_dir / "test_volume.mha"
    sitk.WriteImage(volume, str(file_path))
    
    metadata = await volume_loader.load_volume(str(file_path))
    
    assert metadata.file_name == "test_volume.mha"
    assert metadata.dimensions == (10, 10, 10)


@pytest.mark.asyncio
async def test_load_mhd_volume(volume_loader, temp_dir):
    """Test loading a .mhd file"""
    volume = create_test_volume()
    file_path = temp_dir / "test_volume.mhd"
    sitk.WriteImage(volume, str(file_path))
    
    metadata = await volume_loader.load_volume(str(file_path))
    
    assert metadata.file_name == "test_volume.mhd"
    assert metadata.dimensions == (10, 10, 10)


@pytest.mark.asyncio
async def test_validate_3d_dimensionality(volume_loader, temp_dir):
    """Test that non-3D volumes are rejected"""
    # Create 2D volume
    volume_2d = sitk.Image((10, 10), sitk.sitkInt16)
    file_path = temp_dir / "test_2d.nii"
    sitk.WriteImage(volume_2d, str(file_path))
    
    # Should raise error
    with pytest.raises(VolumeLoadError, match="must be 3D"):
        await volume_loader.load_volume(str(file_path))


@pytest.mark.asyncio
async def test_extract_metadata(volume_loader, temp_dir):
    """Test that all metadata is correctly extracted"""
    # Create volume with specific properties
    volume = create_test_volume(
        size=(50, 60, 70),
        spacing=(0.5, 0.6, 0.7),
        origin=(10.0, 20.0, 30.0)
    )
    file_path = temp_dir / "test_volume.nii"
    sitk.WriteImage(volume, str(file_path))
    
    metadata = await volume_loader.load_volume(str(file_path))
    
    # Verify all metadata fields
    assert metadata.dimensions == (50, 60, 70)
    # Use approximate comparison for floating point values
    assert pytest.approx(metadata.spacing, rel=1e-5) == (0.5, 0.6, 0.7)
    assert pytest.approx(metadata.origin, rel=1e-5) == (10.0, 20.0, 30.0)
    assert len(metadata.direction) == 9
    assert metadata.number_of_components == 1
    assert metadata.size_bytes > 0


@pytest.mark.asyncio
async def test_file_not_found(volume_loader):
    """Test error handling for missing files"""
    with pytest.raises(VolumeLoadError, match="File not found"):
        await volume_loader.load_volume("/nonexistent/file.nii")


@pytest.mark.asyncio
async def test_unsupported_format(volume_loader, temp_dir):
    """Test error handling for unsupported file formats"""
    file_path = temp_dir / "test.txt"
    file_path.write_text("not a volume")
    
    with pytest.raises(VolumeLoadError, match="Unsupported file format"):
        await volume_loader.load_volume(str(file_path))


@pytest.mark.asyncio
async def test_get_volume(volume_loader, temp_dir):
    """Test retrieving a loaded volume"""
    volume = create_test_volume()
    file_path = temp_dir / "test_volume.nii"
    sitk.WriteImage(volume, str(file_path))
    
    metadata = await volume_loader.load_volume(str(file_path))
    
    # Retrieve volume
    retrieved_volume = volume_loader.get_volume(metadata.volume_id)
    assert retrieved_volume is not None
    assert retrieved_volume.GetSize() == (10, 10, 10)


@pytest.mark.asyncio
async def test_get_metadata(volume_loader, temp_dir):
    """Test retrieving volume metadata"""
    volume = create_test_volume()
    file_path = temp_dir / "test_volume.nii"
    sitk.WriteImage(volume, str(file_path))
    
    metadata = await volume_loader.load_volume(str(file_path))
    
    # Retrieve metadata
    retrieved_metadata = volume_loader.get_metadata(metadata.volume_id)
    assert retrieved_metadata.volume_id == metadata.volume_id
    assert retrieved_metadata.dimensions == metadata.dimensions


@pytest.mark.asyncio
async def test_unload_volume(volume_loader, temp_dir):
    """Test unloading a volume from cache"""
    volume = create_test_volume()
    file_path = temp_dir / "test_volume.nii"
    sitk.WriteImage(volume, str(file_path))
    
    metadata = await volume_loader.load_volume(str(file_path))
    volume_id = metadata.volume_id
    
    # Unload volume
    volume_loader.unload_volume(volume_id)
    
    # Should raise error when trying to retrieve
    with pytest.raises(VolumeLoadError, match="not found"):
        volume_loader.get_volume(volume_id)


@pytest.mark.asyncio
async def test_list_volumes(volume_loader, temp_dir):
    """Test listing all loaded volumes"""
    # Load multiple volumes
    for i in range(3):
        volume = create_test_volume()
        file_path = temp_dir / f"test_volume_{i}.nii"
        sitk.WriteImage(volume, str(file_path))
        await volume_loader.load_volume(str(file_path))
    
    # List volumes
    volumes = volume_loader.list_volumes()
    assert len(volumes) == 3
