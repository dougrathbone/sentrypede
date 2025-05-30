import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logger';
import { GitHubConfig } from '../config';

export interface GitHubFile {
  path: string;
  content: string;
}

export interface PullRequestData {
  title: string;
  body: string;
  branch: string;
  files: GitHubFile[];
}

export interface PullRequest {
  number: number;
  html_url: string;
  state: string;
  merged: boolean;
}

export class GitHubService {
  private octokit: Octokit;
  private config: GitHubConfig;

  constructor(config: GitHubConfig) {
    this.config = config;
    this.octokit = new Octokit({
      auth: config.token,
    });
  }

  /**
   * Create a new branch from the default branch
   */
  async createBranch(branchName: string): Promise<void> {
    try {
      // Get the default branch reference
      const { data: ref } = await this.octokit.git.getRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `heads/${this.config.defaultBranch}`,
      });

      // Create new branch
      await this.octokit.git.createRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `refs/heads/${branchName}`,
        sha: ref.object.sha,
      });

      logger.info('Created branch', { branchName });
    } catch (error: any) {
      if (error.status === 422) {
        logger.warn('Branch already exists', { branchName });
      } else {
        logger.error('Failed to create branch', { branchName, error });
        throw error;
      }
    }
  }

  /**
   * Create or update files in a branch
   */
  async createOrUpdateFiles(
    branchName: string,
    files: GitHubFile[],
    commitMessage: string
  ): Promise<string> {
    try {
      // Get the current commit SHA of the branch
      const { data: ref } = await this.octokit.git.getRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `heads/${branchName}`,
      });

      const currentCommitSha = ref.object.sha;

      // Get the tree of the current commit
      const { data: currentCommit } = await this.octokit.git.getCommit({
        owner: this.config.owner,
        repo: this.config.repo,
        commit_sha: currentCommitSha,
      });

      // Create blobs for each file
      const blobs = await Promise.all(
        files.map(async (file) => {
          const { data: blob } = await this.octokit.git.createBlob({
            owner: this.config.owner,
            repo: this.config.repo,
            content: Buffer.from(file.content).toString('base64'),
            encoding: 'base64',
          });
          return {
            path: file.path,
            mode: '100644' as const,
            type: 'blob' as const,
            sha: blob.sha,
          };
        })
      );

      // Create a new tree
      const { data: newTree } = await this.octokit.git.createTree({
        owner: this.config.owner,
        repo: this.config.repo,
        tree: blobs,
        base_tree: currentCommit.tree.sha,
      });

      // Create a new commit
      const { data: newCommit } = await this.octokit.git.createCommit({
        owner: this.config.owner,
        repo: this.config.repo,
        message: commitMessage,
        tree: newTree.sha,
        parents: [currentCommitSha],
      });

      // Update the branch reference
      await this.octokit.git.updateRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `heads/${branchName}`,
        sha: newCommit.sha,
      });

      logger.info('Created commit', { 
        branchName, 
        commitSha: newCommit.sha,
        filesCount: files.length 
      });

      return newCommit.sha;
    } catch (error) {
      logger.error('Failed to create or update files', { branchName, error });
      throw error;
    }
  }

  /**
   * Create a pull request
   */
  async createPullRequest(data: PullRequestData): Promise<PullRequest> {
    try {
      const { data: pr } = await this.octokit.pulls.create({
        owner: this.config.owner,
        repo: this.config.repo,
        title: data.title,
        body: data.body,
        head: data.branch,
        base: this.config.defaultBranch,
      });

      logger.info('Created pull request', {
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
      });

      return {
        number: pr.number,
        html_url: pr.html_url,
        state: pr.state,
        merged: pr.merged,
      };
    } catch (error) {
      logger.error('Failed to create pull request', { branch: data.branch, error });
      throw error;
    }
  }

  /**
   * Get a file's content from the repository
   */
  async getFileContent(path: string, branch?: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.config.owner,
        repo: this.config.repo,
        path,
        ref: branch || this.config.defaultBranch,
      });

      if ('content' in data && data.type === 'file') {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }

      return null;
    } catch (error: any) {
      if (error.status === 404) {
        return null;
      }
      logger.error('Failed to get file content', { path, error });
      throw error;
    }
  }

  /**
   * Check if a branch exists
   */
  async branchExists(branchName: string): Promise<boolean> {
    try {
      await this.octokit.git.getRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `heads/${branchName}`,
      });
      return true;
    } catch (error: any) {
      if (error.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Delete a branch
   */
  async deleteBranch(branchName: string): Promise<void> {
    try {
      await this.octokit.git.deleteRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `heads/${branchName}`,
      });
      logger.info('Deleted branch', { branchName });
    } catch (error: any) {
      if (error.status === 404) {
        logger.warn('Branch not found', { branchName });
      } else {
        logger.error('Failed to delete branch', { branchName, error });
        throw error;
      }
    }
  }

  /**
   * Get pull request by number
   */
  async getPullRequest(prNumber: number): Promise<PullRequest | null> {
    try {
      const { data: pr } = await this.octokit.pulls.get({
        owner: this.config.owner,
        repo: this.config.repo,
        pull_number: prNumber,
      });

      return {
        number: pr.number,
        html_url: pr.html_url,
        state: pr.state,
        merged: pr.merged,
      };
    } catch (error: any) {
      if (error.status === 404) {
        return null;
      }
      logger.error('Failed to get pull request', { prNumber, error });
      throw error;
    }
  }

  /**
   * List files in a directory
   */
  async listFiles(path: string, branch?: string): Promise<string[]> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.config.owner,
        repo: this.config.repo,
        path,
        ref: branch || this.config.defaultBranch,
      });

      if (Array.isArray(data)) {
        return data
          .filter(item => item.type === 'file')
          .map(item => item.path);
      }

      return [];
    } catch (error: any) {
      if (error.status === 404) {
        return [];
      }
      logger.error('Failed to list files', { path, error });
      throw error;
    }
  }

  /**
   * Create a comment on a pull request
   */
  async createPullRequestComment(
    pullNumber: number,
    body: string
  ): Promise<void> {
    try {
      await this.octokit.issues.createComment({
        owner: this.config.owner,
        repo: this.config.repo,
        issue_number: pullNumber,
        body,
      });
      
      logger.info('Created PR comment', { pullNumber });
    } catch (error) {
      logger.error('Failed to create PR comment', { error, pullNumber });
      throw error;
    }
  }

  /**
   * Get repository information
   */
  async getRepository(): Promise<{
    name: string;
    full_name: string;
    default_branch: string;
    language: string | null;
    size: number;
  }> {
    try {
      const { data: repo } = await this.octokit.repos.get({
        owner: this.config.owner,
        repo: this.config.repo,
      });

      return {
        name: repo.name,
        full_name: repo.full_name,
        default_branch: repo.default_branch,
        language: repo.language,
        size: repo.size,
      };
    } catch (error) {
      logger.error('Failed to get repository info', { error });
      throw error;
    }
  }

  /**
   * Search for code in the repository
   */
  async searchCode(query: string): Promise<Array<{ path: string; repository: string }>> {
    try {
      const { data } = await this.octokit.search.code({
        q: `${query} repo:${this.config.owner}/${this.config.repo}`,
        per_page: 10,
      });

      return data.items.map(item => ({
        path: item.path,
        repository: item.repository.full_name,
      }));
    } catch (error) {
      logger.error('Failed to search code', { query, error });
      throw error;
    }
  }

  /**
   * Create a complete fix for a Sentry issue
   * This creates a branch, commits files, and opens a PR
   */
  async createFixForIssue(
    issueId: string,
    issueTitle: string,
    files: Array<{ path: string; content: string }>
  ): Promise<any> {
    try {
      // Create a branch name from the issue
      const branchName = `fix/sentry-${issueId}-${Date.now()}`;
      
      // Create the branch
      await this.createBranch(branchName);
      logger.info('Created branch', { branchName });
      
      // Commit all files at once
      const commitMessage = `Fix: ${issueTitle}\n\nAutomated fix for Sentry issue ${issueId}`;
      await this.createOrUpdateFiles(branchName, files, commitMessage);
      
      // Create pull request
      const prData: PullRequestData = {
        title: `🐛 Fix: ${issueTitle}`,
        body: `This PR contains an automated fix for Sentry issue ${issueId}.\n\n` +
          `**Issue:** ${issueTitle}\n\n` +
          `**Files changed:**\n${files.map(f => `- ${f.path}`).join('\n')}\n\n` +
          `---\n*Generated by Sentrypede 🐛🤖*`,
        branch: branchName,
        files: files,
      };
      
      const pr = await this.createPullRequest(prData);
      
      logger.info('Created pull request', { 
        number: pr.number, 
        url: pr.html_url 
      });
      
      return pr;
    } catch (error) {
      logger.error('Failed to create fix for issue', { error, issueId });
      throw error;
    }
  }
} 