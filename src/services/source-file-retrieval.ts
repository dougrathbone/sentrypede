import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logger';
import { GitHubConfig } from '../config';
import { FileCache } from './file-cache';
import { ParsedStackTrace, StackTraceParser } from '../utils/stack-trace-parser';

export interface SourceFileContext {
  filePath: string;
  content: string;
  errorLocation: {
    line: number;
    column: number | null;
    function: string | null;
  } | null;
  contextLines: {
    startLine: number;
    endLine: number;
    lines: Array<{
      number: number;
      content: string;
      isErrorLine: boolean;
    }>;
  };
  fileInfo: {
    size: number;
    language: string | null;
    commitSha: string;
  };
}

export interface SourceAnalysisContext {
  primaryFile: SourceFileContext;
  relatedFiles: SourceFileContext[];
  stackTrace: ParsedStackTrace;
  repositoryInfo: {
    owner: string;
    repo: string;
    defaultBranch: string;
    commitSha: string;
  };
}

export class SourceFileRetrievalService {
  private octokit: Octokit;
  private config: GitHubConfig;
  private fileCache: FileCache;

  constructor(config: GitHubConfig, fileCache?: FileCache) {
    this.config = config;
    this.octokit = new Octokit({
      auth: config.token,
    });
    this.fileCache = fileCache || new FileCache();
  }

  /**
   * Fetch file content at a specific commit
   */
  async fetchFileAtCommit(
    filePath: string, 
    commitSha: string
  ): Promise<string | null> {
    const repoKey = `${this.config.owner}/${this.config.repo}`;
    
    // Check cache first
    const cached = this.fileCache.get(repoKey, filePath, commitSha);
    if (cached) {
      return cached;
    }

    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.config.owner,
        repo: this.config.repo,
        path: filePath,
        ref: commitSha,
      });

      if ('content' in data && data.type === 'file') {
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        
        // Cache the result
        this.fileCache.set(repoKey, filePath, commitSha, content);
        
        logger.debug('Fetched file from GitHub', { 
          filePath, 
          commitSha: commitSha.substring(0, 8),
          size: content.length 
        });
        
        return content;
      }

      return null;
    } catch (error: any) {
      if (error.status === 404) {
        logger.debug('File not found', { filePath, commitSha: commitSha.substring(0, 8) });
        return null;
      }
      logger.error('Failed to fetch file content', { filePath, commitSha, error });
      throw error;
    }
  }

  /**
   * Fetch multiple files at once
   */
  async fetchMultipleFiles(
    filePaths: string[], 
    commitSha: string
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    
    // Use Promise.allSettled to handle partial failures
    const promises = filePaths.map(async (filePath) => {
      try {
        const content = await this.fetchFileAtCommit(filePath, commitSha);
        if (content !== null) {
          results.set(filePath, content);
        }
      } catch (error) {
        logger.warn('Failed to fetch file', { filePath, error });
      }
    });

    await Promise.allSettled(promises);
    
    logger.info('Fetched multiple files', { 
      requested: filePaths.length, 
      retrieved: results.size,
      commitSha: commitSha.substring(0, 8) 
    });
    
    return results;
  }

  /**
   * Get the latest commit SHA for the repository
   */
  async getLatestCommitSha(branch?: string): Promise<string> {
    try {
      const { data } = await this.octokit.repos.getCommit({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: branch || this.config.defaultBranch,
      });

      return data.sha;
    } catch (error) {
      logger.error('Failed to get latest commit SHA', { error });
      throw error;
    }
  }

  /**
   * Extract file paths from stack trace and convert to GitHub-compatible paths
   */
  extractFilePathsFromStackTrace(stackTrace: ParsedStackTrace): string[] {
    return stackTrace.repositoryPaths
      .filter(path => path && path.length > 0)
      .map(path => this.cleanWebpackPath(path))
      .filter(path => path && path.length > 0)
      .slice(0, 10); // Limit to first 10 files to avoid API rate limits
  }

  /**
   * Clean webpack paths to convert them to GitHub file paths
   */
  private cleanWebpackPath(path: string): string {
    if (!path) return '';

    // Remove webpack prefix and resolve to source path
    let cleanPath = path;

    // Remove common webpack prefixes
    const webpackPrefixes = [
      'webpack://',
      'webpack:///',
    ];

    for (const prefix of webpackPrefixes) {
      if (cleanPath.startsWith(prefix)) {
        cleanPath = cleanPath.substring(prefix.length);
        break;
      }
    }

    // Remove project-specific prefixes
    const projectPrefixes = [
      '@dvtl/web-app/',
      'web-app/',
      'app/',
    ];

    for (const prefix of projectPrefixes) {
      if (cleanPath.startsWith(prefix)) {
        cleanPath = cleanPath.substring(prefix.length);
        break;
      }
    }

    // Handle relative path indicators
    if (cleanPath.startsWith('./')) {
      cleanPath = cleanPath.substring(2);
    }

    // Remove node_modules references that might still be there
    if (cleanPath.includes('node_modules')) {
      return '';
    }

    // Remove leading slashes
    cleanPath = cleanPath.replace(/^\/+/, '');

    return cleanPath;
  }

  /**
   * Get commit SHA from Sentry event (if available) or use latest
   */
  async getCommitShaFromEvent(sentryEvent: any): Promise<string> {
    // Try to extract commit from Sentry tags
    const commitTag = sentryEvent.tags?.find((tag: any) => 
      ['commit', 'revision', 'sha', 'version'].includes(tag.key?.toLowerCase())
    );

    if (commitTag?.value && this.isValidCommitSha(commitTag.value)) {
      logger.debug('Using commit SHA from Sentry event', { 
        commitSha: commitTag.value.substring(0, 8) 
      });
      return commitTag.value;
    }

    // Try to extract from Sentry release
    const release = sentryEvent.release;
    if (release && this.isValidCommitSha(release)) {
      logger.debug('Using commit SHA from Sentry release', { 
        commitSha: release.substring(0, 8) 
      });
      return release;
    }

    // Fall back to latest commit
    const latestSha = await this.getLatestCommitSha();
    logger.debug('Using latest commit SHA', { 
      commitSha: latestSha.substring(0, 8) 
    });
    return latestSha;
  }

  /**
   * Check if a string looks like a valid commit SHA
   */
  private isValidCommitSha(value: string): boolean {
    return /^[a-f0-9]{6,40}$/i.test(value);
  }

  /**
   * Create source file context with error location and surrounding lines
   */
  async createSourceContext(
    filePath: string,
    content: string,
    errorLocation: { line: number; column: number | null; function: string | null } | null,
    commitSha: string
  ): Promise<SourceFileContext> {
    const lines = content.split('\n');
    const contextLines = this.getContextLines(lines, errorLocation?.line, errorLocation?.line);
    
    return {
      filePath,
      content,
      errorLocation,
      contextLines,
      fileInfo: {
        size: Buffer.byteLength(content, 'utf8'),
        language: this.detectLanguageFromPath(filePath),
        commitSha,
      },
    };
  }

  /**
   * Get context lines around error location
   */
  private getContextLines(
    lines: string[], 
    errorLine?: number, 
    actualErrorLine?: number,
    contextSize: number = 10
  ): SourceFileContext['contextLines'] {
    const centerLine = errorLine || Math.ceil(lines.length / 2);
    const startLine = Math.max(1, centerLine - contextSize);
    const endLine = Math.min(lines.length, centerLine + contextSize);
    
    const contextLines: Array<{
      number: number;
      content: string;
      isErrorLine: boolean;
    }> = [];

    for (let i = startLine; i <= endLine; i++) {
      contextLines.push({
        number: i,
        content: lines[i - 1] || '', // lines array is 0-indexed
        isErrorLine: actualErrorLine ? i === actualErrorLine : false,
      });
    }

    return {
      startLine,
      endLine,
      lines: contextLines,
    };
  }

  /**
   * Detect programming language from file path
   */
  private detectLanguageFromPath(filePath: string): string | null {
    const parts = filePath.split('.');
    if (parts.length < 2) {
      return null; // No extension
    }
    
    const extension = parts.pop()?.toLowerCase();
    if (!extension) {
      return null;
    }
    
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'java': 'java',
      'go': 'go',
      'rb': 'ruby',
      'php': 'php',
      'cs': 'csharp',
      'cpp': 'cpp',
      'cc': 'cpp',
      'c': 'c',
      'h': 'c',
      'hpp': 'cpp',
      'rs': 'rust',
      'kt': 'kotlin',
      'swift': 'swift',
      'dart': 'dart',
      'scala': 'scala',
      'clj': 'clojure',
      'ex': 'elixir',
      'exs': 'elixir',
      'hs': 'haskell',
      'ml': 'ocaml',
      'fs': 'fsharp',
      'vb': 'vbnet',
      'lua': 'lua',
      'r': 'r',
      'jl': 'julia',
      'nim': 'nim',
      'cr': 'crystal',
      'v': 'vlang',
      'zig': 'zig',
    };

    return languageMap[extension] || extension;
  }

  /**
   * Create complete source analysis context from Sentry event
   */
  async createAnalysisContext(sentryEvent: any): Promise<SourceAnalysisContext | null> {
    try {
      // Parse stack trace from Sentry event
      const stackTrace = StackTraceParser.parseFromSentryEvent(sentryEvent);
      if (!stackTrace) {
        logger.warn('No stack trace found in Sentry event', { 
          eventId: sentryEvent.id 
        });
        return null;
      }

      // For production builds, we might not have errorLocation but still have repositoryPaths
      const filePaths = this.extractFilePathsFromStackTrace(stackTrace);
      if (filePaths.length === 0) {
        logger.warn('No application files found in stack trace', { 
          eventId: sentryEvent.id,
          totalFrames: stackTrace.frames.length,
          repositoryPaths: stackTrace.repositoryPaths
        });
        return null;
      }

      logger.info('Found application files in stack trace', {
        eventId: sentryEvent.id,
        filePaths,
        hasErrorLocation: !!stackTrace.errorLocation
      });

      // Get commit SHA
      const commitSha = await this.getCommitShaFromEvent(sentryEvent);

      // Fetch all relevant files
      const fileContents = await this.fetchMultipleFiles(filePaths, commitSha);
      
      if (fileContents.size === 0) {
        logger.warn('Could not fetch any source files from GitHub', { 
          eventId: sentryEvent.id,
          filePaths,
          commitSha: commitSha.substring(0, 8)
        });
        return null;
      }

      logger.info('Successfully fetched source files', {
        eventId: sentryEvent.id,
        fetchedFiles: Array.from(fileContents.keys()),
        commitSha: commitSha.substring(0, 8)
      });

      // Determine primary file - prefer errorLocation file, otherwise use first available
      let primaryFilePath: string;
      let errorLocation: { line: number; column: number | null; function: string | null } | null = null;
      
      if (stackTrace.errorLocation && fileContents.has(stackTrace.errorLocation.filename)) {
        // Use errorLocation if available and we have the file
        primaryFilePath = stackTrace.errorLocation.filename;
        errorLocation = {
          line: stackTrace.errorLocation.lineno,
          column: stackTrace.errorLocation.colno,
          function: stackTrace.errorLocation.function,
        };
      } else {
        // Fall back to first fetched file (production case)
        primaryFilePath = Array.from(fileContents.keys())[0];
        logger.warn('Using fallback primary file (no specific error location)', {
          eventId: sentryEvent.id,
          primaryFilePath,
          reason: stackTrace.errorLocation ? 'file_not_fetched' : 'no_error_location'
        });
      }

      const primaryFileContent = fileContents.get(primaryFilePath)!;

      const primaryFile = await this.createSourceContext(
        primaryFilePath,
        primaryFileContent,
        errorLocation,
        commitSha
      );

      // Create related file contexts
      const relatedFiles: SourceFileContext[] = [];
      for (const [filePath, content] of fileContents.entries()) {
        if (filePath !== primaryFilePath) {
          const relatedFile = await this.createSourceContext(
            filePath,
            content,
            null, // No specific error location for related files
            commitSha
          );
          relatedFiles.push(relatedFile);
        }
      }

      return {
        primaryFile,
        relatedFiles,
        stackTrace,
        repositoryInfo: {
          owner: this.config.owner,
          repo: this.config.repo,
          defaultBranch: this.config.defaultBranch,
          commitSha,
        },
      };
    } catch (error) {
      logger.error('Failed to create analysis context', { 
        eventId: sentryEvent.id, 
        error 
      });
      return null;
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.fileCache.getStats();
  }

  /**
   * Clear the file cache
   */
  clearCache(): void {
    this.fileCache.clear();
  }
} 