import { SourceFileRetrievalService } from './source-file-retrieval';
import { FileCache } from './file-cache';
import { GitHubConfig } from '../config';

// Mock dependencies
jest.mock('@octokit/rest');
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock('../utils/stack-trace-parser');

const { Octokit } = require('@octokit/rest');
const { StackTraceParser } = require('../utils/stack-trace-parser');

describe('SourceFileRetrievalService', () => {
  let service: SourceFileRetrievalService;
  let mockOctokit: jest.Mocked<any>;
  let fileCache: FileCache;
  let config: GitHubConfig;

  beforeEach(() => {
    config = {
      token: 'fake-token',
      owner: 'test-owner',
      repo: 'test-repo',
      defaultBranch: 'main',
      enablePullRequests: true,
    };

    fileCache = new FileCache({
      maxSizeBytes: 1000,
      maxEntries: 10,
      ttlMs: 30000,
    });

    mockOctokit = {
      repos: {
        getContent: jest.fn(),
        getCommit: jest.fn(),
      },
    };

    Octokit.mockImplementation(() => mockOctokit);
    service = new SourceFileRetrievalService(config, fileCache);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchFileAtCommit', () => {
    it('should fetch file content from GitHub', async () => {
      const fileContent = 'console.log("Hello World");';
      const base64Content = Buffer.from(fileContent).toString('base64');

      mockOctokit.repos.getContent.mockResolvedValue({
        data: {
          type: 'file',
          content: base64Content,
        },
      });

      const result = await service.fetchFileAtCommit('src/app.js', 'abc123');

      expect(result).toBe(fileContent);
      expect(mockOctokit.repos.getContent).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        path: 'src/app.js',
        ref: 'abc123',
      });
    });

    it('should return cached content if available', async () => {
      const fileContent = 'cached content';
      fileCache.set('test-owner/test-repo', 'src/app.js', 'abc123', fileContent);

      const result = await service.fetchFileAtCommit('src/app.js', 'abc123');

      expect(result).toBe(fileContent);
      expect(mockOctokit.repos.getContent).not.toHaveBeenCalled();
    });

    it('should return null for 404 errors', async () => {
      mockOctokit.repos.getContent.mockRejectedValue({ status: 404 });

      const result = await service.fetchFileAtCommit('nonexistent.js', 'abc123');

      expect(result).toBeNull();
    });

    it('should throw for other errors', async () => {
      mockOctokit.repos.getContent.mockRejectedValue(new Error('API Error'));

      await expect(
        service.fetchFileAtCommit('src/app.js', 'abc123')
      ).rejects.toThrow('API Error');
    });

    it('should return null for non-file content', async () => {
      mockOctokit.repos.getContent.mockResolvedValue({
        data: {
          type: 'dir',
        },
      });

      const result = await service.fetchFileAtCommit('src', 'abc123');

      expect(result).toBeNull();
    });
  });

  describe('fetchMultipleFiles', () => {
    it('should fetch multiple files successfully', async () => {
      const files = {
        'src/app.js': 'app content',
        'src/utils.js': 'utils content',
        'src/config.js': 'config content',
      };

      mockOctokit.repos.getContent.mockImplementation(({ path }: { path: string }) => {
        const content = files[path as keyof typeof files];
        if (!content) return Promise.reject({ status: 404 });
        return Promise.resolve({
          data: {
            type: 'file',
            content: Buffer.from(content).toString('base64'),
          },
        });
      });

      const result = await service.fetchMultipleFiles(
        ['src/app.js', 'src/utils.js', 'src/config.js'],
        'abc123'
      );

      expect(result.size).toBe(3);
      expect(result.get('src/app.js')).toBe('app content');
      expect(result.get('src/utils.js')).toBe('utils content');
      expect(result.get('src/config.js')).toBe('config content');
    });

    it('should handle partial failures gracefully', async () => {
      mockOctokit.repos.getContent.mockImplementation(({ path }: { path: string }) => {
        if (path === 'src/app.js') {
          return Promise.resolve({
            data: {
              type: 'file',
              content: Buffer.from('app content').toString('base64'),
            },
          });
        }
        return Promise.reject({ status: 404 });
      });

      const result = await service.fetchMultipleFiles(
        ['src/app.js', 'src/missing.js'],
        'abc123'
      );

      expect(result.size).toBe(1);
      expect(result.get('src/app.js')).toBe('app content');
      expect(result.has('src/missing.js')).toBe(false);
    });
  });

  describe('getLatestCommitSha', () => {
    it('should fetch latest commit SHA', async () => {
      mockOctokit.repos.getCommit.mockResolvedValue({
        data: { sha: 'latest-sha-123' },
      });

      const result = await service.getLatestCommitSha();

      expect(result).toBe('latest-sha-123');
      expect(mockOctokit.repos.getCommit).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        ref: 'main',
      });
    });

    it('should use custom branch if provided', async () => {
      mockOctokit.repos.getCommit.mockResolvedValue({
        data: { sha: 'develop-sha-456' },
      });

      const result = await service.getLatestCommitSha('develop');

      expect(result).toBe('develop-sha-456');
      expect(mockOctokit.repos.getCommit).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        ref: 'develop',
      });
    });
  });

  describe('getCommitShaFromEvent', () => {
    it('should extract commit SHA from Sentry tags', async () => {
      const sentryEvent = {
        tags: [
          { key: 'commit', value: 'abc123def456' },
          { key: 'environment', value: 'production' },
        ],
      };

      const result = await service.getCommitShaFromEvent(sentryEvent);

      expect(result).toBe('abc123def456');
    });

    it('should extract commit SHA from Sentry release', async () => {
      const sentryEvent = {
        release: 'def456abc789',
        tags: [{ key: 'environment', value: 'production' }],
      };

      const result = await service.getCommitShaFromEvent(sentryEvent);

      expect(result).toBe('def456abc789');
    });

    it('should fall back to latest commit SHA', async () => {
      mockOctokit.repos.getCommit.mockResolvedValue({
        data: { sha: 'latest-fallback-sha' },
      });

      const sentryEvent = {
        tags: [{ key: 'environment', value: 'production' }],
      };

      const result = await service.getCommitShaFromEvent(sentryEvent);

      expect(result).toBe('latest-fallback-sha');
    });

    it('should validate commit SHA format', async () => {
      mockOctokit.repos.getCommit.mockResolvedValue({
        data: { sha: 'latest-fallback-sha' },
      });

      const sentryEvent = {
        tags: [{ key: 'commit', value: 'invalid-sha-format' }],
      };

      const result = await service.getCommitShaFromEvent(sentryEvent);

      // Should fall back to latest since SHA format is invalid
      expect(result).toBe('latest-fallback-sha');
    });
  });

  describe('extractFilePathsFromStackTrace', () => {
    it('should extract file paths from parsed stack trace', () => {
      const stackTrace = {
        frames: [],
        repositoryPaths: ['src/app.js', 'src/utils.js', 'src/config.js'],
        errorLocation: null,
      };

      const result = service.extractFilePathsFromStackTrace(stackTrace);

      expect(result).toEqual(['src/app.js', 'src/utils.js', 'src/config.js']);
    });

    it('should limit to first 10 files', () => {
      const repositoryPaths = Array.from({ length: 15 }, (_, i) => `src/file${i}.js`);
      const stackTrace = {
        frames: [],
        repositoryPaths,
        errorLocation: null,
      };

      const result = service.extractFilePathsFromStackTrace(stackTrace);

      expect(result).toHaveLength(10);
      expect(result[0]).toBe('src/file0.js');
      expect(result[9]).toBe('src/file9.js');
    });
  });

  describe('createSourceContext', () => {
    it('should create source context with error location', async () => {
      const content = 'line1\nline2\nline3\nERROR LINE\nline5\nline6';
      const errorLocation = { line: 4, column: 5, function: 'testFunction' };

      const result = await service.createSourceContext(
        'src/app.js',
        content,
        errorLocation,
        'abc123'
      );

      expect(result.filePath).toBe('src/app.js');
      expect(result.content).toBe(content);
      expect(result.errorLocation).toEqual(errorLocation);
      expect(result.fileInfo.commitSha).toBe('abc123');
      expect(result.fileInfo.language).toBe('javascript');
      expect(result.contextLines.lines).toHaveLength(6);
      expect(result.contextLines.lines[3].isErrorLine).toBe(true);
      expect(result.contextLines.lines[3].content).toBe('ERROR LINE');
    });

    it('should handle files without error location', async () => {
      const content = 'line1\nline2\nline3';

      const result = await service.createSourceContext(
        'src/helper.ts',
        content,
        null,
        'def456'
      );

      expect(result.errorLocation).toBeNull();
      expect(result.fileInfo.language).toBe('typescript');
      expect(result.contextLines.lines[0].isErrorLine).toBe(false);
    });
  });

  describe('detectLanguageFromPath', () => {
    const testCases = [
      { path: 'app.js', expected: 'javascript' },
      { path: 'component.jsx', expected: 'javascript' },
      { path: 'types.ts', expected: 'typescript' },
      { path: 'component.tsx', expected: 'typescript' },
      { path: 'script.py', expected: 'python' },
      { path: 'Main.java', expected: 'java' },
      { path: 'server.go', expected: 'go' },
      { path: 'model.rb', expected: 'ruby' },
      { path: 'api.php', expected: 'php' },
      { path: 'Program.cs', expected: 'csharp' },
      { path: 'main.cpp', expected: 'cpp' },
      { path: 'header.h', expected: 'c' },
      { path: 'unknown.xyz', expected: 'xyz' },
      { path: 'noextension', expected: null },
    ];

    testCases.forEach(({ path, expected }) => {
      it(`should detect ${expected || 'null'} for ${path}`, () => {
        const result = (service as any).detectLanguageFromPath(path);
        expect(result).toBe(expected);
      });
    });
  });

  describe('createAnalysisContext', () => {
    beforeEach(() => {
      StackTraceParser.parseFromSentryEvent.mockReturnValue({
        frames: [],
        repositoryPaths: ['src/app.js', 'src/utils.js'],
        errorLocation: {
          filename: 'src/app.js',
          lineno: 42,
          colno: 10,
          function: 'processData',
        },
      });

      mockOctokit.repos.getCommit.mockResolvedValue({
        data: { sha: 'commit-sha-123' },
      });

      mockOctokit.repos.getContent.mockImplementation(({ path }: { path: string }) => {
        const files: Record<string, string> = {
          'src/app.js': 'app content with error',
          'src/utils.js': 'utility functions',
        };
        const content = files[path as string];
        if (!content) return Promise.reject({ status: 404 });
        return Promise.resolve({
          data: {
            type: 'file',
            content: Buffer.from(content).toString('base64'),
          },
        });
      });
    });

    it('should create complete analysis context', async () => {
      const sentryEvent = {
        id: 'event-123',
        tags: [{ key: 'environment', value: 'production' }],
      };

      const result = await service.createAnalysisContext(sentryEvent);

      expect(result).not.toBeNull();
      expect(result!.primaryFile.filePath).toBe('src/app.js');
      expect(result!.primaryFile.content).toBe('app content with error');
      expect(result!.relatedFiles).toHaveLength(1);
      expect(result!.relatedFiles[0].filePath).toBe('src/utils.js');
      expect(result!.repositoryInfo.owner).toBe('test-owner');
      expect(result!.repositoryInfo.repo).toBe('test-repo');
    });

    it('should return null if no stack trace', async () => {
      StackTraceParser.parseFromSentryEvent.mockReturnValue(null);

      const sentryEvent = { id: 'event-123' };
      const result = await service.createAnalysisContext(sentryEvent);

      expect(result).toBeNull();
    });

    it('should return null if no error location', async () => {
      StackTraceParser.parseFromSentryEvent.mockReturnValue({
        frames: [],
        repositoryPaths: ['src/app.js'],
        errorLocation: null,
      });

      // Override getContent for this test to make src/app.js fail to fetch
      const originalGetContent = mockOctokit.repos.getContent;
      mockOctokit.repos.getContent.mockImplementation(async ({ path }: { path: string }) => {
        if (path === 'src/app.js') {
          return Promise.reject({ status: 404 }); // Make the only repositoryPath file fail
        }
        // For any other unexpected path, let it behave as per outer scope or throw
        return originalGetContent({ path }); 
      });

      const sentryEvent = { id: 'event-no-error-loc' };
      const result = await service.createAnalysisContext(sentryEvent);

      expect(result).toBeNull();
      mockOctokit.repos.getContent = originalGetContent; // Restore mock
    });

    it('should return null if no application files found', async () => {
      StackTraceParser.parseFromSentryEvent.mockReturnValue({
        frames: [],
        repositoryPaths: [],
        errorLocation: {
          filename: 'src/app.js',
          lineno: 42,
          colno: 10,
          function: 'processData',
        },
      });

      const sentryEvent = { id: 'event-123' };
      const result = await service.createAnalysisContext(sentryEvent);

      expect(result).toBeNull();
    });

    it('should return null if primary file cannot be fetched', async () => {
      // The beforeEach for this describe block sets up StackTraceParser to return:
      // repositoryPaths: ['src/app.js', 'src/utils.js'],
      // errorLocation.filename: 'src/app.js'

      // Override getContent for THIS TEST to make ALL repositoryPaths files fail to fetch
      const originalGetContent = mockOctokit.repos.getContent;
      mockOctokit.repos.getContent.mockImplementation(async ({ path }: { path: string }) => {
        if (path === 'src/app.js' || path === 'src/utils.js') {
          return Promise.reject({ status: 404 }); // Make all expected files fail
        }
        // For any other unexpected path, let it behave as per outer scope or throw
        return originalGetContent({ path }); 
      });

      const sentryEvent = { id: 'event-primary-fetch-fail' };
      const result = await service.createAnalysisContext(sentryEvent);

      expect(result).toBeNull();
      mockOctokit.repos.getContent = originalGetContent; // Restore mock
    });
  });

  describe('cache integration', () => {
    it('should get cache stats', () => {
      const stats = service.getCacheStats();
      expect(stats).toHaveProperty('totalEntries');
      expect(stats).toHaveProperty('totalSizeBytes');
      expect(stats).toHaveProperty('hitRate');
    });

    it('should clear cache', () => {
      service.clearCache();
      const stats = service.getCacheStats();
      expect(stats.totalEntries).toBe(0);
    });
  });

  describe('isValidCommitSha', () => {
    const testCases = [
      { sha: 'abc123', expected: true },
      { sha: 'abcdef1234567890', expected: true },
      { sha: 'abcdef1234567890abcdef1234567890abcdef12', expected: true }, // 40 chars
      { sha: 'ABCDEF123456', expected: true }, // uppercase should work with case insensitive flag
      { sha: 'invalid-sha', expected: false },
      { sha: '123xyz', expected: false },
      { sha: 'abcde', expected: false }, // too short (less than 6)
      { sha: '', expected: false },
    ];

    testCases.forEach(({ sha, expected }) => {
      it(`should return ${expected} for "${sha}"`, () => {
        const result = (service as any).isValidCommitSha(sha);
        expect(result).toBe(expected);
      });
    });
  });
}); 