import { logger } from '../utils/logger';

export interface CachedFile {
  content: string;
  timestamp: number;
  commitSha: string;
  fileSize: number;
}

export interface CacheStats {
  totalEntries: number;
  totalSizeBytes: number;
  hitRate: number;
  missRate: number;
  hits: number;
  misses: number;
}

export class FileCache {
  private cache: Map<string, CachedFile> = new Map();
  private maxSizeBytes: number;
  private maxEntries: number;
  private ttlMs: number;
  private stats = {
    hits: 0,
    misses: 0,
  };

  constructor(options: {
    maxSizeBytes?: number;
    maxEntries?: number;
    ttlMs?: number;
  } = {}) {
    this.maxSizeBytes = options.maxSizeBytes || 50 * 1024 * 1024; // 50MB default
    this.maxEntries = options.maxEntries || 1000; // 1000 files default
    this.ttlMs = options.ttlMs || 30 * 60 * 1000; // 30 minutes default

    logger.info('FileCache initialized', {
      maxSizeBytes: this.maxSizeBytes,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
    });
  }

  /**
   * Generate cache key for a file
   */
  private getCacheKey(repo: string, filePath: string, commitSha: string): string {
    return `${repo}:${filePath}:${commitSha}`;
  }

  /**
   * Get file from cache
   */
  get(repo: string, filePath: string, commitSha: string): string | null {
    const key = this.getCacheKey(repo, filePath, commitSha);
    const cached = this.cache.get(key);

    if (!cached) {
      this.stats.misses++;
      return null;
    }

    // Check if cache entry has expired
    if (Date.now() - cached.timestamp > this.ttlMs) {
      this.cache.delete(key);
      this.stats.misses++;
      logger.debug('Cache entry expired', { key });
      return null;
    }

    this.stats.hits++;
    logger.debug('Cache hit', { key, fileSize: cached.fileSize });
    return cached.content;
  }

  /**
   * Set file in cache
   */
  set(repo: string, filePath: string, commitSha: string, content: string): void {
    const key = this.getCacheKey(repo, filePath, commitSha);
    const fileSize = Buffer.byteLength(content, 'utf8');

    // Check if file is too large to cache
    if (fileSize > this.maxSizeBytes / 10) { // Don't cache files larger than 10% of max cache size
      logger.debug('File too large to cache', { key, fileSize });
      return;
    }

    // Make room in cache if needed
    this.evictIfNeeded(fileSize);

    const cachedFile: CachedFile = {
      content,
      timestamp: Date.now(),
      commitSha,
      fileSize,
    };

    this.cache.set(key, cachedFile);
    logger.debug('Cached file', { key, fileSize });
  }

  /**
   * Evict entries if cache is full
   */
  private evictIfNeeded(newFileSize: number): void {
    // Check entry count limit - evict if adding this entry would exceed max
    while (this.cache.size >= this.maxEntries) {
      this.evictOldest();
    }

    // Check size limit
    const currentSize = this.getCurrentSizeBytes();
    if (currentSize + newFileSize > this.maxSizeBytes) {
      const targetSize = this.maxSizeBytes * 0.8; // Evict to 80% capacity
      this.evictToSize(targetSize);
    }
  }

  /**
   * Evict oldest entry
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Date.now();

    for (const [key, cached] of this.cache.entries()) {
      if (cached.timestamp < oldestTimestamp) {
        oldestTimestamp = cached.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      logger.debug('Evicted oldest entry', { key: oldestKey });
    }
  }

  /**
   * Evict entries until cache size is under target
   */
  private evictToSize(targetSize: number): void {
    // Sort entries by timestamp (oldest first)
    const entries = Array.from(this.cache.entries()).sort(
      ([, a], [, b]) => a.timestamp - b.timestamp
    );

    let currentSize = this.getCurrentSizeBytes();
    let evictedCount = 0;

    for (const [key, cached] of entries) {
      if (currentSize <= targetSize) {
        break;
      }

      this.cache.delete(key);
      currentSize -= cached.fileSize;
      evictedCount++;
    }

    if (evictedCount > 0) {
      logger.debug('Evicted entries to meet size limit', {
        evictedCount,
        targetSize,
        currentSize,
      });
    }
  }

  /**
   * Get current cache size in bytes
   */
  private getCurrentSizeBytes(): number {
    let totalSize = 0;
    for (const cached of this.cache.values()) {
      totalSize += cached.fileSize;
    }
    return totalSize;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const entriesCount = this.cache.size;
    this.cache.clear();
    logger.info('Cache cleared', { entriesCount });
  }

  /**
   * Clear expired entries
   */
  clearExpired(): void {
    const now = Date.now();
    let clearedCount = 0;

    for (const [key, cached] of this.cache.entries()) {
      if (now - cached.timestamp > this.ttlMs) {
        this.cache.delete(key);
        clearedCount++;
      }
    }

    if (clearedCount > 0) {
      logger.debug('Cleared expired entries', { clearedCount });
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.stats.hits + this.stats.misses;
    return {
      totalEntries: this.cache.size,
      totalSizeBytes: this.getCurrentSizeBytes(),
      hitRate: totalRequests > 0 ? this.stats.hits / totalRequests : 0,
      missRate: totalRequests > 0 ? this.stats.misses / totalRequests : 0,
      hits: this.stats.hits,
      misses: this.stats.misses,
    };
  }

  /**
   * Check if file exists in cache
   */
  has(repo: string, filePath: string, commitSha: string): boolean {
    const key = this.getCacheKey(repo, filePath, commitSha);
    const cached = this.cache.get(key);
    
    if (!cached) {
      return false;
    }

    // Check if expired
    if (Date.now() - cached.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Remove specific file from cache
   */
  remove(repo: string, filePath: string, commitSha: string): boolean {
    const key = this.getCacheKey(repo, filePath, commitSha);
    return this.cache.delete(key);
  }

  /**
   * Get cache keys for debugging
   */
  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }
} 