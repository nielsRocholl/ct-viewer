"""Per-case dataset statistics: geometry, CT intensity, seg labels, CC volumes, file metadata."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import SimpleITK as sitk

from services.volume_loader import VolumeMetadata, connected_component_foreground_volumes_mm3


def image_meta_dict(img: sitk.Image) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for k in img.GetMetaDataKeys():
        try:
            out[k] = img.GetMetaData(k)
        except Exception:
            out[k] = ""
    return out


def global_intensity(ct: sitk.Image) -> Dict[str, float]:
    s = sitk.StatisticsImageFilter()
    s.Execute(ct)
    return {
        "minimum": float(s.GetMinimum()),
        "maximum": float(s.GetMaximum()),
        "mean": float(s.GetMean()),
        "sigma": float(s.GetSigma()),
    }


def geometry_match(ct_meta: VolumeMetadata, seg_meta: VolumeMetadata) -> bool:
    return ct_meta.dimensions == seg_meta.dimensions and ct_meta.spacing == seg_meta.spacing


def compute_case_statistics(
    ct: sitk.Image,
    seg: sitk.Image,
    ct_meta: VolumeMetadata,
    seg_meta: VolumeMetadata,
    *,
    include_global_ct_intensity: bool = True,
    include_lesion_connected_components: bool = True,
    include_label_segmentation_stats: bool = True,
    include_per_label_ct_intensity: bool = True,
    include_file_metadata: bool = True,
) -> Dict[str, Any]:
    label_seg = include_label_segmentation_stats or include_per_label_ct_intensity

    global_intensity_dict: Optional[Dict[str, float]] = None
    if include_global_ct_intensity:
        global_intensity_dict = global_intensity(ct)

    vols: List[float] = []
    all_bg_cc = True
    max_cc: Optional[float] = None
    if include_lesion_connected_components:
        vols, all_bg_cc = connected_component_foreground_volumes_mm3(seg)
        max_cc = max(vols) if vols else None

    sp = seg.GetSpacing()
    voxel_mm3 = float(sp[0] * sp[1] * sp[2])

    label_values: List[int] = []
    per_label: List[Dict[str, Any]] = []
    multi_label = False
    all_bg_label = True

    if label_seg:
        ls = sitk.LabelStatisticsImageFilter()
        ls.Execute(seg, seg)
        for lab in ls.GetLabels():
            li = int(lab)
            if li == 0:
                continue
            label_values.append(li)
            cnt = int(ls.GetCount(li))
            per_label.append(
                {
                    "label": li,
                    "voxel_count": cnt,
                    "volume_mm3": float(cnt) * voxel_mm3,
                    "ct_mean": 0.0,
                    "ct_sigma": 0.0,
                    "ct_min": 0.0,
                    "ct_max": 0.0,
                }
            )
        label_values.sort()
        multi_label = len(label_values) > 1
        all_bg_label = len(label_values) == 0

    if include_per_label_ct_intensity and per_label:
        ls2 = sitk.LabelStatisticsImageFilter()
        ls2.Execute(ct, seg)
        ls2_labels = {int(x) for x in ls2.GetLabels()}
        for row in per_label:
            li = row["label"]
            if li in ls2_labels and ls2.GetCount(li) > 0:
                row["ct_mean"] = float(ls2.GetMean(li))
                row["ct_sigma"] = float(ls2.GetSigma(li))
                row["ct_min"] = float(ls2.GetMinimum(li))
                row["ct_max"] = float(ls2.GetMaximum(li))

    if include_lesion_connected_components:
        skipped = all_bg_cc
        warning = "No foreground voxels" if skipped else None
    elif label_seg:
        skipped = all_bg_label
        warning = "No foreground voxels" if skipped else None
    else:
        skipped = False
        warning = None

    ct_fm: Dict[str, str] = image_meta_dict(ct) if include_file_metadata else {}
    seg_fm: Dict[str, str] = image_meta_dict(seg) if include_file_metadata else {}

    return {
        "geometry_match": geometry_match(ct_meta, seg_meta),
        "volumes_mm3": vols,
        "max_component_mm3": max_cc,
        "skipped": skipped,
        "warning": warning,
        "global_intensity": global_intensity_dict,
        "label_values": label_values,
        "multi_label": multi_label,
        "per_label": per_label,
        "ct_meta": ct_meta,
        "seg_meta": seg_meta,
        "ct_file_meta": ct_fm,
        "seg_file_meta": seg_fm,
    }
