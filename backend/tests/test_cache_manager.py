"""Tests for Cache Manager Service"""

import pytest
import SimpleITK as sitk
import numpy as np
from datetime import datetime
from services.cache_manager import CacheManager, CacheEntry, CacheStatistics


class TestCacheManager:
    """Test suite for CacheManager"""
    
    def test_initialization(self):
        """Test cache manager initialization"""
        cache = CacheManager(max_memory_mb=100)
        assert cache.max_memory_bytes == 100 * 1024 * 1024
        
        stats = cache.get_statistics()
        assert stats.total_entries == 0
        assert stats.total_size_bytes == 0
        assert stats.hit_count == 0
        assert stats.miss_count == 0
        assert stats.eviction_count == 0
    
    def test_put_and_get_simple_data(self):
        """Test putting and getting simple data"""
        cache = CacheManager(max_memory_mb=10)
        
        # Put some data
        cache.put("key1", b"test data", size_bytes=100)
        
        # Get the data
        data = cache.get("key1")
        assert data == b"test data"
        
        # Check statistics
        stats = cache.get_statistics()
        assert stats.total_entries == 1
        assert stats.hit_count == 1
        assert stats.miss_count == 0
    
    def test_cache_miss(self):
        """Test cache miss behavior"""
        cache = CacheManager(max_memory_mb=10)
        
        # Try to get non-existent key
        data = cache.get("nonexistent")
        assert data is None
        
        # Check statistics
        stats = cache.get_statistics()
        assert stats.miss_count == 1
        assert stats.hit_count == 0
    
    def test_lru_eviction(self):
        """Test LRU eviction when cache is full"""
        # Small cache that can hold ~2 items of 1MB each
        cache = CacheManager(max_memory_mb=2)
        
        # Add items that will fill the cache
        cache.put("item1", b"x" * (1024 * 1024), size_bytes=1024 * 1024)  # 1MB
        cache.put("item2", b"y" * (1024 * 1024), size_bytes=1024 * 1024)  # 1MB
        
        # Both should be in cache
        assert cache.contains("item1")
        assert cache.contains("item2")
        
        # Add third item, should evict item1 (least recently used)
        cache.put("item3", b"z" * (1024 * 1024), size_bytes=1024 * 1024)  # 1MB
        
        # item1 should be evicted
        assert not cache.contains("item1")
        assert cache.contains("item2")
        assert cache.contains("item3")
        
        # Check eviction count
        stats = cache.get_statistics()
        assert stats.eviction_count == 1
    
    def test_lru_order_with_access(self):
        """Test that accessing an item updates its LRU position"""
        cache = CacheManager(max_memory_mb=2)
        
        # Add two items
        cache.put("item1", b"x" * (1024 * 1024), size_bytes=1024 * 1024)
        cache.put("item2", b"y" * (1024 * 1024), size_bytes=1024 * 1024)
        
        # Access item1 to make it more recent
        cache.get("item1")
        
        # Add third item, should evict item2 (now least recently used)
        cache.put("item3", b"z" * (1024 * 1024), size_bytes=1024 * 1024)
        
        # item2 should be evicted, item1 should remain
        assert cache.contains("item1")
        assert not cache.contains("item2")
        assert cache.contains("item3")
    
    def test_update_existing_key(self):
        """Test updating an existing key"""
        cache = CacheManager(max_memory_mb=10)
        
        # Add initial data
        cache.put("key1", b"old data", size_bytes=100)
        
        # Update with new data
        cache.put("key1", b"new data", size_bytes=200)
        
        # Should have new data
        data = cache.get("key1")
        assert data == b"new data"
        
        # Should only have one entry
        stats = cache.get_statistics()
        assert stats.total_entries == 1
        assert stats.total_size_bytes == 200
    
    def test_remove_item(self):
        """Test removing a specific item"""
        cache = CacheManager(max_memory_mb=10)
        
        cache.put("key1", b"data1", size_bytes=100)
        cache.put("key2", b"data2", size_bytes=200)
        
        # Remove key1
        removed = cache.remove("key1")
        assert removed is True
        assert not cache.contains("key1")
        assert cache.contains("key2")
        
        # Try to remove non-existent key
        removed = cache.remove("nonexistent")
        assert removed is False
        
        # Check size updated
        stats = cache.get_statistics()
        assert stats.total_size_bytes == 200
    
    def test_clear_cache(self):
        """Test clearing all cache entries"""
        cache = CacheManager(max_memory_mb=10)
        
        cache.put("key1", b"data1", size_bytes=100)
        cache.put("key2", b"data2", size_bytes=200)
        cache.put("key3", b"data3", size_bytes=300)
        
        # Clear cache
        cache.clear()
        
        # All items should be gone
        assert not cache.contains("key1")
        assert not cache.contains("key2")
        assert not cache.contains("key3")
        
        stats = cache.get_statistics()
        assert stats.total_entries == 0
        assert stats.total_size_bytes == 0
    
    def test_item_too_large_for_cache(self):
        """Test handling of items larger than cache limit"""
        cache = CacheManager(max_memory_mb=1)  # 1MB cache
        
        # Try to add 2MB item
        large_data = b"x" * (2 * 1024 * 1024)
        cache.put("large", large_data, size_bytes=2 * 1024 * 1024)
        
        # Item should not be cached
        assert not cache.contains("large")
        
        # Cache should still work for smaller items
        cache.put("small", b"data", size_bytes=100)
        assert cache.contains("small")
    
    def test_hit_rate_calculation(self):
        """Test hit rate calculation in statistics"""
        cache = CacheManager(max_memory_mb=10)
        
        cache.put("key1", b"data", size_bytes=100)
        
        # 3 hits
        cache.get("key1")
        cache.get("key1")
        cache.get("key1")
        
        # 2 misses
        cache.get("nonexistent1")
        cache.get("nonexistent2")
        
        stats = cache.get_statistics()
        assert stats.hit_count == 3
        assert stats.miss_count == 2
        assert stats.hit_rate == 0.6  # 3/5
    
    def test_simpleitk_image_size_calculation(self):
        """Test size calculation for SimpleITK images"""
        cache = CacheManager(max_memory_mb=100)
        
        # Create a small test volume (10x10x10, int16)
        volume = sitk.Image(10, 10, 10, sitk.sitkInt16)
        
        # Put in cache (size will be calculated automatically)
        cache.put("volume", volume)
        
        # Expected size: 10 * 10 * 10 * 2 bytes (int16) = 2000 bytes
        stats = cache.get_statistics()
        assert stats.total_size_bytes == 2000
    
    def test_bytes_size_calculation(self):
        """Test size calculation for bytes data"""
        cache = CacheManager(max_memory_mb=10)
        
        data = b"x" * 1000
        cache.put("bytes", data)
        
        stats = cache.get_statistics()
        assert stats.total_size_bytes == 1000
    
    def test_multiple_evictions(self):
        """Test multiple evictions when adding large item"""
        cache = CacheManager(max_memory_mb=3)
        
        # Add 3 items of 1MB each
        cache.put("item1", b"x" * (1024 * 1024), size_bytes=1024 * 1024)
        cache.put("item2", b"y" * (1024 * 1024), size_bytes=1024 * 1024)
        cache.put("item3", b"z" * (1024 * 1024), size_bytes=1024 * 1024)
        
        # Add 2MB item, should evict item1 and item2 (LRU order)
        # item3 and large should remain (total 3MB)
        cache.put("large", b"w" * (2 * 1024 * 1024), size_bytes=2 * 1024 * 1024)
        
        assert not cache.contains("item1")
        assert not cache.contains("item2")
        assert cache.contains("item3")  # Most recent before large, should remain
        assert cache.contains("large")
        
        stats = cache.get_statistics()
        assert stats.eviction_count == 2
    
    def test_contains_method(self):
        """Test the contains method"""
        cache = CacheManager(max_memory_mb=10)
        
        assert not cache.contains("key1")
        
        cache.put("key1", b"data", size_bytes=100)
        assert cache.contains("key1")
        
        cache.remove("key1")
        assert not cache.contains("key1")
    
    def test_cache_with_realistic_volumes(self):
        """Test cache with realistic medical imaging volumes"""
        # Cache that can hold ~2 volumes of 512x512x100
        cache = CacheManager(max_memory_mb=100)
        
        # Create two volumes (512x512x100, int16)
        # Size: 512 * 512 * 100 * 2 = ~50MB each
        volume1 = sitk.Image(512, 512, 100, sitk.sitkInt16)
        volume2 = sitk.Image(512, 512, 100, sitk.sitkInt16)
        
        cache.put("volume1", volume1)
        cache.put("volume2", volume2)
        
        # Both should fit
        assert cache.contains("volume1")
        assert cache.contains("volume2")
        
        # Add third volume, should evict first
        volume3 = sitk.Image(512, 512, 100, sitk.sitkInt16)
        cache.put("volume3", volume3)
        
        assert not cache.contains("volume1")
        assert cache.contains("volume2")
        assert cache.contains("volume3")
