"""Connected-component lesion volumes (mm³), same definition as get_label_stats."""

import numpy as np
import pytest
import SimpleITK as sitk

from services.volume_loader import VolumeLoaderService, connected_component_foreground_volumes_mm3


def test_two_components_volumes_mm3():
    arr = np.zeros((24, 24, 24), dtype=np.int16)
    arr[1:3, 1:3, 1:3] = 1  # 8 voxels
    arr[10:14, 10:14, 10:14] = 1  # 64 voxels
    img = sitk.GetImageFromArray(arr)
    img.SetSpacing((1.0, 1.0, 1.0))
    vols, skipped = connected_component_foreground_volumes_mm3(img)
    assert not skipped
    assert sorted(vols) == [8.0, 64.0]


def test_spacing_scales_volume():
    arr = np.zeros((10, 10, 10), dtype=np.int16)
    arr[0:2, 0:2, 0:2] = 1  # 8 voxels
    img = sitk.GetImageFromArray(arr)
    img.SetSpacing((2.0, 2.0, 2.0))  # voxel 8 mm³
    vols, skipped = connected_component_foreground_volumes_mm3(img)
    assert not skipped
    assert vols == [64.0]


def test_all_background():
    arr = np.zeros((5, 5, 5), dtype=np.int16)
    img = sitk.GetImageFromArray(arr)
    img.SetSpacing((1.0, 1.0, 1.0))
    vols, skipped = connected_component_foreground_volumes_mm3(img)
    assert skipped
    assert vols == []


@pytest.mark.asyncio
async def test_volume_loader_wrapper(tmp_path):
    arr = np.zeros((12, 12, 12), dtype=np.int16)
    arr[0:2, 0:2, 0:2] = 5
    img = sitk.GetImageFromArray(arr)
    img.SetSpacing((1.0, 1.0, 1.0))
    p = tmp_path / "seg.nii.gz"
    sitk.WriteImage(img, str(p))
    loader = VolumeLoaderService()
    meta = await loader.load_volume(str(p))
    vols, skipped = connected_component_foreground_volumes_mm3(loader.get_volume(meta.volume_id))
    assert not skipped
    assert vols == [8.0]
    loader.unload_volume(meta.volume_id)
