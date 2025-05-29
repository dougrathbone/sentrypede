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

export interface SentryOrganization {
  id: string;
  slug: string;
  name: string;
  dateCreated: string;
  status: {
    id: string;
    name: string;
  };
}

export interface SentryProject {
  id: string;
  slug: string;
  name: string;
  platform: string;
  dateCreated: string;
  status: string;
  organization: {
    id: string;
    slug: string;
    name: string;
  };
}

export class SentryService {
  private client: AxiosInstance;
  private config: SentryConfig;
  private processedIssues: Set<string> = new Set();

  constructor(config: SentryConfig) {
    this.config = config;
    
    // Check token type and warn if using organization auth token
    if (config.authToken.startsWith('sntrys_')) {
      logger.warn('Using Organization Auth Token - this has limited permissions', {
        recommendation: 'Create an Internal Integration for full API access',
        docs: 'https://docs.sentry.io/product/integrations/integration-platform/internal-integration/',
      });
    }
    
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
        if (error.response?.status === 403 && this.config.authToken.startsWith('sntrys_')) {
          logger.error('Authentication failed - Organization Auth Tokens have limited permissions', {
            status: error.response.status,
            url: error.config?.url,
            message: 'Please create an Internal Integration for full API access',
            docs: 'https://docs.sentry.io/product/integrations/integration-platform/internal-integration/',
          });
        } else {
          logger.error('Sentry API response error', { 
            status: error.response?.status,
            url: error.config?.url,
            message: error.message 
          });
        }
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

        // For now, let's fetch all unresolved issues and filter by environment later
        const response = await this.client.get(
          `/projects/${this.config.organizationSlug}/${projectSlug}/issues/`,
          {
            params: {
              statsPeriod: '24h',
              query: 'is:unresolved', // Simplified query - we'll filter environments in shouldProcessIssue
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
    if (issue.tags && Array.isArray(issue.tags)) {
      const environmentTag = issue.tags.find(tag => tag.key === 'environment');
      if (environmentTag && !this.config.environments.includes(environmentTag.value)) {
        return false;
      }
    }
    // If no tags or no environment tag, we'll process it (better to process than miss issues)

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
   * List all organizations the auth token has access to
   */
  async listOrganizations(): Promise<SentryOrganization[]> {
    try {
      const response = await this.client.get('/organizations/');
      return response.data as SentryOrganization[];
    } catch (error) {
      logger.error('Failed to list organizations', { error });
      throw error;
    }
  }

  /**
   * List all projects in the organization
   */
  async listProjects(): Promise<SentryProject[]> {
    try {
      const response = await this.client.get(
        `/organizations/${this.config.organizationSlug}/projects/`
      );
      return response.data as SentryProject[];
    } catch (error) {
      logger.error('Failed to list projects', { error });
      throw error;
    }
  }

  /**
   * Verify configuration by checking access to specified projects
   */
  async verifyConfiguration(): Promise<{
    valid: boolean;
    errors: string[];
    availableProjects: string[];
  }> {
    const errors: string[] = [];
    const availableProjects: string[] = [];

    try {
      // Check organization access
      const orgs = await this.listOrganizations();
      const orgExists = orgs.some(org => org.slug === this.config.organizationSlug);
      
      if (!orgExists) {
        errors.push(`Organization '${this.config.organizationSlug}' not found or not accessible`);
        return { valid: false, errors, availableProjects };
      }

      // Get all projects
      const projects = await this.listProjects();
      availableProjects.push(...projects.map(p => p.slug));

      // Check each configured project
      for (const projectSlug of this.config.projectSlugs) {
        const projectExists = projects.some(p => p.slug === projectSlug);
        if (!projectExists) {
          errors.push(`Project '${projectSlug}' not found in organization '${this.config.organizationSlug}'`);
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        availableProjects,
      };
    } catch (error: any) {
      if (error.response?.status === 401) {
        errors.push('Authentication failed - check your auth token');
      } else if (error.response?.status === 403) {
        errors.push('Access denied - check token permissions');
      } else {
        errors.push(`API error: ${error.message}`);
      }
      return { valid: false, errors, availableProjects };
    }
  }
} 