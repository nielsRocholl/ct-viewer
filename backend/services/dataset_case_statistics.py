"""Per-case dataset statistics: geometry, CT intensity, seg labels, CC volumes, file metadata."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

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


def global_intensity(ct: sitk.Image) -> Tuple[float, float, float, float]:
    s = sitk.StatisticsImageFilter()
    s.Execute(ct)
    return (float(s.GetMinimum()), float(s.GetMaximum()), float(s.GetMean()), float(s.GetSigma()))


def geometry_match(ct_meta: VolumeMetadata, seg_meta: VolumeMetadata) -> bool:
    return ct_meta.dimensions == seg_meta.dimensions and ct_meta.spacing == seg_meta.spacing


def compute_case_statistics(
    ct: sitk.Image,
    seg: sitk.Image,
    ct_meta: VolumeMetadata,
    seg_meta: VolumeMetadata,
) -> Dict[str, Any]:
    gmin, gmax, gmean, gsigma = global_intensity(ct)
    vols, all_bg = connected_component_foreground_volumes_mm3(seg)
    max_cc = max(vols) if vols else None

    sp = seg.GetSpacing()
    voxel_mm3 = float(sp[0] * sp[1] * sp[2])

    ls = sitk.LabelStatisticsImageFilter()
    ls.Execute(seg, seg)
    label_values: List[int] = []
    per_label: List[Dict[str, Any]] = []
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
            }
        )
    label_values.sort()
    multi_label = len(label_values) > 1

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
        else:
            row["ct_mean"] = 0.0
            row["ct_sigma"] = 0.0
            row["ct_min"] = 0.0
            row["ct_max"] = 0.0

    return {
        "geometry_match": geometry_match(ct_meta, seg_meta),
        "volumes_mm3": vols,
        "max_component_mm3": max_cc,
        "skipped": all_bg,
        "warning": "No foreground voxels" if all_bg else None,
        "global_intensity": {
            "minimum": gmin,
            "maximum": gmax,
            "mean": gmean,
            "sigma": gsigma,
        },
        "label_values": label_values,
        "multi_label": multi_label,
        "per_label": per_label,
        "ct_meta": ct_meta,
        "seg_meta": seg_meta,
        "ct_file_meta": image_meta_dict(ct),
        "seg_file_meta": image_meta_dict(seg),
    }
