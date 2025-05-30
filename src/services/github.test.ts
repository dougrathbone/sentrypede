import { GitHubService, GitHubFile, PullRequestData } from './github';
import { GitHubConfig } from '../config';
import { Octokit } from '@octokit/rest';

// Mock Octokit
jest.mock('@octokit/rest');

// Mock logger
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('GitHubService', () => {
  let service: GitHubService;
  let mockConfig: GitHubConfig;
  let mockOctokit: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfig = {
      token: 'ghp_test-token',
      owner: 'test-owner',
      repo: 'test-repo',
      defaultBranch: 'main',
    };

    // Create mock Octokit instance
    mockOctokit = {
      git: {
        getRef: jest.fn(),
        createRef: jest.fn(),
        updateRef: jest.fn(),
        deleteRef: jest.fn(),
        getCommit: jest.fn(),
        createBlob: jest.fn(),
        createTree: jest.fn(),
        createCommit: jest.fn(),
      },
      repos: {
        getContent: jest.fn(),
        get: jest.fn(),
      },
      pulls: {
        create: jest.fn(),
        get: jest.fn(),
      },
      issues: {
        createComment: jest.fn(),
      },
      search: {
        code: jest.fn(),
      },
    };

    (Octokit as jest.MockedClass<typeof Octokit>).mockImplementation(() => mockOctokit);

    service = new GitHubService(mockConfig);
  });

  describe('createBranch', () => {
    it('should create a new branch successfully', async () => {
      mockOctokit.git.getRef.mockResolvedValue({
        data: { object: { sha: 'abc123' } },
      });
      mockOctokit.git.createRef.mockResolvedValue({});

      await service.createBranch('feature/test');

      expect(mockOctokit.git.getRef).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        ref: 'heads/main',
      });

      expect(mockOctokit.git.createRef).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        ref: 'refs/heads/feature/test',
        sha: 'abc123',
      });
    });

    it('should handle branch already exists error', async () => {
      mockOctokit.git.getRef.mockResolvedValue({
        data: { object: { sha: 'abc123' } },
      });
      mockOctokit.git.createRef.mockRejectedValue({ status: 422 });

      await expect(service.createBranch('existing-branch')).resolves.not.toThrow();
    });

    it('should throw on other errors', async () => {
      mockOctokit.git.getRef.mockRejectedValue(new Error('API error'));

      await expect(service.createBranch('feature/test')).rejects.toThrow('API error');
    });
  });

  describe('createOrUpdateFiles', () => {
    it('should create files and commit successfully', async () => {
      const files: GitHubFile[] = [
        { path: 'src/test.js', content: 'console.log("test");' },
        { path: 'src/test2.js', content: 'console.log("test2");' },
      ];

      mockOctokit.git.getRef.mockResolvedValue({
        data: { object: { sha: 'branch-sha' } },
      });
      mockOctokit.git.getCommit.mockResolvedValue({
        data: { tree: { sha: 'tree-sha' } },
      });
      mockOctokit.git.createBlob.mockResolvedValue({
        data: { sha: 'blob-sha' },
      });
      mockOctokit.git.createTree.mockResolvedValue({
        data: { sha: 'new-tree-sha' },
      });
      mockOctokit.git.createCommit.mockResolvedValue({
        data: { sha: 'new-commit-sha' },
      });
      mockOctokit.git.updateRef.mockResolvedValue({});

      const commitSha = await service.createOrUpdateFiles(
        'feature/test',
        files,
        'Test commit'
      );

      expect(commitSha).toBe('new-commit-sha');
      expect(mockOctokit.git.createBlob).toHaveBeenCalledTimes(2);
      expect(mockOctokit.git.createCommit).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        message: 'Test commit',
        tree: 'new-tree-sha',
        parents: ['branch-sha'],
      });
    });
  });

  describe('createPullRequest', () => {
    it('should create a pull request successfully', async () => {
      const prData: PullRequestData = {
        title: 'Test PR',
        body: 'Test description',
        branch: 'feature/test',
        files: [],
      };

      mockOctokit.pulls.create.mockResolvedValue({
        data: {
          number: 123,
          html_url: 'https://github.com/test-owner/test-repo/pull/123',
          state: 'open',
          merged: false,
          title: 'Test PR',
        },
      });

      const pr = await service.createPullRequest(prData);

      expect(pr).toEqual({
        number: 123,
        html_url: 'https://github.com/test-owner/test-repo/pull/123',
        state: 'open',
        merged: false,
      });

      expect(mockOctokit.pulls.create).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        title: 'Test PR',
        body: 'Test description',
        head: 'feature/test',
        base: 'main',
      });
    });
  });

  describe('getFileContent', () => {
    it('should get file content successfully', async () => {
      mockOctokit.repos.getContent.mockResolvedValue({
        data: {
          type: 'file',
          content: Buffer.from('console.log("test");').toString('base64'),
        },
      });

      const content = await service.getFileContent('src/test.js');

      expect(content).toBe('console.log("test");');
      expect(mockOctokit.repos.getContent).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        path: 'src/test.js',
        ref: 'main',
      });
    });

    it('should return null for non-existent file', async () => {
      mockOctokit.repos.getContent.mockRejectedValue({ status: 404 });

      const content = await service.getFileContent('non-existent.js');

      expect(content).toBeNull();
    });

    it('should return null for directories', async () => {
      mockOctokit.repos.getContent.mockResolvedValue({
        data: { type: 'dir' },
      });

      const content = await service.getFileContent('src');

      expect(content).toBeNull();
    });
  });

  describe('branchExists', () => {
    it('should return true if branch exists', async () => {
      mockOctokit.git.getRef.mockResolvedValue({});

      const exists = await service.branchExists('feature/test');

      expect(exists).toBe(true);
    });

    it('should return false if branch does not exist', async () => {
      mockOctokit.git.getRef.mockRejectedValue({ status: 404 });

      const exists = await service.branchExists('non-existent');

      expect(exists).toBe(false);
    });
  });

  describe('deleteBranch', () => {
    it('should delete branch successfully', async () => {
      mockOctokit.git.deleteRef.mockResolvedValue({});

      await service.deleteBranch('feature/test');

      expect(mockOctokit.git.deleteRef).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        ref: 'heads/feature/test',
      });
    });

    it('should handle non-existent branch gracefully', async () => {
      mockOctokit.git.deleteRef.mockRejectedValue({ status: 404 });

      await expect(service.deleteBranch('non-existent')).resolves.not.toThrow();
    });
  });

  describe('getPullRequest', () => {
    it('should get pull request successfully', async () => {
      mockOctokit.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          html_url: 'https://github.com/test-owner/test-repo/pull/123',
          state: 'open',
          merged: false,
        },
      });

      const pr = await service.getPullRequest(123);

      expect(pr).toEqual({
        number: 123,
        html_url: 'https://github.com/test-owner/test-repo/pull/123',
        state: 'open',
        merged: false,
      });
    });

    it('should return null for non-existent PR', async () => {
      mockOctokit.pulls.get.mockRejectedValue({ status: 404 });

      const pr = await service.getPullRequest(999);

      expect(pr).toBeNull();
    });
  });

  describe('listFiles', () => {
    it('should list files in directory', async () => {
      mockOctokit.repos.getContent.mockResolvedValue({
        data: [
          { type: 'file', path: 'src/file1.js' },
          { type: 'file', path: 'src/file2.js' },
          { type: 'dir', path: 'src/subdir' },
        ],
      });

      const files = await service.listFiles('src');

      expect(files).toEqual(['src/file1.js', 'src/file2.js']);
    });

    it('should return empty array for non-existent directory', async () => {
      mockOctokit.repos.getContent.mockRejectedValue({ status: 404 });

      const files = await service.listFiles('non-existent');

      expect(files).toEqual([]);
    });
  });

  describe('createPullRequestComment', () => {
    it('should create comment successfully', async () => {
      mockOctokit.issues.createComment.mockResolvedValue({});

      await service.createPullRequestComment(123, 'Test comment');

      expect(mockOctokit.issues.createComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 123,
        body: 'Test comment',
      });
    });
  });

  describe('getRepository', () => {
    it('should get repository info successfully', async () => {
      mockOctokit.repos.get.mockResolvedValue({
        data: {
          name: 'test-repo',
          full_name: 'test-owner/test-repo',
          default_branch: 'main',
          language: 'JavaScript',
          size: 1234,
        },
      });

      const repo = await service.getRepository();

      expect(repo).toEqual({
        name: 'test-repo',
        full_name: 'test-owner/test-repo',
        default_branch: 'main',
        language: 'JavaScript',
        size: 1234,
      });
    });
  });

  describe('searchCode', () => {
    it('should search code successfully', async () => {
      mockOctokit.search.code.mockResolvedValue({
        data: {
          items: [
            { path: 'src/file1.js', repository: { full_name: 'test-owner/test-repo' } },
            { path: 'src/file2.js', repository: { full_name: 'test-owner/test-repo' } },
          ],
        },
      });

      const results = await service.searchCode('console.log');

      expect(results).toEqual([
        { path: 'src/file1.js', repository: 'test-owner/test-repo' },
        { path: 'src/file2.js', repository: 'test-owner/test-repo' },
      ]);
    });
  });

  describe('createFixForIssue', () => {
    it('should create a complete fix workflow', async () => {
      const issueId = 'ISSUE-123';
      const issueTitle = 'Test error';
      const files = [
        { path: 'src/test.js', content: 'fixed content' },
      ];

      // Mock branch creation
      mockOctokit.git.getRef.mockResolvedValueOnce({
        data: { object: { sha: 'main-sha' } },
      });
      mockOctokit.git.createRef.mockResolvedValue({});

      // Mock file creation
      mockOctokit.git.getRef.mockResolvedValueOnce({
        data: { object: { sha: 'branch-sha' } },
      });
      mockOctokit.git.getCommit.mockResolvedValue({
        data: { tree: { sha: 'tree-sha' } },
      });
      mockOctokit.git.createBlob.mockResolvedValue({
        data: { sha: 'blob-sha' },
      });
      mockOctokit.git.createTree.mockResolvedValue({
        data: { sha: 'new-tree-sha' },
      });
      mockOctokit.git.createCommit.mockResolvedValue({
        data: { sha: 'new-commit-sha' },
      });
      mockOctokit.git.updateRef.mockResolvedValue({});

      // Mock PR creation
      mockOctokit.pulls.create.mockResolvedValue({
        data: {
          number: 1,
          html_url: 'https://github.com/test/pr/1',
          state: 'open',
          merged: false,
        },
      });

      const result = await service.createFixForIssue(issueId, issueTitle, files);

      expect(result).toEqual({
        number: 1,
        html_url: 'https://github.com/test/pr/1',
        state: 'open',
        merged: false,
      });

      // Check branch creation - use regex to match timestamp
      expect(mockOctokit.git.createRef).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'test-owner',
          repo: 'test-repo',
          ref: expect.stringMatching(/^refs\/heads\/fix\/sentry-ISSUE-123-\d+$/),
          sha: 'main-sha',
        })
      );

      // Check file commits
      expect(mockOctokit.git.createBlob).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        content: Buffer.from('fixed content').toString('base64'),
        encoding: 'base64',
      });

      // Check PR creation
      expect(mockOctokit.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'test-owner',
          repo: 'test-repo',
          title: '🐛 Fix: Test error',
          head: expect.stringMatching(/^fix\/sentry-ISSUE-123-\d+$/),
          base: 'main',
        })
      );
    });
  });
}); 