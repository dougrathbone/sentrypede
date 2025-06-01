import { App, LogLevel, KnownBlock } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { logger } from '../utils/logger';
import { SlackConfig } from '../config';
import { SentryIssue, SentryEvent } from './sentry';
import { SlackMessageBuilderService } from './slack-message.builder';

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
  private messageBuilder: SlackMessageBuilderService;

  constructor(config: SlackConfig) {
    this.config = config;
    this.messageBuilder = new SlackMessageBuilderService();
    
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
    const blocks = this.messageBuilder.createInitialIssueBlocks(issue, event);
    const text = this.messageBuilder.getInitialIssueFallbackText(issue);
    
    const result = await this.client.chat.postMessage({
      channel: this.config.channelId,
      text,
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

    const message = this.messageBuilder.createStatusMessageText(status, details);

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

    const blocks = this.messageBuilder.createAnalysisReportBlocks(analysis);
    const text = this.messageBuilder.getAnalysisReportFallbackText();

    await this.client.chat.postMessage({
      channel: thread.channelId,
      thread_ts: thread.threadTs,
      text,
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

    const blocks = this.messageBuilder.createSuccessBlocks(prUrl, summary);
    const text = this.messageBuilder.getSuccessFallbackText();

    await this.client.chat.postMessage({
      channel: thread.channelId,
      thread_ts: thread.threadTs,
      text,
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

    const blocks = this.messageBuilder.createFailureBlocks(reason, issue?.permalink, suggestions);
    const text = this.messageBuilder.getFailureFallbackText();

    await this.client.chat.postMessage({
      channel: thread.channelId,
      thread_ts: thread.threadTs,
      text,
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
   * Setup Slack event handlers
   */
  private setupHandlers(): void {
    // Handle mentions
    this.app.event('app_mention', async ({ event, say }) => {
      const text = event.text.toLowerCase();
      
      if (text.includes('status')) {
        const stats = this.getStats();
        await say({ thread_ts: event.ts, ...this.messageBuilder.createAgentStatusMessage(stats) });
      } else if (text.includes('help')) {
        await say({ thread_ts: event.ts, ...this.messageBuilder.createHelpMessage() });
      } else {
        await say({ thread_ts: event.ts, ...this.messageBuilder.createDefaultReply() });
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