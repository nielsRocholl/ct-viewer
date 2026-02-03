"""Cache Manager Service

Implements LRU (Least Recently Used) cache for volumes and slices with
memory tracking and automatic eviction.

Usage:
    # Initialize cache with memory limit
    cache = CacheManager(max_memory_mb=4096)
    
    # Store a volume
    cache.put(volume_id, volume, size_bytes=volume_size)
    
    # Retrieve a volume
    volume = cache.get(volume_id)
    if volume is None:
        # Cache miss - load from disk
        pass
    
    # Get cache statistics
    stats = cache.get_statistics()
    print(f"Hit rate: {stats.hit_rate:.2%}")
    
    # Remove specific item
    cache.remove(volume_id)
    
    # Clear entire cache
    cache.clear()

Integration Notes:
    - VolumeLoaderService can use this to cache loaded volumes
    - SliceExtractorService can use this to cache extracted slices
    - The cache automatically evicts LRU items when memory limit is reached
    - Cache keys should be unique identifiers (volume_id, slice_key, etc.)
"""

import logging
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional

import SimpleITK as sitk

logger = logging.getLogger(__name__)


@dataclass
class CacheEntry:
    """Entry in the cache with metadata"""
    key: str
    data: Any
    size_bytes: int
    accessed_at: datetime
    created_at: datetime


@dataclass
class CacheStatistics:
    """Statistics about cache usage"""
    total_entries: int
    total_size_bytes: int
    max_size_bytes: int
    hit_count: int
    miss_count: int
    eviction_count: int
    hit_rate: float


class CacheManager:
    """LRU cache manager with memory tracking and eviction"""
    
    def __init__(self, max_memory_mb: int = 4096):
        """Initialize cache with memory limit
        
        Args:
            max_memory_mb: Maximum cache size in megabytes (default 4GB)
        """
        self.max_memory_bytes = max_memory_mb * 1024 * 1024
        self._cache: OrderedDict[str, CacheEntry] = OrderedDict()
        self._current_size_bytes = 0
        
        # Statistics
        self._hit_count = 0
        self._miss_count = 0
        self._eviction_count = 0
        
        logger.info(
            f"CacheManager initialized with max memory: "
            f"{max_memory_mb}MB ({self.max_memory_bytes} bytes)"
        )
    
    def put(self, key: str, data: Any, size_bytes: Optional[int] = None) -> None:
        """Add or update an item in the cache
        
        If the item already exists, it will be moved to the end (most recent).
        If adding the item would exceed memory limit, LRU items are evicted.
        
        Args:
            key: Cache key
            data: Data to cache (volume, slice, etc.)
            size_bytes: Size of data in bytes (calculated if not provided)
        """
        # Calculate size if not provided
        if size_bytes is None:
            size_bytes = self._calculate_size(data)
        
        # Check if item is too large for cache BEFORE evicting anything
        if size_bytes > self.max_memory_bytes:
            logger.warning(
                f"Item {key} ({size_bytes / (1024**2):.2f}MB) exceeds "
                f"cache limit ({self.max_memory_bytes / (1024**2):.2f}MB), "
                f"not caching"
            )
            return
        
        # Check if key already exists
        if key in self._cache:
            # Remove old entry to update it
            old_entry = self._cache[key]
            self._current_size_bytes -= old_entry.size_bytes
            del self._cache[key]
        
        # Evict items if necessary to make room
        while (self._current_size_bytes + size_bytes > self.max_memory_bytes 
               and len(self._cache) > 0):
            self.evict_lru()
        
        # Create new entry
        now = datetime.now()
        entry = CacheEntry(
            key=key,
            data=data,
            size_bytes=size_bytes,
            accessed_at=now,
            created_at=now
        )
        
        # Add to cache (at end = most recent)
        self._cache[key] = entry
        self._current_size_bytes += size_bytes
        
        logger.debug(
            f"Cached {key}: {size_bytes / (1024**2):.2f}MB, "
            f"total cache: {self._current_size_bytes / (1024**2):.2f}MB"
        )
    
    def get(self, key: str) -> Optional[Any]:
        """Retrieve an item from the cache
        
        If found, the item is moved to the end (most recent).
        
        Args:
            key: Cache key
            
        Returns:
            Cached data if found, None otherwise
        """
        if key not in self._cache:
            self._miss_count += 1
            logger.debug(f"Cache miss: {key}")
            return None
        
        # Move to end (most recent)
        entry = self._cache.pop(key)
        entry.accessed_at = datetime.now()
        self._cache[key] = entry
        
        self._hit_count += 1
        logger.debug(f"Cache hit: {key}")
        
        return entry.data
    
    def evict_lru(self) -> None:
        """Evict the least recently used item from cache"""
        if not self._cache:
            return
        
        # Remove first item (least recently used)
        key, entry = self._cache.popitem(last=False)
        self._current_size_bytes -= entry.size_bytes
        self._eviction_count += 1
        
        logger.info(
            f"Evicted LRU item {key}: {entry.size_bytes / (1024**2):.2f}MB, "
            f"remaining cache: {self._current_size_bytes / (1024**2):.2f}MB"
        )
    
    def remove(self, key: str) -> bool:
        """Remove a specific item from cache
        
        Args:
            key: Cache key
            
        Returns:
            True if item was removed, False if not found
        """
        if key not in self._cache:
            return False
        
        entry = self._cache.pop(key)
        self._current_size_bytes -= entry.size_bytes
        
        logger.debug(
            f"Removed {key}: {entry.size_bytes / (1024**2):.2f}MB, "
            f"remaining cache: {self._current_size_bytes / (1024**2):.2f}MB"
        )
        
        return True
    
    def clear(self) -> None:
        """Clear all items from cache"""
        count = len(self._cache)
        size_mb = self._current_size_bytes / (1024**2)
        
        self._cache.clear()
        self._current_size_bytes = 0
        
        logger.info(f"Cleared cache: removed {count} items, freed {size_mb:.2f}MB")
    
    def get_statistics(self) -> CacheStatistics:
        """Get cache statistics
        
        Returns:
            CacheStatistics with current cache metrics
        """
        total_requests = self._hit_count + self._miss_count
        hit_rate = (
            self._hit_count / total_requests 
            if total_requests > 0 
            else 0.0
        )
        
        return CacheStatistics(
            total_entries=len(self._cache),
            total_size_bytes=self._current_size_bytes,
            max_size_bytes=self.max_memory_bytes,
            hit_count=self._hit_count,
            miss_count=self._miss_count,
            eviction_count=self._eviction_count,
            hit_rate=hit_rate
        )
    
    def get_stats(self) -> Dict[str, float]:
        """Get simplified cache statistics as dictionary
        
        Returns:
            Dictionary with cache metrics for logging
        """
        return {
            "volume_count": len(self._cache),
            "memory_used_mb": self._current_size_bytes / (1024**2),
            "memory_limit_mb": self.max_memory_bytes / (1024**2),
            "hit_rate": (
                self._hit_count / (self._hit_count + self._miss_count)
                if (self._hit_count + self._miss_count) > 0
                else 0.0
            )
        }
    
    def contains(self, key: str) -> bool:
        """Check if a key exists in cache
        
        Args:
            key: Cache key
            
        Returns:
            True if key exists, False otherwise
        """
        return key in self._cache
    
    @staticmethod
    def _calculate_size(data: Any) -> int:
        """Calculate approximate size of data in bytes
        
        Args:
            data: Data to measure
            
        Returns:
            Approximate size in bytes
        """
        if isinstance(data, sitk.Image):
            # Calculate SimpleITK image size
            dimensions = data.GetSize()
            components = data.GetNumberOfComponentsPerPixel()
            pixel_id = data.GetPixelID()
            
            # Get pixel size in bytes
            pixel_sizes = {
                sitk.sitkUInt8: 1,
                sitk.sitkInt8: 1,
                sitk.sitkUInt16: 2,
                sitk.sitkInt16: 2,
                sitk.sitkUInt32: 4,
                sitk.sitkInt32: 4,
                sitk.sitkUInt64: 8,
                sitk.sitkInt64: 8,
                sitk.sitkFloat32: 4,
                sitk.sitkFloat64: 8,
            }
            pixel_size = pixel_sizes.get(pixel_id, 4)
            
            # Calculate total size
            total_voxels = 1
            for dim in dimensions:
                total_voxels *= dim
            
            return total_voxels * components * pixel_size
        
        elif isinstance(data, bytes):
            return len(data)
        
        else:
            # Fallback: estimate using sys.getsizeof
            import sys
            return sys.getsizeof(data)
