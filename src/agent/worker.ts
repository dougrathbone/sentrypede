import cron from 'node-cron';
import { logger } from '../utils/logger';
import { AppConfig } from '../config';
import { SentryService, SentryIssue } from '../services/sentry';
import { SlackService } from '../services/slack';
import { SentryServiceFactory, SentryServiceWithOAuth } from '../services/sentry-factory';
import { SentryOAuthService } from '../services/sentry-oauth';

export interface WorkerStats {
  startTime: Date;
  issuesProcessed: number;
  issuesFixed: number;
  issuesFailed: number;
  lastPollTime?: Date;
  isRunning: boolean;
}

export class SentryAgent {
  private config: AppConfig;
  private sentryService!: SentryService;
  private sentryOAuthService: SentryOAuthService | undefined;
  private slackService: SlackService;
  private cronJob?: cron.ScheduledTask;
  private stats: WorkerStats;
  private isShuttingDown = false;
  private sentryServiceWrapper?: SentryServiceWithOAuth;

  constructor(config: AppConfig) {
    this.config = config;
    this.slackService = new SlackService(config.slack);
    
    this.stats = {
      startTime: new Date(),
      issuesProcessed: 0,
      issuesFixed: 0,
      issuesFailed: 0,
      isRunning: false,
    };

    // Setup graceful shutdown
    this.setupGracefulShutdown();
  }

  /**
   * Start the agent worker
   */
  async start(): Promise<void> {
    try {
      logger.info('Starting Sentrypede agent...', {
        pollInterval: this.config.sentry.pollIntervalMs,
        projects: this.config.sentry.projectSlugs,
        environments: this.config.sentry.environments,
        useOAuth: !!this.config.sentry.oauth,
      });

      // Create Sentry service with OAuth support if configured
      this.sentryServiceWrapper = await SentryServiceFactory.create(this.config.sentry);
      this.sentryService = this.sentryServiceWrapper.service;
      this.sentryOAuthService = this.sentryServiceWrapper.oauthService;

      // If OAuth is configured but not authorized, log the authorization URL
      if (this.sentryServiceWrapper.isAuthorized && !this.sentryServiceWrapper.isAuthorized()) {
        const authUrl = this.sentryServiceWrapper.getAuthorizationUrl?.();
        if (authUrl) {
          logger.warn('Sentry OAuth authorization required', {
            authorizationUrl: authUrl,
            message: 'Please visit the authorization URL to complete OAuth setup',
          });
          
          // Post to Slack about OAuth requirement
          await this.slackService.start();
          await this.postOAuthNotification(authUrl);
          
          // Wait for authorization (with timeout)
          await this.waitForOAuthAuthorization();
        }
      }

      // Start Slack service
      await this.slackService.start();

      // Schedule the monitoring job
      const cronExpression = this.getCronExpression();
      this.cronJob = cron.schedule(cronExpression, async () => {
        if (!this.isShuttingDown) {
          await this.pollSentryIssues();
        }
      }, {
        scheduled: false, // Don't start immediately
      });

      // Start the cron job
      this.cronJob.start();
      this.stats.isRunning = true;

      // Run initial poll
      await this.pollSentryIssues();

      logger.info('Sentrypede agent started successfully', {
        cronExpression,
      });

    } catch (error) {
      logger.error('Failed to start Sentrypede agent', { error });
      throw error;
    }
  }

  /**
   * Stop the agent worker
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping Sentrypede agent...');
      this.isShuttingDown = true;

      // Stop cron job
      if (this.cronJob) {
        this.cronJob.stop();
      }

      // Stop OAuth service if present
      if (this.sentryOAuthService) {
        await this.sentryOAuthService.stop();
      }

      // Stop Slack service
      await this.slackService.stop();

      this.stats.isRunning = false;
      logger.info('Sentrypede agent stopped successfully');

    } catch (error) {
      logger.error('Failed to stop Sentrypede agent', { error });
      throw error;
    }
  }

  /**
   * Get current worker statistics
   */
  getStats(): WorkerStats {
    return { ...this.stats };
  }

  /**
   * Poll Sentry for new issues
   */
  private async pollSentryIssues(): Promise<void> {
    try {
      logger.debug('Polling Sentry for new issues...');
      this.stats.lastPollTime = new Date();

      const issues = await this.sentryService.fetchRecentIssues();
      logger.info('Fetched Sentry issues', { count: issues.length });

      // Process each issue
      for (const issue of issues) {
        if (this.isShuttingDown) {
          break;
        }

        if (this.sentryService.shouldProcessIssue(issue)) {
          await this.processIssue(issue);
        } else {
          logger.debug('Skipping issue', {
            issueId: issue.id,
            reason: 'Already processed or filtered out',
          });
        }
      }

    } catch (error) {
      logger.error('Failed to poll Sentry issues', { error });
    }
  }

  /**
   * Process a single Sentry issue
   */
  private async processIssue(issue: SentryIssue): Promise<void> {
    try {
      logger.info('Processing Sentry issue', {
        issueId: issue.id,
        title: issue.title,
        level: issue.level,
      });

      this.stats.issuesProcessed++;

      // Mark as processed to avoid duplicate processing
      this.sentryService.markAsProcessed(issue.id);

      // Post initial Slack notification
      const thread = await this.slackService.postIssueNotification(issue);
      logger.info('Posted Slack notification', {
        issueId: issue.id,
        threadTs: thread.threadTs,
      });

      // Post processing started message
      await this.slackService.postProcessingStarted(issue.id);

      // TODO: In the next phase, we'll add:
      // 1. Fetch detailed issue information and stack trace
      // 2. Use AI (Gemini) to analyze and generate fix
      // 3. Create GitHub branch and apply fix
      // 4. Generate and run tests
      // 5. Create pull request
      // 6. Post success/failure message to Slack

      // For now, simulate processing delay
      await this.simulateProcessing(issue);

    } catch (error) {
      logger.error('Failed to process issue', {
        issueId: issue.id,
        error,
      });

      this.stats.issuesFailed++;

      // Try to post failure message to Slack
      try {
        await this.slackService.postFixFailure(
          issue.id,
          'Internal processing error',
          issue.permalink
        );
      } catch (slackError) {
        logger.error('Failed to post failure message to Slack', { slackError });
      }
    }
  }

  /**
   * Simulate processing for demonstration (will be replaced with actual AI processing)
   */
  private async simulateProcessing(issue: SentryIssue): Promise<void> {
    // Simulate some processing time
    await new Promise(resolve => setTimeout(resolve, 2000));

    // For demonstration, randomly succeed or fail
    const shouldSucceed = Math.random() > 0.3; // 70% success rate

    if (shouldSucceed) {
      this.stats.issuesFixed++;
      
      // Simulate a GitHub PR URL
      const prUrl = `https://github.com/${this.config.github.owner}/${this.config.github.repo}/pull/123`;
      
      await this.slackService.postFixSuccess(issue.id, prUrl);
      
      logger.info('Simulated successful fix', {
        issueId: issue.id,
        pullRequestUrl: prUrl,
      });
    } else {
      this.stats.issuesFailed++;
      
      await this.slackService.postFixFailure(
        issue.id,
        'Unable to generate a suitable fix for this error type',
        issue.permalink
      );
      
      logger.info('Simulated failed fix', {
        issueId: issue.id,
      });
    }
  }

  /**
   * Convert poll interval to cron expression
   */
  private getCronExpression(): string {
    const intervalMinutes = Math.floor(this.config.sentry.pollIntervalMs / 60000);
    
    if (intervalMinutes < 1) {
      // For very short intervals, use every minute
      return '* * * * *';
    } else if (intervalMinutes === 1) {
      return '* * * * *'; // Every minute
    } else if (intervalMinutes < 60) {
      return `*/${intervalMinutes} * * * *`; // Every N minutes
    } else {
      const hours = Math.floor(intervalMinutes / 60);
      return `0 */${hours} * * *`; // Every N hours
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', { error });
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error });
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', { reason, promise });
      shutdown('unhandledRejection');
    });
  }

  /**
   * Post OAuth notification to Slack
   */
  private async postOAuthNotification(authUrl: string): Promise<void> {
    try {
      await this.slackService.postMessage(
        '🔐 Sentry OAuth Authorization Required',
        [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '🔐 Sentry OAuth Authorization Required',
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'Sentrypede needs authorization to access your Sentry organization. Please click the button below to complete the OAuth setup.',
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Authorize Sentrypede',
                },
                url: authUrl,
                style: 'primary',
              },
            ],
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: 'This authorization is required to monitor and process Sentry issues.',
              },
            ],
          },
        ]
      );
    } catch (error) {
      logger.error('Failed to post OAuth notification to Slack', { error });
    }
  }

  /**
   * Wait for OAuth authorization with timeout
   */
  private async waitForOAuthAuthorization(timeoutMs: number = 300000): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 5000; // Check every 5 seconds

    while (!this.isShuttingDown) {
      if (this.sentryServiceWrapper?.isAuthorized?.()) {
        logger.info('Sentry OAuth authorization completed successfully');
        
        // Post success message to Slack
        try {
          await this.slackService.postMessage(
            '✅ Sentry OAuth authorization completed successfully! Sentrypede is now monitoring for issues.'
          );
        } catch (error) {
          logger.error('Failed to post OAuth success message', { error });
        }
        
        return;
      }

      if (Date.now() - startTime > timeoutMs) {
        throw new Error('OAuth authorization timeout - please complete authorization and restart the agent');
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }
} 