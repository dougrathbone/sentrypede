import { FileCache } from './file-cache';

// Mock logger
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('FileCache', () => {
  let cache: FileCache;

  beforeEach(() => {
    cache = new FileCache({
      maxSizeBytes: 1000,
      maxEntries: 5,
      ttlMs: 1000, // 1 second for testing
    });
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const defaultCache = new FileCache();
      const stats = defaultCache.getStats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.totalSizeBytes).toBe(0);
    });

    it('should initialize with custom values', () => {
      const customCache = new FileCache({
        maxSizeBytes: 2000,
        maxEntries: 10,
        ttlMs: 5000,
      });
      
      const stats = customCache.getStats();
      expect(stats.totalEntries).toBe(0);
    });
  });

  describe('get and set', () => {
    it('should store and retrieve files', () => {
      const content = 'console.log("Hello World");';
      cache.set('owner/repo', 'src/app.js', 'abc123', content);
      
      const retrieved = cache.get('owner/repo', 'src/app.js', 'abc123');
      expect(retrieved).toBe(content);
    });

    it('should return null for non-existent files', () => {
      const result = cache.get('owner/repo', 'nonexistent.js', 'abc123');
      expect(result).toBeNull();
    });

    it('should track cache hits and misses', () => {
      const content = 'test content';
      cache.set('owner/repo', 'file.js', 'sha1', content);
      
      // Hit
      cache.get('owner/repo', 'file.js', 'sha1');
      
      // Miss
      cache.get('owner/repo', 'missing.js', 'sha2');
      
      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
      expect(stats.missRate).toBe(0.5);
    });

    it('should not cache files that are too large', () => {
      // Create content larger than 10% of max cache size (100 bytes)
      const largeContent = 'x'.repeat(150);
      
      cache.set('owner/repo', 'large.js', 'abc123', largeContent);
      
      const retrieved = cache.get('owner/repo', 'large.js', 'abc123');
      expect(retrieved).toBeNull();
      
      const stats = cache.getStats();
      expect(stats.totalEntries).toBe(0);
    });
  });

  describe('expiration', () => {
    it('should expire entries after TTL', async () => {
      const content = 'test content';
      cache.set('owner/repo', 'file.js', 'abc123', content);
      
      // Should be available immediately
      expect(cache.get('owner/repo', 'file.js', 'abc123')).toBe(content);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Should be expired now
      expect(cache.get('owner/repo', 'file.js', 'abc123')).toBeNull();
    });

    it('should clear expired entries manually', async () => {
      cache.set('owner/repo', 'file1.js', 'abc123', 'content1');
      cache.set('owner/repo', 'file2.js', 'def456', 'content2');
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Add fresh entry
      cache.set('owner/repo', 'file3.js', 'ghi789', 'content3');
      
      expect(cache.getStats().totalEntries).toBe(3);
      
      cache.clearExpired();
      
      expect(cache.getStats().totalEntries).toBe(1);
      expect(cache.get('owner/repo', 'file3.js', 'ghi789')).toBe('content3');
    });
  });

  describe('eviction', () => {
    it('should evict oldest entries when max entries exceeded', () => {
      // Fill cache to capacity
      for (let i = 0; i < 5; i++) {
        cache.set('owner/repo', `file${i}.js`, `sha${i}`, `content${i}`);
      }
      
      expect(cache.getStats().totalEntries).toBe(5);
      
      // Add one more to trigger eviction
      cache.set('owner/repo', 'file5.js', 'sha5', 'content5');
      
      expect(cache.getStats().totalEntries).toBe(5);
      
      // First entry should be evicted
      expect(cache.get('owner/repo', 'file0.js', 'sha0')).toBeNull();
      expect(cache.get('owner/repo', 'file5.js', 'sha5')).toBe('content5');
    });

    it('should evict entries when size limit exceeded', () => {
      // Add entries that will exceed size limit
      cache.set('owner/repo', 'file1.js', 'sha1', 'x'.repeat(300)); // 300 bytes
      cache.set('owner/repo', 'file2.js', 'sha2', 'x'.repeat(300)); // 300 bytes
      cache.set('owner/repo', 'file3.js', 'sha3', 'x'.repeat(300)); // 300 bytes
      
      const stats = cache.getStats();
      expect(stats.totalSizeBytes).toBeLessThanOrEqual(1000);
      expect(stats.totalEntries).toBeLessThan(3);
    });
  });

  describe('has method', () => {
    it('should return true for existing non-expired entries', () => {
      cache.set('owner/repo', 'file.js', 'abc123', 'content');
      expect(cache.has('owner/repo', 'file.js', 'abc123')).toBe(true);
    });

    it('should return false for non-existent entries', () => {
      expect(cache.has('owner/repo', 'missing.js', 'abc123')).toBe(false);
    });

    it('should return false for expired entries', async () => {
      cache.set('owner/repo', 'file.js', 'abc123', 'content');
      expect(cache.has('owner/repo', 'file.js', 'abc123')).toBe(true);
      
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(cache.has('owner/repo', 'file.js', 'abc123')).toBe(false);
    });
  });

  describe('remove method', () => {
    it('should remove specific entries', () => {
      cache.set('owner/repo', 'file1.js', 'abc123', 'content1');
      cache.set('owner/repo', 'file2.js', 'def456', 'content2');
      
      expect(cache.getStats().totalEntries).toBe(2);
      
      const removed = cache.remove('owner/repo', 'file1.js', 'abc123');
      expect(removed).toBe(true);
      expect(cache.getStats().totalEntries).toBe(1);
      
      expect(cache.get('owner/repo', 'file1.js', 'abc123')).toBeNull();
      expect(cache.get('owner/repo', 'file2.js', 'def456')).toBe('content2');
    });

    it('should return false when removing non-existent entries', () => {
      const removed = cache.remove('owner/repo', 'missing.js', 'abc123');
      expect(removed).toBe(false);
    });
  });

  describe('clear method', () => {
    it('should clear all entries', () => {
      cache.set('owner/repo', 'file1.js', 'abc123', 'content1');
      cache.set('owner/repo', 'file2.js', 'def456', 'content2');
      
      expect(cache.getStats().totalEntries).toBe(2);
      
      cache.clear();
      
      expect(cache.getStats().totalEntries).toBe(0);
      expect(cache.getStats().totalSizeBytes).toBe(0);
    });
  });

  describe('getStats method', () => {
    it('should return accurate statistics', () => {
      cache.set('owner/repo', 'file1.js', 'abc123', 'content1');
      cache.set('owner/repo', 'file2.js', 'def456', 'content2');
      
      // Generate some hits and misses
      cache.get('owner/repo', 'file1.js', 'abc123'); // hit
      cache.get('owner/repo', 'missing.js', 'xyz789'); // miss
      
      const stats = cache.getStats();
      expect(stats.totalEntries).toBe(2);
      expect(stats.totalSizeBytes).toBeGreaterThan(0);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
      expect(stats.missRate).toBe(0.5);
    });

    it('should handle zero requests correctly', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
      expect(stats.missRate).toBe(0);
    });
  });

  describe('getKeys method', () => {
    it('should return all cache keys', () => {
      cache.set('owner/repo', 'file1.js', 'abc123', 'content1');
      cache.set('owner/repo', 'file2.js', 'def456', 'content2');
      
      const keys = cache.getKeys();
      expect(keys).toHaveLength(2);
      expect(keys).toContain('owner/repo:file1.js:abc123');
      expect(keys).toContain('owner/repo:file2.js:def456');
    });

    it('should return empty array for empty cache', () => {
      const keys = cache.getKeys();
      expect(keys).toEqual([]);
    });
  });

  describe('cache key generation', () => {
    it('should generate unique keys for different repos', () => {
      cache.set('owner1/repo1', 'file.js', 'abc123', 'content1');
      cache.set('owner2/repo2', 'file.js', 'abc123', 'content2');
      
      expect(cache.get('owner1/repo1', 'file.js', 'abc123')).toBe('content1');
      expect(cache.get('owner2/repo2', 'file.js', 'abc123')).toBe('content2');
      expect(cache.getStats().totalEntries).toBe(2);
    });

    it('should generate unique keys for different commits', () => {
      cache.set('owner/repo', 'file.js', 'abc123', 'old content');
      cache.set('owner/repo', 'file.js', 'def456', 'new content');
      
      expect(cache.get('owner/repo', 'file.js', 'abc123')).toBe('old content');
      expect(cache.get('owner/repo', 'file.js', 'def456')).toBe('new content');
      expect(cache.getStats().totalEntries).toBe(2);
    });
  });
}); 