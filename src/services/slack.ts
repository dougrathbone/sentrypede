import { App, LogLevel, KnownBlock } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { logger } from '../utils/logger';
import { SlackConfig } from '../config';
import { SentryIssue, SentryEvent } from './sentry';

export interface SlackThread {
  issueId: string;
  channelId: string;
  threadTs: string;
  createdAt: Date;
  status: 'processing' | 'success' | 'failed';
}

export interface IssueContext {
  issue: SentryIssue;
  event?: SentryEvent;
  analysisConfidence?: number;
  fixAttempted?: boolean;
}

export class SlackService {
  private app: App;
  private client: WebClient;
  private config: SlackConfig;
  private threads: Map<string, SlackThread> = new Map();
  private issueContexts: Map<string, IssueContext> = new Map();

  constructor(config: SlackConfig) {
    this.config = config;
    
    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      signingSecret: config.signingSecret,
      socketMode: true,
      logLevel: process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.INFO,
    });

    this.client = new WebClient(config.botToken);
    this.setupHandlers();
  }

  /**
   * Start the Slack service
   */
  async start(): Promise<void> {
    await this.app.start();
    logger.info('Slack service started');
  }

  /**
   * Stop the Slack service
   */
  async stop(): Promise<void> {
    await this.app.stop();
    logger.info('Slack service stopped');
  }

  /**
   * Post a new issue notification and create a thread
   */
  async notifyNewIssue(issue: SentryIssue, event?: SentryEvent): Promise<SlackThread> {
    const blocks = this.createIssueBlocks(issue, event);
    
    const result = await this.client.chat.postMessage({
      channel: this.config.channelId,
      text: `🚨 New ${issue.level} in ${issue.project.name}: ${this.truncate(issue.title, 100)}`,
      blocks,
      unfurl_links: false,
    });

    if (!result.ok || !result.ts) {
      throw new Error(`Failed to post message: ${result.error}`);
    }

    const thread: SlackThread = {
      issueId: issue.id,
      channelId: this.config.channelId,
      threadTs: result.ts,
      createdAt: new Date(),
      status: 'processing',
    };

    this.threads.set(issue.id, thread);
    this.issueContexts.set(issue.id, { 
      issue, 
      ...(event && { event })
    });

    logger.info('Posted issue notification', { issueId: issue.id, threadTs: result.ts });
    return thread;
  }

  /**
   * Update the thread with current status
   */
  async updateStatus(issueId: string, status: string, details?: string): Promise<void> {
    const thread = this.threads.get(issueId);
    if (!thread) {
      logger.warn('No thread found for issue', { issueId });
      return;
    }

    const emoji = this.getStatusEmoji(status);
    const message = details ? `${emoji} ${status}\n${details}` : `${emoji} ${status}`;

    await this.client.chat.postMessage({
      channel: thread.channelId,
      thread_ts: thread.threadTs,
      text: message,
    });
  }

  /**
   * Post analysis results in a clean format
   */
  async postAnalysis(
    issueId: string, 
    analysis: {
      summary: string;
      cause: string;
      suggestion: string;
      confidence: number;
    }
  ): Promise<void> {
    const thread = this.threads.get(issueId);
    if (!thread) return;

    const context = this.issueContexts.get(issueId);
    if (context) {
      context.analysisConfidence = analysis.confidence;
    }

    const confidenceEmoji = analysis.confidence > 0.7 ? '🟢' : analysis.confidence > 0.4 ? '🟡' : '🔴';
    
    const blocks: KnownBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🔍 *Analysis Complete*\n\n*Summary:* ${analysis.summary}\n*Likely Cause:* ${analysis.cause}\n*Confidence:* ${confidenceEmoji} ${Math.round(analysis.confidence * 100)}%`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Suggested Fix:*\n\`\`\`${analysis.suggestion}\`\`\``,
        },
      },
    ];

    await this.client.chat.postMessage({
      channel: thread.channelId,
      thread_ts: thread.threadTs,
      text: '🔍 Analysis Complete',
      blocks,
    });
  }

  /**
   * Post success notification with PR link
   */
  async notifySuccess(issueId: string, prUrl: string, summary?: string): Promise<void> {
    const thread = this.threads.get(issueId);
    if (!thread) return;

    thread.status = 'success';
    const context = this.issueContexts.get(issueId);
    if (context) {
      context.fixAttempted = true;
    }

    const blocks: KnownBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Fix Created Successfully!*${summary ? `\n\n${summary}` : ''}\n\n<${prUrl}|View Pull Request>`,
        },
        accessory: {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Review PR',
          },
          url: prUrl,
          style: 'primary',
        },
      },
    ];

    await this.client.chat.postMessage({
      channel: thread.channelId,
      thread_ts: thread.threadTs,
      text: '✅ Fix created successfully!',
      blocks,
    });
  }

  /**
   * Post failure notification with helpful context
   */
  async notifyFailure(issueId: string, reason: string, suggestions?: string[]): Promise<void> {
    const thread = this.threads.get(issueId);
    if (!thread) return;

    thread.status = 'failed';
    const context = this.issueContexts.get(issueId);
    const issue = context?.issue;

    let text = `❌ *Unable to create automated fix*\n\n*Reason:* ${reason}`;
    
    if (suggestions && suggestions.length > 0) {
      text += '\n\n*Next steps:*\n' + suggestions.map(s => `• ${s}`).join('\n');
    }

    const blocks: KnownBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text,
        },
      },
    ];

    if (issue) {
      blocks.push({
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
      });
    }

    await this.client.chat.postMessage({
      channel: thread.channelId,
      thread_ts: thread.threadTs,
      text: '❌ Unable to create automated fix',
      blocks,
    });
  }

  /**
   * Post a simple message to the channel (not in a thread)
   */
  async postMessage(text: string, blocks?: KnownBlock[]): Promise<void> {
    await this.client.chat.postMessage({
      channel: this.config.channelId,
      text,
      blocks,
    });
  }

  /**
   * Get thread info for an issue
   */
  getThread(issueId: string): SlackThread | undefined {
    return this.threads.get(issueId);
  }

  /**
   * Create issue notification blocks
   */
  private createIssueBlocks(issue: SentryIssue, event?: SentryEvent): KnownBlock[] {
    const env = issue.tags?.find(t => t.key === 'environment')?.value || 'unknown';
    const browser = issue.tags?.find(t => t.key === 'browser')?.value;
    
    // Build a clean, scannable summary
    const summary = [
      `📍 *${issue.project.name}* (${env})`,
      `🔢 ${this.formatNumber(parseInt(issue.count))} occurrences affecting ${this.formatNumber(issue.userCount)} users`,
      `⏱️ First seen ${this.getRelativeTime(new Date(issue.firstSeen))}`,
    ];

    if (browser) {
      summary.push(`🌐 ${browser}`);
    }

    const blocks: KnownBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${this.getSeverityEmoji(issue.level)} ${issue.level.toUpperCase()}: ${issue.metadata.type}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${this.truncate(issue.title, 150)}*\n\n${summary.join('\n')}`,
        },
      },
    ];

    // Add error location if available
    if (issue.culprit) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📄 \`${issue.culprit}\``,
        },
      });
    }

    // Add error message if different from title
    if (issue.metadata.value && issue.metadata.value !== issue.title) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `\`\`\`${this.truncate(issue.metadata.value, 200)}\`\`\``,
        },
      });
    }

    // Add stack trace preview if available
    if (event?.entries) {
      const stackFrame = this.getRelevantStackFrame(event);
      if (stackFrame) {
        blocks.push({
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: `Stack: \`${stackFrame.filename}:${stackFrame.lineno}\` in \`${stackFrame.function || 'anonymous'}\``,
          }],
        });
      }
    }

    // Add action buttons
    blocks.push(
      {
        type: 'divider',
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
      }
    );

    return blocks;
  }

  /**
   * Setup Slack event handlers
   */
  private setupHandlers(): void {
    // Handle mentions
    this.app.event('app_mention', async ({ event, say }) => {
      const text = event.text.toLowerCase();
      
      if (text.includes('status')) {
        const stats = this.getStats();
        await say({
          thread_ts: event.ts,
          text: `📊 *Current Status*\n• Active issues: ${stats.active}\n• Fixed today: ${stats.fixed}\n• Failed: ${stats.failed}`,
        });
      } else if (text.includes('help')) {
        await say({
          thread_ts: event.ts,
          text: `👋 I'm Sentrypede! I monitor Sentry for errors and create fixes.\n\nCommands:\n• \`@Sentrypede status\` - See current stats\n• \`@Sentrypede help\` - Show this message`,
        });
      } else {
        await say({
          thread_ts: event.ts,
          text: `Hello! Type \`@Sentrypede help\` to see what I can do.`,
        });
      }
    });

    // Handle errors
    this.app.error(async (error) => {
      logger.error('Slack app error', { error });
    });
  }

  /**
   * Get simple stats
   */
  private getStats() {
    const threads = Array.from(this.threads.values());
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return {
      active: threads.filter(t => t.status === 'processing').length,
      fixed: threads.filter(t => t.status === 'success' && t.createdAt >= today).length,
      failed: threads.filter(t => t.status === 'failed' && t.createdAt >= today).length,
    };
  }

  /**
   * Utility methods
   */
  private getSeverityEmoji(level: string): string {
    const emojis: Record<string, string> = {
      fatal: '💀',
      error: '🔴',
      warning: '⚠️',
      info: 'ℹ️',
    };
    return emojis[level] || '🔵';
  }

  private getStatusEmoji(status: string): string {
    const statusLower = status.toLowerCase();
    if (statusLower.includes('analyz')) return '🔍';
    if (statusLower.includes('fetch')) return '📥';
    if (statusLower.includes('generat') || statusLower.includes('creat')) return '🔨';
    if (statusLower.includes('test')) return '🧪';
    if (statusLower.includes('complete') || statusLower.includes('success')) return '✅';
    if (statusLower.includes('fail') || statusLower.includes('error')) return '❌';
    return '🔄';
  }

  private formatNumber(num: number): string {
    return new Intl.NumberFormat().format(num);
  }

  private getRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMins > 0) return `${diffMins}m ago`;
    return 'just now';
  }

  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  private getRelevantStackFrame(event: SentryEvent): any {
    const exception = event.entries?.find(e => e.type === 'exception');
    const frames = exception?.data?.values?.[0]?.stacktrace?.frames;
    return frames?.[frames.length - 1];
  }

  /**
   * Backward compatibility methods
   */
  async postIssueNotification(issue: SentryIssue): Promise<SlackThread> {
    return this.notifyNewIssue(issue);
  }

  async postProcessingStarted(issueId: string): Promise<void> {
    return this.updateStatus(issueId, 'Analyzing issue...');
  }

  async postFixSuccess(issueId: string, prUrl: string): Promise<void> {
    return this.notifySuccess(issueId, prUrl);
  }

  async postFixFailure(issueId: string, reason: string, _sentryUrl: string): Promise<void> {
    return this.notifyFailure(issueId, reason);
  }

  async postThreadUpdate(issueId: string, message: string): Promise<void> {
    const thread = this.threads.get(issueId);
    if (!thread) return;

    await this.client.chat.postMessage({
      channel: thread.channelId,
      thread_ts: thread.threadTs,
      text: message,
    });
  }
} 