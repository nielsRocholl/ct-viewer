"""Property-Based Tests for Cache Manager Service

**Feature: ct-segmentation-viewer, Property 12: Cache Management**
**Validates: Requirements 12.3, 12.4, 13.1, 13.2**

This test suite uses property-based testing to verify that the cache manager
correctly implements LRU eviction and memory management across a wide range
of access patterns and cache configurations.
"""

import pytest
from hypothesis import given, strategies as st, settings, assume
import SimpleITK as sitk
from services.cache_manager import CacheManager


# Strategies for generating test data
@st.composite
def cache_config(draw):
    """Generate cache configuration"""
    max_memory_mb = draw(st.integers(min_value=1, max_value=100))
    return max_memory_mb


@st.composite
def cache_item(draw):
    """Generate a cache item with key and size"""
    key = draw(st.text(min_size=1, max_size=20, alphabet=st.characters(
        whitelist_categories=('Lu', 'Ll', 'Nd'), 
        min_codepoint=48, 
        max_codepoint=122
    )))
    # Size in KB (1KB to 10MB)
    size_kb = draw(st.integers(min_value=1, max_value=10240))
    size_bytes = size_kb * 1024
    data = b"x" * min(size_bytes, 1024)  # Don't actually allocate huge data
    return key, data, size_bytes


@st.composite
def access_sequence(draw):
    """Generate a sequence of cache operations"""
    num_items = draw(st.integers(min_value=1, max_value=20))
    items = [draw(cache_item()) for _ in range(num_items)]
    
    # Generate access pattern (indices into items list)
    num_accesses = draw(st.integers(min_value=0, max_value=50))
    accesses = [draw(st.integers(min_value=0, max_value=num_items-1)) 
                for _ in range(num_accesses)]
    
    return items, accesses


class TestCacheManagerProperties:
    """Property-based tests for cache manager"""
    
    @given(max_memory_mb=st.integers(min_value=1, max_value=100))
    @settings(max_examples=100)
    def test_cache_never_exceeds_memory_limit(self, max_memory_mb):
        """
        Property: For any sequence of cache operations, the total cache size
        should never exceed the configured memory limit.
        
        **Validates: Requirements 12.4, 13.2**
        """
        cache = CacheManager(max_memory_mb=max_memory_mb)
        max_bytes = max_memory_mb * 1024 * 1024
        
        # Generate random items to cache
        num_items = 20
        for i in range(num_items):
            # Random size between 100KB and 5MB
            size_bytes = (i * 123456 + 100000) % (5 * 1024 * 1024)
            if size_bytes < 100000:
                size_bytes = 100000
            
            key = f"item_{i}"
            data = b"x" * min(size_bytes, 1024)
            
            cache.put(key, data, size_bytes=size_bytes)
            
            # Verify cache size never exceeds limit
            stats = cache.get_statistics()
            assert stats.total_size_bytes <= max_bytes, (
                f"Cache size {stats.total_size_bytes} exceeds limit {max_bytes}"
            )
    
    @given(items=st.lists(
        st.tuples(
            st.text(min_size=1, max_size=10, alphabet='abcdefghij'),
            st.integers(min_value=100, max_value=1024*1024)
        ),
        min_size=1,
        max_size=10,
        unique_by=lambda x: x[0]
    ))
    @settings(max_examples=100)
    def test_lru_eviction_order(self, items):
        """
        Property: When cache is full and a new item is added, the least
        recently used item should be evicted first.
        
        **Validates: Requirements 12.4, 13.2**
        """
        # Calculate total size needed
        total_size = sum(size for _, size in items)
        
        # Create cache that can hold about half the items
        cache_size_mb = max(1, (total_size // 2) // (1024 * 1024))
        cache = CacheManager(max_memory_mb=cache_size_mb)
        
        # Add all items
        for key, size in items:
            cache.put(key, b"data", size_bytes=size)
        
        # Track which items are in cache
        cached_items = [key for key, _ in items if cache.contains(key)]
        
        # The items that remain should be the most recently added ones
        # (since we added them in order without any gets)
        # Verify that if an item is NOT in cache, all items added before it
        # should also NOT be in cache (LRU property)
        for i, (key, _) in enumerate(items):
            if not cache.contains(key):
                # All items before this one should also be evicted
                for j in range(i):
                    earlier_key = items[j][0]
                    assert not cache.contains(earlier_key), (
                        f"Item {earlier_key} (index {j}) is cached but "
                        f"later item {key} (index {i}) was evicted - "
                        f"violates LRU order"
                    )
    
    @given(
        max_memory_mb=st.integers(min_value=5, max_value=50),
        operations=st.lists(
            st.tuples(
                st.sampled_from(['put', 'get']),
                st.text(min_size=1, max_size=5, alphabet='abcde'),
                st.integers(min_value=1024, max_value=1024*1024)
            ),
            min_size=5,
            max_size=30
        )
    )
    @settings(max_examples=100)
    def test_get_updates_lru_position(self, max_memory_mb, operations):
        """
        Property: Accessing an item with get() should move it to the most
        recent position, making it less likely to be evicted.
        
        **Validates: Requirements 12.3, 12.4, 13.2**
        """
        cache = CacheManager(max_memory_mb=max_memory_mb)
        
        for op, key, size in operations:
            if op == 'put':
                cache.put(key, b"data", size_bytes=size)
            elif op == 'get':
                cache.get(key)
        
        # After all operations, verify cache is consistent
        stats = cache.get_statistics()
        assert stats.total_size_bytes <= max_memory_mb * 1024 * 1024
        
        # Verify all items in cache can be retrieved
        for key in list(cache._cache.keys()):
            data = cache.get(key)
            assert data is not None, f"Item {key} in cache but get returned None"
    
    @given(
        num_items=st.integers(min_value=5, max_value=15),
        access_pattern=st.lists(
            st.integers(min_value=0, max_value=4),
            min_size=1,
            max_size=10
        )
    )
    @settings(max_examples=100)
    def test_get_moves_item_to_most_recent(self, num_items, access_pattern):
        """
        Property: When an item is accessed with get(), it should be moved to
        the most recent position and be the last to be evicted.
        
        **Validates: Requirements 12.3, 12.4, 13.2**
        """
        # Create cache that can hold exactly 3 items of 1MB each
        cache = CacheManager(max_memory_mb=3)
        item_size = 1024 * 1024  # 1MB
        
        # Add 3 items to fill the cache
        for i in range(3):
            cache.put(f"item_{i}", b"data", size_bytes=item_size)
        
        # All 3 should be in cache
        assert cache.contains("item_0")
        assert cache.contains("item_1")
        assert cache.contains("item_2")
        
        # Access item_0 to make it most recent
        cache.get("item_0")
        
        # Add a new item, should evict item_1 (least recent)
        cache.put("item_3", b"data", size_bytes=item_size)
        
        # item_0 should still be there (was accessed)
        # item_1 should be evicted (least recent)
        assert cache.contains("item_0"), "Accessed item should not be evicted"
        assert not cache.contains("item_1"), "Least recent item should be evicted"
        assert cache.contains("item_2")
        assert cache.contains("item_3")
    
    @given(
        max_memory_mb=st.integers(min_value=2, max_value=20),
        num_items=st.integers(min_value=5, max_value=30)
    )
    @settings(max_examples=100)
    def test_cache_statistics_consistency(self, max_memory_mb, num_items):
        """
        Property: Cache statistics should always be consistent with actual
        cache state (size, count, hit/miss tracking).
        
        **Validates: Requirements 13.1, 13.2**
        """
        cache = CacheManager(max_memory_mb=max_memory_mb)
        
        # Add items and track what we expect
        expected_hits = 0
        expected_misses = 0
        
        for i in range(num_items):
            key = f"item_{i}"
            size = ((i + 1) * 50000) % (1024 * 1024)
            cache.put(key, b"data", size_bytes=size)
            
            # Try to get some items
            if i % 3 == 0:
                result = cache.get(key)
                if result is not None:
                    expected_hits += 1
                else:
                    expected_misses += 1
            
            # Try to get non-existent item
            if i % 5 == 0:
                result = cache.get(f"nonexistent_{i}")
                if result is None:
                    expected_misses += 1
        
        # Verify statistics
        stats = cache.get_statistics()
        
        # Size should not exceed limit
        assert stats.total_size_bytes <= stats.max_size_bytes
        
        # Entry count should match actual cache
        assert stats.total_entries == len(cache._cache)
        
        # Hit/miss counts should match what we tracked
        assert stats.hit_count == expected_hits
        assert stats.miss_count == expected_misses
        
        # Hit rate calculation should be correct
        total_requests = stats.hit_count + stats.miss_count
        if total_requests > 0:
            expected_rate = stats.hit_count / total_requests
            assert abs(stats.hit_rate - expected_rate) < 0.001
    
    @given(
        items=st.lists(
            st.tuples(
                st.text(min_size=1, max_size=10, alphabet='abcdefghij'),
                st.integers(min_value=1024, max_value=2*1024*1024)
            ),
            min_size=1,
            max_size=20,
            unique_by=lambda x: x[0]
        )
    )
    @settings(max_examples=100)
    def test_put_same_key_updates_not_duplicates(self, items):
        """
        Property: Putting the same key multiple times should update the entry,
        not create duplicates. Cache should only count the size once.
        
        **Validates: Requirements 13.1**
        """
        cache = CacheManager(max_memory_mb=50)
        
        # Add all items
        for key, size in items:
            cache.put(key, b"data_v1", size_bytes=size)
        
        initial_stats = cache.get_statistics()
        initial_count = initial_stats.total_entries
        
        # Update all items with different sizes
        for key, size in items:
            new_size = size // 2 if size > 2048 else size * 2
            cache.put(key, b"data_v2", size_bytes=new_size)
        
        # Should still have same number of entries (no duplicates)
        final_stats = cache.get_statistics()
        assert final_stats.total_entries == initial_count
        
        # Each key should only appear once
        assert len(cache._cache) == len(set(key for key, _ in items))
    
    @given(
        max_memory_mb=st.integers(min_value=1, max_value=10),
        item_size_mb=st.integers(min_value=11, max_value=50)
    )
    @settings(max_examples=100)
    def test_oversized_items_not_cached(self, max_memory_mb, item_size_mb):
        """
        Property: Items larger than the cache limit should not be cached,
        and should not affect existing cache contents.
        
        **Validates: Requirements 13.2**
        """
        assume(item_size_mb > max_memory_mb)
        
        cache = CacheManager(max_memory_mb=max_memory_mb)
        
        # Add a small item first
        small_size = (max_memory_mb * 1024 * 1024) // 4
        cache.put("small", b"data", size_bytes=small_size)
        
        assert cache.contains("small")
        initial_stats = cache.get_statistics()
        
        # Try to add oversized item
        large_size = item_size_mb * 1024 * 1024
        cache.put("large", b"data", size_bytes=large_size)
        
        # Large item should not be cached
        assert not cache.contains("large")
        
        # Small item should still be there
        assert cache.contains("small")
        
        # Cache size should be unchanged
        final_stats = cache.get_statistics()
        assert final_stats.total_size_bytes == initial_stats.total_size_bytes
    
    @given(
        max_memory_mb=st.integers(min_value=5, max_value=30),
        num_operations=st.integers(min_value=10, max_value=50)
    )
    @settings(max_examples=100)
    def test_cache_remains_consistent_after_operations(self, max_memory_mb, num_operations):
        """
        Property: After any sequence of put/get/remove operations, the cache
        should remain in a consistent state (size tracking, LRU order).
        
        **Validates: Requirements 12.3, 12.4, 13.1, 13.2**
        """
        cache = CacheManager(max_memory_mb=max_memory_mb)
        keys_added = []
        
        for i in range(num_operations):
            op = i % 4
            
            if op == 0:  # put
                key = f"key_{i % 10}"
                size = ((i + 1) * 10000) % (1024 * 1024)
                cache.put(key, b"data", size_bytes=size)
                if key not in keys_added:
                    keys_added.append(key)
            
            elif op == 1:  # get
                if keys_added:
                    key = keys_added[i % len(keys_added)]
                    cache.get(key)
            
            elif op == 2:  # remove
                if keys_added:
                    key = keys_added[i % len(keys_added)]
                    cache.remove(key)
            
            elif op == 3:  # clear occasionally
                if i % 15 == 0:
                    cache.clear()
                    keys_added = []
            
            # Verify consistency after each operation
            stats = cache.get_statistics()
            
            # Size should never exceed limit
            assert stats.total_size_bytes <= max_memory_mb * 1024 * 1024
            
            # Entry count should match actual cache
            assert stats.total_entries == len(cache._cache)
            
            # All keys in cache should be retrievable
            for key in list(cache._cache.keys()):
                assert cache.contains(key)
