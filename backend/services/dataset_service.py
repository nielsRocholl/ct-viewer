"""Dataset Service

Scans server-side folders for image/label/pred files, matches cases by base name
(nnUNet convention: image files may have _0000 suffix, labels/preds by base name).
No volume loading; filesystem listing only.
"""

import logging
import os
import re
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {".nii", ".nii.gz", ".mha", ".mhd"}
NNUNET_MODALITY_SUFFIX = re.compile(r"_\d{4}$")


def _allowed_roots() -> List[Path]:
    raw = os.getenv("DATASET_ALLOWED_ROOTS", "")
    if not raw.strip():
        return []
    return [Path(p.strip()).resolve() for p in raw.split(",") if p.strip()]


def _under_allowed_root(path: Path, roots: List[Path]) -> bool:
    try:
        resolved = path.resolve()
        for root in roots:
            if root in resolved.parents or resolved == root:
                return True
    except (OSError, RuntimeError):
        pass
    return False


def _base_from_image(filename: str) -> str:
    """Strip extension and optional nnUNet modality _0000."""
    base = filename
    if base.endswith(".nii.gz"):
        base = base[:-7]
    else:
        for ext in SUPPORTED_EXTENSIONS:
            if ext != ".nii.gz" and base.endswith(ext):
                base = base[: -len(ext)]
                break
    base = NNUNET_MODALITY_SUFFIX.sub("", base)
    return base


def _base_from_label_or_pred(filename: str) -> str:
    """Strip extension only (labels/preds usually have no modality suffix)."""
    if filename.endswith(".nii.gz"):
        return filename[:-7]
    for ext in SUPPORTED_EXTENSIONS:
        if ext != ".nii.gz" and filename.endswith(ext):
            return filename[: -len(ext)]
    return filename


def _collect_by_base(
    dir_path: Path, roots: List[Path], base_fn, key: str
) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not dir_path.exists() or not dir_path.is_dir():
        return out
    try:
        resolved = dir_path.resolve()
        if roots and not _under_allowed_root(resolved, roots):
            logger.warning(f"Path not under allowed root: {dir_path}")
            return out
        for f in resolved.iterdir():
            if not f.is_file():
                continue
            name = f.name
            if name.endswith(".nii.gz"):
                ext = ".nii.gz"
            else:
                ext = f.suffix
            if ext not in SUPPORTED_EXTENSIONS:
                continue
            base = base_fn(name)
            p = str(f)
            if base not in out:
                out[base] = p
            elif key == "image":
                out[base] = min(out[base], p, key=lambda x: Path(x).name)
    except OSError as e:
        logger.warning(f"Error scanning {dir_path}: {e}")
    return out


def scan_dataset(
    images_dir: str,
    labels_dir: Optional[str] = None,
    preds_dir: Optional[str] = None,
) -> tuple[List[str], Dict[str, Dict[str, str]]]:
    """
    Scan folders and build case index. Returns (case_ids sorted, cases dict).
    cases[case_id] = { "image": path, "label": path?, "pred": path? }.
    Images use first file per case (alphabetically); nnUNet base name for matching.
    """
    roots = _allowed_roots()
    images_path = Path(images_dir)
    if not images_path.exists() or not images_path.is_dir():
        raise ValueError(f"Images directory does not exist: {images_dir}")
    if roots and not _under_allowed_root(images_path.resolve(), roots):
        raise ValueError(f"Images path not under allowed root: {images_dir}")

    image_bases = _collect_by_base(
        images_path, roots, _base_from_image, "image"
    )
    case_ids = sorted(image_bases.keys())
    if not case_ids:
        raise ValueError(f"No supported image files found in {images_dir}")

    labels_path = Path(labels_dir) if labels_dir else None
    preds_path = Path(preds_dir) if preds_dir else None
    if labels_path and roots and labels_path.exists():
        if not _under_allowed_root(labels_path.resolve(), roots):
            labels_path = None
    if preds_path and roots and preds_path.exists():
        if not _under_allowed_root(preds_path.resolve(), roots):
            preds_path = None

    label_bases = (
        _collect_by_base(labels_path, roots, _base_from_label_or_pred, "label")
        if labels_path and labels_path.exists()
        else {}
    )
    pred_bases = (
        _collect_by_base(preds_path, roots, _base_from_label_or_pred, "pred")
        if preds_path and preds_path.exists()
        else {}
    )

    cases: Dict[str, Dict[str, str]] = {}
    for cid in case_ids:
        entry: Dict[str, str] = {"image": image_bases[cid]}
        if cid in label_bases:
            entry["label"] = label_bases[cid]
        if cid in pred_bases:
            entry["pred"] = pred_bases[cid]
        cases[cid] = entry

    return case_ids, cases
