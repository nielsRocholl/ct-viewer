"""Geometry Validator Service

Validates geometry compatibility between CT volumes and segmentation masks.
Compares dimensions, spacing, origin, and direction with tolerance-based matching.
"""

import logging
from dataclasses import dataclass
from typing import List, Any, Tuple

from services.volume_loader import VolumeMetadata

logger = logging.getLogger(__name__)


@dataclass
class GeometryMismatch:
    """Details about a geometry mismatch between CT and segmentation"""
    field: str  # 'dimensions', 'spacing', 'origin', 'direction'
    ct_value: Any
    seg_value: Any
    difference: float


@dataclass
class GeometryValidationResult:
    """Result of geometry validation"""
    compatible: bool
    mismatches: List[GeometryMismatch]


class GeometryMismatchError(Exception):
    """Raised when geometry validation fails"""
    pass


class GeometryValidatorService:
    """Service for validating geometry compatibility between volumes"""
    
    def __init__(self, tolerance: float = 0.001):
        """Initialize geometry validator
        
        Args:
            tolerance: Maximum allowed difference for floating-point comparisons
        """
        self.tolerance = tolerance
        logger.info(f"GeometryValidatorService initialized with tolerance={tolerance}")
    
    def validate_geometry(
        self,
        ct_metadata: VolumeMetadata,
        seg_metadata: VolumeMetadata,
        tolerance: float = None
    ) -> GeometryValidationResult:
        """Validate geometry compatibility between CT and segmentation
        
        Compares dimensions, spacing, origin, and direction cosines.
        
        Args:
            ct_metadata: Metadata for the CT volume
            seg_metadata: Metadata for the segmentation mask
            tolerance: Optional override for tolerance (default: use instance tolerance)
            
        Returns:
            GeometryValidationResult with compatibility status and mismatch details
        """
        if tolerance is None:
            tolerance = self.tolerance
        
        mismatches: List[GeometryMismatch] = []
        
        # Validate dimensions (must match exactly)
        if ct_metadata.dimensions != seg_metadata.dimensions:
            mismatches.append(GeometryMismatch(
                field='dimensions',
                ct_value=ct_metadata.dimensions,
                seg_value=seg_metadata.dimensions,
                difference=self._calculate_dimension_difference(
                    ct_metadata.dimensions,
                    seg_metadata.dimensions
                )
            ))
            logger.warning(
                f"Dimension mismatch: CT={ct_metadata.dimensions}, "
                f"Seg={seg_metadata.dimensions}"
            )
        
        # Validate spacing (within tolerance)
        spacing_diff = self._calculate_tuple_difference(
            ct_metadata.spacing,
            seg_metadata.spacing
        )
        if spacing_diff > tolerance:
            mismatches.append(GeometryMismatch(
                field='spacing',
                ct_value=ct_metadata.spacing,
                seg_value=seg_metadata.spacing,
                difference=spacing_diff
            ))
            logger.warning(
                f"Spacing mismatch: CT={ct_metadata.spacing}, "
                f"Seg={seg_metadata.spacing}, diff={spacing_diff:.6f}"
            )
        
        # Validate origin (within tolerance)
        origin_diff = self._calculate_tuple_difference(
            ct_metadata.origin,
            seg_metadata.origin
        )
        if origin_diff > tolerance:
            mismatches.append(GeometryMismatch(
                field='origin',
                ct_value=ct_metadata.origin,
                seg_value=seg_metadata.origin,
                difference=origin_diff
            ))
            logger.warning(
                f"Origin mismatch: CT={ct_metadata.origin}, "
                f"Seg={seg_metadata.origin}, diff={origin_diff:.6f}"
            )
        
        # Validate direction (within tolerance)
        direction_diff = self._calculate_tuple_difference(
            ct_metadata.direction,
            seg_metadata.direction
        )
        if direction_diff > tolerance:
            mismatches.append(GeometryMismatch(
                field='direction',
                ct_value=ct_metadata.direction,
                seg_value=seg_metadata.direction,
                difference=direction_diff
            ))
            logger.warning(
                f"Direction mismatch: CT={ct_metadata.direction}, "
                f"Seg={seg_metadata.direction}, diff={direction_diff:.6f}"
            )
        
        compatible = len(mismatches) == 0
        
        if compatible:
            logger.info(
                f"Geometry validation passed: CT volume {ct_metadata.volume_id} "
                f"and segmentation {seg_metadata.volume_id} are compatible"
            )
        else:
            logger.warning(
                f"Geometry validation failed: {len(mismatches)} mismatches found"
            )
        
        return GeometryValidationResult(
            compatible=compatible,
            mismatches=mismatches
        )
    
    @staticmethod
    def _calculate_tuple_difference(tuple1: Tuple[float, ...], tuple2: Tuple[float, ...]) -> float:
        """Calculate maximum absolute difference between tuple elements
        
        Args:
            tuple1: First tuple of floats
            tuple2: Second tuple of floats
            
        Returns:
            Maximum absolute difference across all elements
        """
        if len(tuple1) != len(tuple2):
            return float('inf')
        
        return max(abs(a - b) for a, b in zip(tuple1, tuple2))
    
    @staticmethod
    def _calculate_dimension_difference(dim1: Tuple[int, int, int], dim2: Tuple[int, int, int]) -> float:
        """Calculate difference metric for dimensions
        
        For dimensions, we use the sum of absolute differences since they must match exactly.
        
        Args:
            dim1: First dimension tuple
            dim2: Second dimension tuple
            
        Returns:
            Sum of absolute differences
        """
        return float(sum(abs(a - b) for a, b in zip(dim1, dim2)))
    
    def format_validation_error(self, result: GeometryValidationResult) -> str:
        """Format validation result as a user-friendly error message
        
        Args:
            result: The validation result
            
        Returns:
            Formatted error message describing all mismatches
        """
        if result.compatible:
            return "Geometry is compatible"
        
        lines = ["Geometry validation failed:"]
        
        for mismatch in result.mismatches:
            if mismatch.field == 'dimensions':
                lines.append(
                    f"  - Dimensions: CT={mismatch.ct_value}, "
                    f"Segmentation={mismatch.seg_value}"
                )
            elif mismatch.field == 'spacing':
                lines.append(
                    f"  - Spacing: CT={mismatch.ct_value}, "
                    f"Segmentation={mismatch.seg_value} "
                    f"(difference: {mismatch.difference:.6f} mm)"
                )
            elif mismatch.field == 'origin':
                lines.append(
                    f"  - Origin: CT={mismatch.ct_value}, "
                    f"Segmentation={mismatch.seg_value} "
                    f"(difference: {mismatch.difference:.6f} mm)"
                )
            elif mismatch.field == 'direction':
                lines.append(
                    f"  - Direction: CT={mismatch.ct_value}, "
                    f"Segmentation={mismatch.seg_value} "
                    f"(difference: {mismatch.difference:.6f})"
                )
        
        return "\n".join(lines)
