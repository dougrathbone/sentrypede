import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { SentryConfig } from '../config';

export interface SentryIssue {
  id: string;
  title: string;
  culprit: string;
  permalink: string;
  shortId: string;
  status: string;
  level: string;
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  project: {
    id: string;
    name: string;
    slug: string;
  };
  metadata: {
    type: string;
    value: string;
    filename?: string;
    function?: string;
  };
  tags: Array<{
    key: string;
    value: string;
  }>;
}

export interface SentryEvent {
  id: string;
  message: string;
  platform: string;
  timestamp: string;
  tags: Array<{
    key: string;
    value: string;
  }>;
  entries: Array<{
    type: string;
    data: any;
  }>;
  context: {
    [key: string]: any;
  };
}

export class SentryService {
  private client: AxiosInstance;
  private config: SentryConfig;
  private processedIssues: Set<string> = new Set();

  constructor(config: SentryConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: 'https://sentry.io/api/0',
      headers: {
        'Authorization': `Bearer ${config.authToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Add request/response interceptors for logging
    this.client.interceptors.request.use(
      (config) => {
        logger.debug('Sentry API request', { 
          method: config.method, 
          url: config.url,
          params: config.params 
        });
        return config;
      },
      (error) => {
        logger.error('Sentry API request error', { error });
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug('Sentry API response', { 
          status: response.status, 
          url: response.config.url 
        });
        return response;
      },
      (error) => {
        logger.error('Sentry API response error', { 
          status: error.response?.status,
          url: error.config?.url,
          message: error.message 
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Fetch recent issues from Sentry
   */
  async fetchRecentIssues(): Promise<SentryIssue[]> {
    try {
      const allIssues: SentryIssue[] = [];

      for (const projectSlug of this.config.projectSlugs) {
        logger.debug('Fetching issues for project', { projectSlug });

        const response = await this.client.get(
          `/projects/${this.config.organizationSlug}/${projectSlug}/issues/`,
          {
            params: {
              statsPeriod: '1h', // Last hour
              query: this.buildQuery(),
              sort: 'date',
              limit: 25,
            },
          }
        );

        const projectIssues = response.data as SentryIssue[];
        allIssues.push(...projectIssues);

        logger.info('Fetched issues for project', { 
          projectSlug, 
          issueCount: projectIssues.length 
        });
      }

      return allIssues;
    } catch (error) {
      logger.error('Failed to fetch Sentry issues', { error });
      throw error;
    }
  }

  /**
   * Get detailed information about a specific issue
   */
  async getIssueDetails(issueId: string): Promise<SentryIssue> {
    try {
      const response = await this.client.get(`/issues/${issueId}/`);
      return response.data as SentryIssue;
    } catch (error) {
      logger.error('Failed to fetch issue details', { issueId, error });
      throw error;
    }
  }

  /**
   * Get the latest event for an issue
   */
  async getLatestEvent(issueId: string): Promise<SentryEvent> {
    try {
      const response = await this.client.get(`/issues/${issueId}/events/latest/`);
      return response.data as SentryEvent;
    } catch (error) {
      logger.error('Failed to fetch latest event', { issueId, error });
      throw error;
    }
  }

  /**
   * Extract stack trace from a Sentry event
   */
  extractStackTrace(event: SentryEvent): string | null {
    try {
      const stacktraceEntry = event.entries.find(entry => entry.type === 'exception');
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

      // Build a readable stack trace
      const frames = stacktrace.frames
        .filter((frame: any) => frame.filename && frame.lineno)
        .map((frame: any) => {
          const filename = frame.filename.split('/').pop() || frame.filename;
          const context = frame.context_line ? `\n    ${frame.context_line.trim()}` : '';
          return `  at ${frame.function || '<anonymous>'} (${filename}:${frame.lineno}:${frame.colno || 0})${context}`;
        })
        .reverse() // Reverse to show most recent call first
        .join('\n');

      return frames;
    } catch (error) {
      logger.error('Failed to extract stack trace', { error });
      return null;
    }
  }

  /**
   * Check if an issue should be processed
   */
  shouldProcessIssue(issue: SentryIssue): boolean {
    // Skip if already processed
    if (this.processedIssues.has(issue.id)) {
      return false;
    }

    // Skip resolved issues
    if (issue.status === 'resolved') {
      return false;
    }

    // Only process error-level issues
    if (issue.level !== 'error' && issue.level !== 'fatal') {
      return false;
    }

    // Check if issue is in configured environments
    const environmentTag = issue.tags.find(tag => tag.key === 'environment');
    if (environmentTag && !this.config.environments.includes(environmentTag.value)) {
      return false;
    }

    return true;
  }

  /**
   * Mark an issue as processed
   */
  markAsProcessed(issueId: string): void {
    this.processedIssues.add(issueId);
    logger.debug('Marked issue as processed', { issueId });
  }

  /**
   * Get the count of processed issues
   */
  getProcessedCount(): number {
    return this.processedIssues.size;
  }

  /**
   * Clear processed issues cache (useful for testing)
   */
  clearProcessedCache(): void {
    this.processedIssues.clear();
    logger.debug('Cleared processed issues cache');
  }

  /**
   * Build query string for filtering issues
   */
  private buildQuery(): string {
    const conditions: string[] = [];

    // Filter by environments
    if (this.config.environments.length > 0) {
      const envCondition = this.config.environments
        .map(env => `environment:${env}`)
        .join(' OR ');
      conditions.push(`(${envCondition})`);
    }

    // Only unresolved issues
    conditions.push('is:unresolved');

    return conditions.join(' ');
  }
} 