import { App, LogLevel } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { logger } from '../utils/logger';
import { SlackConfig } from '../config';
import { SentryIssue } from './sentry';

export interface SlackMessage {
  channel: string;
  text: string;
  blocks?: any[];
  thread_ts?: string;
}

export interface SlackThread {
  issueId: string;
  channelId: string;
  threadTs: string;
  createdAt: Date;
}

export class SlackService {
  private app: App;
  private client: WebClient;
  private config: SlackConfig;
  private threads: Map<string, SlackThread> = new Map();

  constructor(config: SlackConfig) {
    this.config = config;
    
    // Initialize Slack app
    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      signingSecret: config.signingSecret,
      socketMode: true,
      logLevel: process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.INFO,
    });

    this.client = new WebClient(config.botToken);

    this.setupEventHandlers();
  }

  /**
   * Start the Slack app
   */
  async start(): Promise<void> {
    try {
      await this.app.start();
      logger.info('Slack app started successfully');
    } catch (error) {
      logger.error('Failed to start Slack app', { error });
      throw error;
    }
  }

  /**
   * Stop the Slack app
   */
  async stop(): Promise<void> {
    try {
      await this.app.stop();
      logger.info('Slack app stopped');
    } catch (error) {
      logger.error('Failed to stop Slack app', { error });
      throw error;
    }
  }

  /**
   * Post initial notification about a new Sentry issue
   */
  async postIssueNotification(issue: SentryIssue): Promise<SlackThread> {
    try {
      const blocks = this.buildIssueBlocks(issue);
      
      const result = await this.client.chat.postMessage({
        channel: this.config.channelId,
        text: `🚨 New Sentry Issue: ${issue.title}`,
        blocks,
      });

      if (!result.ok || !result.ts) {
        throw new Error(`Failed to post message: ${result.error}`);
      }

      const thread: SlackThread = {
        issueId: issue.id,
        channelId: this.config.channelId,
        threadTs: result.ts,
        createdAt: new Date(),
      };

      this.threads.set(issue.id, thread);

      logger.info('Posted Sentry issue notification', {
        issueId: issue.id,
        threadTs: result.ts,
      });

      return thread;
    } catch (error) {
      logger.error('Failed to post issue notification', { issueId: issue.id, error });
      throw error;
    }
  }

  /**
   * Post an update to an existing thread
   */
  async postThreadUpdate(issueId: string, message: string, blocks?: any[]): Promise<void> {
    try {
      const thread = this.threads.get(issueId);
      if (!thread) {
        throw new Error(`No thread found for issue ${issueId}`);
      }

      const result = await this.client.chat.postMessage({
        channel: thread.channelId,
        thread_ts: thread.threadTs,
        text: message,
        blocks,
      });

      if (!result.ok) {
        throw new Error(`Failed to post thread update: ${result.error}`);
      }

      logger.info('Posted thread update', {
        issueId,
        threadTs: thread.threadTs,
      });
    } catch (error) {
      logger.error('Failed to post thread update', { issueId, error });
      throw error;
    }
  }

  /**
   * Post success message when a fix is created
   */
  async postFixSuccess(issueId: string, pullRequestUrl: string): Promise<void> {
    const message = '✅ Sentrypede has created a potential fix!';
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${message}\n\n*Pull Request:* <${pullRequestUrl}|View PR>\n\nPlease review the proposed changes and merge if appropriate.`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Review PR',
            },
            url: pullRequestUrl,
            style: 'primary',
          },
        ],
      },
    ];

    await this.postThreadUpdate(issueId, message, blocks);
  }

  /**
   * Post failure message when fix attempt fails
   */
  async postFixFailure(issueId: string, reason: string, sentryUrl: string): Promise<void> {
    const message = '❌ Sentrypede was unable to create a fix';
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${message}\n\n*Reason:* ${reason}\n\n*Sentry Issue:* <${sentryUrl}|View in Sentry>\n\nManual investigation required.`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View in Sentry',
            },
            url: sentryUrl,
          },
        ],
      },
    ];

    await this.postThreadUpdate(issueId, message, blocks);
  }

  /**
   * Post processing started message
   */
  async postProcessingStarted(issueId: string): Promise<void> {
    const message = '🔄 Sentrypede is analyzing this issue...';
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${message}\n\nI'm fetching the error details and will attempt to create a fix.`,
        },
      },
    ];

    await this.postThreadUpdate(issueId, message, blocks);
  }

  /**
   * Post a general message to the configured channel
   */
  async postMessage(text: string, blocks?: any[]): Promise<void> {
    try {
      const result = await this.client.chat.postMessage({
        channel: this.config.channelId,
        text,
        blocks,
      });

      if (!result.ok) {
        throw new Error(`Failed to post message: ${result.error}`);
      }

      logger.info('Posted message to Slack', {
        channel: this.config.channelId,
        text: text.substring(0, 50) + '...',
      });
    } catch (error) {
      logger.error('Failed to post message to Slack', { error });
      throw error;
    }
  }

  /**
   * Get thread information for an issue
   */
  getThread(issueId: string): SlackThread | undefined {
    return this.threads.get(issueId);
  }

  /**
   * Get all active threads
   */
  getAllThreads(): SlackThread[] {
    return Array.from(this.threads.values());
  }

  /**
   * Clear thread cache (useful for testing)
   */
  clearThreads(): void {
    this.threads.clear();
    logger.debug('Cleared Slack threads cache');
  }

  /**
   * Build Slack blocks for issue notification
   */
  private buildIssueBlocks(issue: SentryIssue): any[] {
    const environmentTag = issue.tags.find(tag => tag.key === 'environment');
    const environment = environmentTag?.value || 'unknown';

    return [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🚨 New Sentry Issue Detected',
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Issue:* ${issue.title}`,
          },
          {
            type: 'mrkdwn',
            text: `*Project:* ${issue.project.name}`,
          },
          {
            type: 'mrkdwn',
            text: `*Environment:* ${environment}`,
          },
          {
            type: 'mrkdwn',
            text: `*Level:* ${issue.level.toUpperCase()}`,
          },
          {
            type: 'mrkdwn',
            text: `*Count:* ${issue.count}`,
          },
          {
            type: 'mrkdwn',
            text: `*Users Affected:* ${issue.userCount}`,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Error:* \`${issue.metadata.type}: ${issue.metadata.value}\``,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View in Sentry',
            },
            url: issue.permalink,
          },
        ],
      },
      {
        type: 'divider',
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Sentrypede will now attempt to analyze and fix this issue automatically.`,
          },
        ],
      },
    ];
  }

  /**
   * Setup event handlers for the Slack app
   */
  private setupEventHandlers(): void {
    // Handle app mentions
    this.app.event('app_mention', async ({ event, say }) => {
      try {
        await say({
          text: `Hello <@${event.user}>! I'm Sentrypede, your automated bug-fixing assistant. I monitor Sentry for new issues and attempt to fix them automatically.`,
          thread_ts: event.ts,
        });
      } catch (error) {
        logger.error('Failed to handle app mention', { error });
      }
    });

    // Handle direct messages
    this.app.message('hello', async ({ say }) => {
      try {
        await say({
          text: 'Hello! I\'m Sentrypede. I automatically monitor Sentry issues and create fixes. You can check my status by mentioning me in a channel.',
        });
      } catch (error) {
        logger.error('Failed to handle direct message', { error });
      }
    });

    // Global error handler
    this.app.error(async (error) => {
      logger.error('Slack app error', { error });
    });
  }
} 