export interface StackFrame {
  filename: string;
  function: string | null;
  lineno: number;
  colno: number | null;
  context_line: string | null;
  pre_context: string[] | null;
  post_context: string[] | null;
  in_app: boolean;
  module: string | null;
  package: string | null;
  abs_path: string | null;
}

export interface ParsedStackTrace {
  frames: StackFrame[];
  repositoryPaths: string[];
  errorLocation: {
    filename: string;
    lineno: number;
    colno: number | null;
    function: string | null;
  } | null;
}

export class StackTraceParser {
  /**
   * Parse a Sentry event to extract structured stack trace information
   */
  static parseFromSentryEvent(event: any): ParsedStackTrace | null {
    try {
      const stacktraceEntry = event.entries?.find((entry: any) => entry.type === 'exception');
      if (!stacktraceEntry) {
        return null;
      }

      const exception = stacktraceEntry.data;
      if (!exception.values || exception.values.length === 0) {
        return null;
      }

      const stacktrace = exception.values[0].stacktrace;
      if (!stacktrace || !stacktrace.frames) {
        return null;
      }

      // Extract and clean frames
      const frames: StackFrame[] = stacktrace.frames
        .filter((frame: any) => frame.filename)
        .map((frame: any) => ({
          filename: this.cleanFilename(frame.filename),
          function: frame.function || null,
          lineno: frame.lineno || 0,
          colno: frame.colno || null,
          context_line: frame.context_line || null,
          pre_context: frame.pre_context || null,
          post_context: frame.post_context || null,
          in_app: frame.in_app || false,
          module: frame.module || null,
          package: frame.package || null,
          abs_path: frame.abs_path || null,
        }));

      // Extract repository paths (filter out node_modules and system files)
      const repositoryPaths = frames
        .filter(frame => this.isApplicationFile(frame.filename))
        .map(frame => frame.filename)
        .filter((path, index, array) => array.indexOf(path) === index); // Remove duplicates

      // Find the error location (first in-app frame)
      const errorFrame = frames.find(frame => frame.in_app && this.isApplicationFile(frame.filename));
      const errorLocation = errorFrame ? {
        filename: errorFrame.filename,
        lineno: errorFrame.lineno,
        colno: errorFrame.colno,
        function: errorFrame.function,
      } : null;

      return {
        frames,
        repositoryPaths,
        errorLocation,
      };
    } catch (error) {
      console.error('Failed to parse stack trace:', error);
      return null;
    }
  }

  /**
   * Clean filename to remove URLs, absolute paths, and normalize
   */
  private static cleanFilename(filename: string): string {
    if (!filename) return '';

    // Remove protocol and host from URLs
    if (filename.startsWith('http://') || filename.startsWith('https://')) {
      const url = new URL(filename);
      filename = url.pathname;
    }

    // Remove leading slashes and normalize path separators
    filename = filename.replace(/^\/+/, '');
    filename = filename.replace(/\\/g, '/');

    // Remove common prefixes in order (most specific first)
    const prefixesToRemove = [
      'webpack:///',
      'webpack://',
      'app/',
      'src/',
      'dist/',
      'build/',
    ];

    // Keep removing prefixes until none match
    let changed = true;
    while (changed) {
      changed = false;
      for (const prefix of prefixesToRemove) {
        if (filename.startsWith(prefix)) {
          filename = filename.substring(prefix.length);
          changed = true;
          break; // Start over to check for more prefixes
        }
      }
    }

    return filename;
  }

  /**
   * Check if a file is part of the application code (not node_modules or system files)
   */
  private static isApplicationFile(filename: string): boolean {
    if (!filename) return false;

    const excludePatterns = [
      /node_modules/,
      /webpack/,
      /babel/,
      /core-js/,
      /regenerator-runtime/,
      /lodash/,
      /\.(min|bundle)\./,
      /^internal\//,
      /^node:/,
      /^fs\./,
      /^path\./,
      /^util\./,
    ];

    return !excludePatterns.some(pattern => pattern.test(filename));
  }

  /**
   * Extract repository information from stack trace frames
   */
  static extractRepositoryInfo(frames: StackFrame[]): {
    owner: string | null;
    repo: string | null;
    detectedLanguage: string | null;
  } {
    // For now, return null since we'll get repo info from configuration
    // In the future, this could analyze file patterns to detect repo structure
    return {
      owner: null,
      repo: null,
      detectedLanguage: this.detectLanguageFromFrames(frames),
    };
  }

  /**
   * Detect programming language from stack trace frames
   */
  private static detectLanguageFromFrames(frames: StackFrame[]): string | null {
    const extensions = frames
      .map(frame => {
        const match = frame.filename.match(/\.([^.]+)$/);
        return match ? match[1].toLowerCase() : null;
      })
      .filter(ext => ext !== null);

    const extensionCounts = extensions.reduce((acc, ext) => {
      acc[ext!] = (acc[ext!] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const languageMapping: Record<string, string> = {
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
      'c': 'c',
    };

    // Find the most common extension
    const mostCommonExt = Object.entries(extensionCounts)
      .sort(([, a], [, b]) => b - a)[0]?.[0];

    return mostCommonExt ? languageMapping[mostCommonExt] || mostCommonExt : null;
  }

  /**
   * Get surrounding lines range for context
   */
  static getContextRange(lineno: number, contextLines: number = 10): {
    startLine: number;
    endLine: number;
  } {
    const startLine = Math.max(1, lineno - contextLines);
    const endLine = lineno + contextLines;
    return { startLine, endLine };
  }
} 