"""dataset_case_statistics service: CT+seg stats."""

import numpy as np
import pytest
import SimpleITK as sitk
from datetime import datetime

from services.volume_loader import VolumeMetadata
from services.dataset_case_statistics import compute_case_statistics, geometry_match


def _meta(dims, spacing=(1.0, 1.0, 1.0), vid="t"):
    return VolumeMetadata(
        volume_id=vid,
        file_name="x.nii",
        dimensions=dims,
        spacing=spacing,
        origin=(0.0, 0.0, 0.0),
        direction=(1, 0, 0, 0, 1, 0, 0, 0, 1),
        pixel_type="16-bit signed integer",
        number_of_components=1,
        size_bytes=100,
        loaded_at=datetime.now(),
    )


def test_geometry_match():
    a = _meta((10, 10, 10))
    b = _meta((10, 10, 10))
    c = _meta((9, 10, 10))
    assert geometry_match(a, b) is True
    assert geometry_match(a, c) is False


def test_compute_one_label_ct_stats():
    w, h, d = 16, 16, 16
    ct_arr = np.zeros((d, h, w), dtype=np.int16)
    ct_arr[:] = 100
    ct_arr[4:10, 4:10, 4:10] = 500
    ct = sitk.GetImageFromArray(ct_arr)
    ct.SetSpacing((1.0, 1.0, 1.0))

    seg_arr = np.zeros((d, h, w), dtype=np.uint8)
    seg_arr[4:10, 4:10, 4:10] = 1
    seg = sitk.GetImageFromArray(seg_arr)
    seg.SetSpacing((1.0, 1.0, 1.0))

    ct_m = _meta((w, h, d), vid="ct")
    seg_m = _meta((w, h, d), vid="seg")
    out = compute_case_statistics(ct, seg, ct_m, seg_m)

    assert out["geometry_match"] is True
    assert out["skipped"] is False
    assert len(out["label_values"]) == 1
    assert out["label_values"][0] == 1
    assert out["multi_label"] is False
    assert out["max_component_mm3"] == 6**3 * 1.0
    pl = out["per_label"][0]
    assert pl["voxel_count"] == 6**3
    assert abs(pl["ct_mean"] - 500.0) < 1.0
    gi = out["global_intensity"]
    assert gi is not None
    assert gi["minimum"] <= 100 and gi["maximum"] >= 500


def test_flags_geometry_only():
    w, h, d = 8, 8, 8
    ct = sitk.GetImageFromArray(np.ones((d, h, w), dtype=np.int16))
    seg = sitk.GetImageFromArray(np.zeros((d, h, w), dtype=np.uint8))
    ct.SetSpacing((1, 1, 1))
    seg.SetSpacing((1, 1, 1))
    m = _meta((w, h, d))
    out = compute_case_statistics(
        ct,
        seg,
        m,
        m,
        include_global_ct_intensity=False,
        include_lesion_connected_components=False,
        include_label_segmentation_stats=False,
        include_per_label_ct_intensity=False,
        include_file_metadata=False,
    )
    assert out["global_intensity"] is None
    assert out["volumes_mm3"] == []
    assert out["per_label"] == []
    assert out["skipped"] is False
    assert out["ct_file_meta"] == {}


def test_all_background():
    ct_arr = np.ones((8, 8, 8), dtype=np.int16) * 42
    ct = sitk.GetImageFromArray(ct_arr)
    seg = sitk.GetImageFromArray(np.zeros((8, 8, 8), dtype=np.uint8))
    ct.SetSpacing((1, 1, 1))
    seg.SetSpacing((1, 1, 1))
    m = _meta((8, 8, 8))
    out = compute_case_statistics(ct, seg, m, m)
    assert out["skipped"] is True
    assert out["volumes_mm3"] == []
    assert out["max_component_mm3"] is None
