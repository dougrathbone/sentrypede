import { App, LogLevel, KnownBlock, ButtonAction, BlockAction } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { logger } from '../utils/logger';
import { SlackConfig } from '../config';
import { SentryIssue, SentryEvent } from './sentry';

export interface InteractiveSlackThread {
  issueId: string;
  channelId: string;
  threadTs: string;
  createdAt: Date;
  status: 'new' | 'analyzing' | 'fixing' | 'testing' | 'success' | 'failed' | 'ignored' | 'escalated';
  assignedTo?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  confidenceScore?: number;
  interactionHistory: InteractionEvent[];
}

export interface InteractionEvent {
  timestamp: Date;
  action: string;
  userId: string;
  metadata?: Record<string, any>;
}

export interface DashboardMetrics {
  totalIssues: number;
  resolvedToday: number;
  averageFixTime: number;
  successRate: number;
  topErrorTypes: Array<{ type: string; count: number }>;
  teamActivity: Array<{ userId: string; actions: number }>;
}

export class InteractiveSlackService {
  private app: App;
  private client: WebClient;
  private config: SlackConfig;
  private threads: Map<string, InteractiveSlackThread> = new Map();
  private issueContexts: Map<string, any> = new Map();
  private metrics: DashboardMetrics = {
    totalIssues: 0,
    resolvedToday: 0,
    averageFixTime: 0,
    successRate: 0,
    topErrorTypes: [],
    teamActivity: [],
  };

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
    this.setupInteractiveHandlers();
  }

  async start(): Promise<void> {
    await this.app.start();
    logger.info('Interactive Slack service started');
  }

  async stop(): Promise<void> {
    await this.app.stop();
    logger.info('Interactive Slack service stopped');
  }

  /**
   * Post interactive issue notification with action buttons
   */
  async notifyNewIssue(issue: SentryIssue, event?: SentryEvent): Promise<InteractiveSlackThread> {
    const priority = this.calculatePriority(issue);
    const blocks = this.createInteractiveIssueBlocks(issue, event, priority);
    
    const result = await this.client.chat.postMessage({
      channel: this.config.channelId,
      text: `${this.getPriorityEmoji(priority)} New ${issue.level} in ${issue.project.name}: ${this.truncate(issue.title, 100)}`,
      blocks,
      unfurl_links: false,
    });

    if (!result.ok || !result.ts) {
      throw new Error(`Failed to post message: ${result.error}`);
    }

    const thread: InteractiveSlackThread = {
      issueId: issue.id,
      channelId: this.config.channelId,
      threadTs: result.ts,
      createdAt: new Date(),
      status: 'new',
      priority,
      interactionHistory: [],
    };

    this.threads.set(issue.id, thread);
    this.issueContexts.set(issue.id, { issue, event });
    this.updateMetrics();

    logger.info('Posted interactive issue notification', { 
      issueId: issue.id, 
      threadTs: result.ts,
      priority 
    });
    return thread;
  }

  /**
   * Create interactive issue blocks with action buttons
   */
  private createInteractiveIssueBlocks(
    issue: SentryIssue, 
    event?: SentryEvent,
    priority: string = 'medium'
  ): KnownBlock[] {
    const env = issue.tags?.find(t => t.key === 'environment')?.value || 'unknown';
    const browser = issue.tags?.find(t => t.key === 'browser')?.value;
    
    const summary = [
      `📍 *${issue.project.name}* (${env})`,
      `🔢 ${this.formatNumber(parseInt(issue.count))} occurrences affecting ${this.formatNumber(issue.userCount)} users`,
      `⏱️ First seen ${this.getRelativeTime(new Date(issue.firstSeen))}`,
      `🎯 Priority: *${priority.toUpperCase()}*`,
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

    // Add error location
    if (issue.culprit) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📄 \`${issue.culprit}\``,
        },
      });
    }

    // Add stack trace preview
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

    // Interactive action buttons
    blocks.push(
      {
        type: 'divider',
      },
      {
        type: 'actions',
        block_id: `issue_actions_${issue.id}`,
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '🚀 Fix Now',
            },
            style: 'primary',
            action_id: 'fix_now',
            value: issue.id,
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '🔍 Details',
            },
            action_id: 'show_details',
            value: issue.id,
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '⚠️ Escalate',
            },
            style: 'danger',
            action_id: 'escalate',
            value: issue.id,
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '🙈 Ignore',
            },
            action_id: 'ignore',
            value: issue.id,
          },
        ],
      },
      {
        type: 'actions',
        block_id: `view_actions_${issue.id}`,
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View in Sentry',
            },
            url: issue.permalink,
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '📊 Dashboard',
            },
            action_id: 'show_dashboard',
            value: 'main',
          },
        ],
      }
    );

    return blocks;
  }

  /**
   * Setup interactive handlers for button clicks
   */
  private setupInteractiveHandlers(): void {
    // Handle "Fix Now" button
    this.app.action('fix_now', async ({ ack, body, logger: slackLogger }) => {
      await ack();
      
      const blockAction = body as BlockAction;
      const action = blockAction.actions[0] as ButtonAction;
      const issueId = action.value;
      const userId = blockAction.user.id;
      const channelId = blockAction.channel?.id;
      const messageTs = blockAction.message?.ts;

      if (!channelId || !messageTs || !issueId) {
        slackLogger.error('Missing required data in fix_now action');
        return;
      }

      slackLogger.info(`Fix Now clicked for issue ${issueId} by user ${userId}`);

      await this.handleFixNow(issueId, userId, channelId, messageTs);
    });

    // Handle "Show Details" button
    this.app.action('show_details', async ({ ack, body }) => {
      await ack();
      
      const blockAction = body as BlockAction;
      const action = blockAction.actions[0] as ButtonAction;
      const issueId = action.value;
      const userId = blockAction.user.id;
      const channelId = blockAction.channel?.id;
      const messageTs = blockAction.message?.ts;

      if (!channelId || !messageTs || !issueId) {
        logger.error('Missing required data in show_details action');
        return;
      }

      await this.showIssueDetails(issueId, userId, channelId, messageTs);
    });

    // Handle "Escalate" button
    this.app.action('escalate', async ({ ack, body }) => {
      await ack();
      
      const blockAction = body as BlockAction;
      const action = blockAction.actions[0] as ButtonAction;
      const issueId = action.value;
      const userId = blockAction.user.id;
      const channelId = blockAction.channel?.id;
      const messageTs = blockAction.message?.ts;

      if (!channelId || !messageTs || !issueId) {
        logger.error('Missing required data in escalate action');
        return;
      }

      await this.handleEscalate(issueId, userId, channelId, messageTs);
    });

    // Handle "Ignore" button
    this.app.action('ignore', async ({ ack, body }) => {
      await ack();
      
      const blockAction = body as BlockAction;
      const action = blockAction.actions[0] as ButtonAction;
      const issueId = action.value;
      const userId = blockAction.user.id;
      const channelId = blockAction.channel?.id;
      const messageTs = blockAction.message?.ts;

      if (!channelId || !messageTs || !issueId) {
        logger.error('Missing required data in ignore action');
        return;
      }

      await this.handleIgnore(issueId, userId, channelId, messageTs);
    });

    // Handle "Dashboard" button
    this.app.action('show_dashboard', async ({ ack, body }) => {
      await ack();
      
      const blockAction = body as BlockAction;
      const action = blockAction.actions[0] as ButtonAction;
      const dashboardType = action.value;
      const userId = blockAction.user.id;
      const channelId = blockAction.channel?.id;

      if (!channelId || !dashboardType) {
        logger.error('Missing required data in show_dashboard action');
        return;
      }

      await this.showDashboard(dashboardType, userId, channelId);
    });

    // Handle mentions with enhanced commands
    this.app.event('app_mention', async ({ event, say }) => {
      const text = event.text.toLowerCase();
      
      if (text.includes('dashboard') || text.includes('stats')) {
        if (event.user && event.channel) {
          await this.showDashboard('main', event.user, event.channel);
        }
      } else if (text.includes('status')) {
        await this.showStatus(event.channel, event.ts);
      } else if (text.includes('help')) {
        await this.showHelp(event.channel, event.ts);
      } else {
        await say({
          thread_ts: event.ts,
          text: `👋 Hello! I'm your interactive Sentrypede assistant. Type \`@Sentrypede help\` to see what I can do.`,
        });
      }
    });

    this.app.error(async (error) => {
      logger.error('Interactive Slack app error', { error });
    });
  }

  /**
   * Handle "Fix Now" button click
   */
  private async handleFixNow(issueId: string, userId: string, channelId: string, messageTs: string): Promise<void> {
    const thread = this.threads.get(issueId);
    if (!thread) return;

    // Record interaction
    thread.interactionHistory.push({
      timestamp: new Date(),
      action: 'fix_now',
      userId,
    });

    thread.status = 'analyzing';
    thread.assignedTo = userId;

    // Update the original message to show it's being processed
    await this.updateIssueMessage(issueId, 'Processing your fix request...');

    // Post status update in thread
    await this.client.chat.postMessage({
      channel: channelId,
      thread_ts: messageTs,
      text: `🚀 <@${userId}> initiated automated fix process\n⏳ Analyzing issue and generating solution...`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🚀 <@${userId}> initiated automated fix process\n⏳ Analyzing issue and generating solution...`,
          },
        },
        {
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: `Started at ${new Date().toLocaleTimeString()}`,
          }],
        },
      ],
    });

    logger.info('Fix now initiated', { issueId, userId });
  }

  /**
   * Show detailed issue information
   */
  private async showIssueDetails(issueId: string, userId: string, channelId: string, messageTs: string): Promise<void> {
    const context = this.issueContexts.get(issueId);
    if (!context) return;

    const { issue, event } = context;
    const thread = this.threads.get(issueId);

    // Record interaction
    if (thread) {
      thread.interactionHistory.push({
        timestamp: new Date(),
        action: 'show_details',
        userId,
      });
    }

    const blocks = this.createDetailedIssueBlocks(issue, event, thread);

    await this.client.chat.postMessage({
      channel: channelId,
      thread_ts: messageTs,
      text: '🔍 Detailed Issue Analysis',
      blocks,
    });
  }

  /**
   * Create detailed issue blocks with full information
   */
  private createDetailedIssueBlocks(issue: SentryIssue, event?: SentryEvent, thread?: InteractiveSlackThread): KnownBlock[] {
    const blocks: KnownBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🔍 Detailed Issue Analysis',
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Issue ID:*\n${issue.shortId}`,
          },
          {
            type: 'mrkdwn',
            text: `*Status:*\n${thread?.status || 'Unknown'}`,
          },
          {
            type: 'mrkdwn',
            text: `*Priority:*\n${thread?.priority || 'medium'}`,
          },
          {
            type: 'mrkdwn',
            text: `*Assigned:*\n${thread?.assignedTo ? `<@${thread.assignedTo}>` : 'Unassigned'}`,
          },
        ],
      },
    ];

    // Add error details
    if (event?.entries) {
      const exception = event.entries.find(e => e.type === 'exception');
      if (exception?.data?.values?.[0]) {
        const errorData = exception.data.values[0];
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Error Details:*\n\`\`\`${errorData.type}: ${errorData.value}\`\`\``,
          },
        });

        // Add stack trace
        if (errorData.stacktrace?.frames) {
          const relevantFrames = errorData.stacktrace.frames.slice(-3);
          const stackText = relevantFrames.map((frame: any) => 
            `${frame.filename}:${frame.lineno} in ${frame.function || 'anonymous'}`
          ).join('\n');

          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Stack Trace:*\n\`\`\`${stackText}\`\`\``,
            },
          });
        }
      }
    }

    // Add breadcrumbs if available (extending SentryEvent type for breadcrumbs)
    const eventWithBreadcrumbs = event as any;
    if (eventWithBreadcrumbs?.breadcrumbs && eventWithBreadcrumbs.breadcrumbs.length > 0) {
      const recentCrumbs = eventWithBreadcrumbs.breadcrumbs.slice(-5);
      const breadcrumbText = recentCrumbs.map((crumb: any) => 
        `${crumb.timestamp}: ${crumb.message || crumb.category}`
      ).join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Recent Activity:*\n\`\`\`${breadcrumbText}\`\`\``,
        },
      });
    }

    // Add interaction history
    if (thread?.interactionHistory.length) {
      const historyText = thread.interactionHistory.slice(-3).map(event => 
        `${event.timestamp.toLocaleTimeString()}: ${event.action} by <@${event.userId}>`
      ).join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Recent Actions:*\n${historyText}`,
        },
      });
    }

    return blocks;
  }

  /**
   * Handle escalation
   */
  private async handleEscalate(issueId: string, userId: string, channelId: string, messageTs: string): Promise<void> {
    const thread = this.threads.get(issueId);
    if (!thread) return;

    thread.interactionHistory.push({
      timestamp: new Date(),
      action: 'escalate',
      userId,
    });

    thread.status = 'escalated';
    thread.priority = 'critical';

    await this.updateIssueMessage(issueId, 'Escalated for immediate attention');

    await this.client.chat.postMessage({
      channel: channelId,
      thread_ts: messageTs,
      text: `⚠️ Issue escalated by <@${userId}>`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⚠️ *Issue Escalated* by <@${userId}>\n\n🚨 This issue now requires immediate attention from the engineering team.`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '👥 Assign Team',
              },
              action_id: 'assign_team',
              value: issueId,
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '📞 Create Incident',
              },
              style: 'danger',
              action_id: 'create_incident',
              value: issueId,
            },
          ],
        },
      ],
    });

    logger.info('Issue escalated', { issueId, userId });
  }

  /**
   * Handle ignore action
   */
  private async handleIgnore(issueId: string, userId: string, channelId: string, messageTs: string): Promise<void> {
    const thread = this.threads.get(issueId);
    if (!thread) return;

    thread.interactionHistory.push({
      timestamp: new Date(),
      action: 'ignore',
      userId,
    });

    thread.status = 'ignored';

    await this.updateIssueMessage(issueId, 'Marked as ignored');

    await this.client.chat.postMessage({
      channel: channelId,
      thread_ts: messageTs,
      text: `🙈 Issue ignored by <@${userId}>`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🙈 *Issue Ignored* by <@${userId}>\n\nThis issue will not receive automated fixes. You can still manually address it if needed.`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '🔄 Unignore',
              },
              action_id: 'unignore',
              value: issueId,
            },
          ],
        },
      ],
    });

    logger.info('Issue ignored', { issueId, userId });
  }

  /**
   * Show dashboard with metrics and trends
   */
  async showDashboard(type: string, userId: string, channelId: string): Promise<void> {
    const dashboard = this.generateDashboard();

    await this.client.chat.postMessage({
      channel: channelId,
      text: '📊 Sentrypede Dashboard',
      blocks: dashboard,
    });

    logger.info('Dashboard shown', { type, userId });
  }

  /**
   * Generate dashboard blocks
   */
  private generateDashboard(): KnownBlock[] {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Calculate metrics
    const todayThreads = Array.from(this.threads.values()).filter(t => t.createdAt >= todayStart);
    const successfulFixes = todayThreads.filter(t => t.status === 'success').length;
    const totalToday = todayThreads.length;
    const successRate = totalToday > 0 ? Math.round((successfulFixes / totalToday) * 100) : 0;

    // Status distribution
    const statusCounts = this.getStatusDistribution();
    
    // Priority distribution
    const priorityCounts = this.getPriorityDistribution();

    return [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📊 Sentrypede Dashboard',
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Total Issues Today:*\n${totalToday}`,
          },
          {
            type: 'mrkdwn',
            text: `*Successful Fixes:*\n${successfulFixes}`,
          },
          {
            type: 'mrkdwn',
            text: `*Success Rate:*\n${successRate}%`,
          },
          {
            type: 'mrkdwn',
            text: `*Average Fix Time:*\n${this.calculateAverageFixTime()}min`,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Status Distribution:*\n${this.formatStatusDistribution(statusCounts)}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Priority Breakdown:*\n${this.formatPriorityDistribution(priorityCounts)}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Top Error Types:*\n${this.getTopErrorTypes()}`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '📈 Weekly Report',
            },
            action_id: 'weekly_report',
            value: 'week',
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '🔄 Refresh',
            },
            action_id: 'show_dashboard',
            value: 'main',
          },
        ],
      },
    ];
  }

  /**
   * Update issue message status
   */
  private async updateIssueMessage(issueId: string, status: string): Promise<void> {
    const thread = this.threads.get(issueId);
    if (!thread) return;

    // This would update the original message with current status
    // For now, we'll post a status update
    await this.client.chat.postMessage({
      channel: thread.channelId,
      thread_ts: thread.threadTs,
      text: `${this.getStatusEmoji(status)} ${status}`,
    });
  }

  /**
   * Show current status
   */
  private async showStatus(channelId: string, threadTs?: string): Promise<void> {
    const stats = this.getDetailedStats();
    
    const messageOptions: any = {
      channel: channelId,
      text: '📊 Current Status',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📊 *Current Status*\n• Active issues: ${stats.active}\n• Processing: ${stats.processing}\n• Fixed today: ${stats.fixed}\n• Failed: ${stats.failed}\n• Ignored: ${stats.ignored}`,
          },
        },
      ],
    };

    if (threadTs) {
      messageOptions.thread_ts = threadTs;
    }

    await this.client.chat.postMessage(messageOptions);
  }

  /**
   * Show help information
   */
  private async showHelp(channelId: string, threadTs?: string): Promise<void> {
    const messageOptions: any = {
      channel: channelId,
      text: '🤖 Sentrypede Help',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🤖 *Sentrypede Interactive Assistant*\n\nI monitor Sentry for errors and help fix them automatically!\n\n*Commands:*\n• \`@Sentrypede dashboard\` - Show error dashboard\n• \`@Sentrypede status\` - Current statistics\n• \`@Sentrypede help\` - This message\n\n*Interactive Features:*\n• 🚀 *Fix Now* - Start automated fix\n• 🔍 *Details* - Show full error details\n• ⚠️ *Escalate* - Mark as critical\n• 🙈 *Ignore* - Skip this error\n• 📊 *Dashboard* - View metrics and trends`,
          },
        },
      ],
    };

    if (threadTs) {
      messageOptions.thread_ts = threadTs;
    }

    await this.client.chat.postMessage(messageOptions);
  }

  // Utility methods
  private calculatePriority(issue: SentryIssue): 'low' | 'medium' | 'high' | 'critical' {
    const count = parseInt(issue.count);
    const users = issue.userCount;
    
    if (issue.level === 'fatal' || users > 100 || count > 1000) return 'critical';
    if (issue.level === 'error' && (users > 50 || count > 500)) return 'high';
    if (users > 10 || count > 100) return 'medium';
    return 'low';
  }

  private getPriorityEmoji(priority: string): string {
    const emojis: Record<string, string> = {
      critical: '🚨',
      high: '🔴',
      medium: '🟡',
      low: '🟢',
    };
    return emojis[priority] || '🔵';
  }

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
    if (statusLower.includes('escalat')) return '⚠️';
    if (statusLower.includes('ignor')) return '🙈';
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

  private getDetailedStats() {
    const threads = Array.from(this.threads.values());
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return {
      active: threads.filter(t => ['new', 'analyzing', 'fixing'].includes(t.status)).length,
      processing: threads.filter(t => t.status === 'analyzing').length,
      fixed: threads.filter(t => t.status === 'success' && t.createdAt >= today).length,
      failed: threads.filter(t => t.status === 'failed' && t.createdAt >= today).length,
      ignored: threads.filter(t => t.status === 'ignored').length,
    };
  }

  private getStatusDistribution(): Record<string, number> {
    const threads = Array.from(this.threads.values());
    const distribution: Record<string, number> = {};
    
    threads.forEach(thread => {
      distribution[thread.status] = (distribution[thread.status] || 0) + 1;
    });
    
    return distribution;
  }

  private getPriorityDistribution(): Record<string, number> {
    const threads = Array.from(this.threads.values());
    const distribution: Record<string, number> = {};
    
    threads.forEach(thread => {
      distribution[thread.priority] = (distribution[thread.priority] || 0) + 1;
    });
    
    return distribution;
  }

  private formatStatusDistribution(counts: Record<string, number>): string {
    return Object.entries(counts)
      .map(([status, count]) => `${this.getStatusEmoji(status)} ${status}: ${count}`)
      .join('\n');
  }

  private formatPriorityDistribution(counts: Record<string, number>): string {
    return Object.entries(counts)
      .map(([priority, count]) => `${this.getPriorityEmoji(priority)} ${priority}: ${count}`)
      .join('\n');
  }

  private getTopErrorTypes(): string {
    const contexts = Array.from(this.issueContexts.values());
    const errorTypes: Record<string, number> = {};
    
    contexts.forEach(context => {
      const type = context.issue?.metadata?.type || 'Unknown';
      errorTypes[type] = (errorTypes[type] || 0) + 1;
    });
    
    return Object.entries(errorTypes)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([type, count]) => `• ${type}: ${count}`)
      .join('\n') || '• No errors recorded';
  }

  private calculateAverageFixTime(): number {
    const successfulThreads = Array.from(this.threads.values())
      .filter(t => t.status === 'success');
    
    if (successfulThreads.length === 0) return 0;
    
    const totalTime = successfulThreads.reduce((sum, thread) => {
      const fixTime = thread.interactionHistory.find(h => h.action === 'fix_now');
      const successTime = thread.interactionHistory.find(h => h.action === 'success');
      
      if (fixTime && successTime) {
        return sum + (successTime.timestamp.getTime() - fixTime.timestamp.getTime());
      }
      return sum;
    }, 0);
    
    return Math.round(totalTime / successfulThreads.length / 60000); // Convert to minutes
  }

  private updateMetrics(): void {
    this.metrics.totalIssues = this.threads.size;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    this.metrics.resolvedToday = Array.from(this.threads.values())
      .filter(t => t.status === 'success' && t.createdAt >= today).length;
      
    this.metrics.averageFixTime = this.calculateAverageFixTime();
    
    const totalResolved = Array.from(this.threads.values())
      .filter(t => ['success', 'failed'].includes(t.status)).length;
    
    this.metrics.successRate = totalResolved > 0 
      ? Math.round((this.metrics.resolvedToday / totalResolved) * 100) 
      : 0;
  }

  // Backward compatibility methods
  async notifySuccess(issueId: string, prUrl: string, summary?: string): Promise<void> {
    const thread = this.threads.get(issueId);
    if (!thread) return;

    thread.status = 'success';
    thread.interactionHistory.push({
      timestamp: new Date(),
      action: 'success',
      userId: 'system',
      metadata: { prUrl, summary },
    });

    await this.client.chat.postMessage({
      channel: thread.channelId,
      thread_ts: thread.threadTs,
      text: '✅ Fix created successfully!',
      blocks: [
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
      ],
    });

    this.updateMetrics();
  }

  async notifyFailure(issueId: string, reason: string, suggestions?: string[]): Promise<void> {
    const thread = this.threads.get(issueId);
    if (!thread) return;

    thread.status = 'failed';
    thread.interactionHistory.push({
      timestamp: new Date(),
      action: 'failed',
      userId: 'system',
      metadata: { reason, suggestions },
    });

    await this.client.chat.postMessage({
      channel: thread.channelId,
      thread_ts: thread.threadTs,
      text: '❌ Unable to create automated fix',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ *Unable to create automated fix*\n\n*Reason:* ${reason}${suggestions ? '\n\n*Next steps:*\n' + suggestions.map(s => `• ${s}`).join('\n') : ''}`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '🚀 Retry Fix',
              },
              action_id: 'retry_fix',
              value: issueId,
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '⚠️ Escalate',
              },
              style: 'danger',
              action_id: 'escalate',
              value: issueId,
            },
          ],
        },
      ],
    });

    this.updateMetrics();
  }

  async updateStatus(issueId: string, status: string, details?: string): Promise<void> {
    const thread = this.threads.get(issueId);
    if (!thread) return;

    const emoji = this.getStatusEmoji(status);
    const message = details ? `${emoji} ${status}\n${details}` : `${emoji} ${status}`;

    await this.client.chat.postMessage({
      channel: thread.channelId,
      thread_ts: thread.threadTs,
      text: message,
    });
  }

  getThread(issueId: string): InteractiveSlackThread | undefined {
    return this.threads.get(issueId);
  }

  getMetrics(): DashboardMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }
} 