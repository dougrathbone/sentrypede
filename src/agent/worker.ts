import cron from 'node-cron';
import { logger } from '../utils/logger';
import { AppConfig } from '../config';
import { SentryService, SentryIssue } from '../services/sentry';
import { SlackService } from '../services/slack';
import { SentryServiceFactory, SentryServiceWithOAuth } from '../services/sentry-factory';
import { SentryOAuthService } from '../services/sentry-oauth';
import { GeminiService } from '../services/gemini';
import { SourceFileRetrievalService } from '../services/source-file-retrieval';
import { FileCache } from '../services/file-cache';

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
  private geminiService: GeminiService;
  private sourceFileService: SourceFileRetrievalService;
  private fileCache: FileCache;
  private cronJob?: cron.ScheduledTask;
  private stats: WorkerStats;
  private isShuttingDown = false;
  private sentryServiceWrapper?: SentryServiceWithOAuth;

  constructor(config: AppConfig) {
    this.config = config;
    this.slackService = new SlackService(config.slack);
    this.geminiService = new GeminiService(config.gemini);
    
    // Initialize file cache and source file service
    this.fileCache = new FileCache({
      maxSizeBytes: 100 * 1024 * 1024, // 100MB
      maxEntries: 1000,
      ttlMs: 60 * 60 * 1000, // 1 hour
    });
    this.sourceFileService = new SourceFileRetrievalService(config.github, this.fileCache);
    
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
      const thread = await this.slackService.notifyNewIssue(issue);
      logger.info('Posted Slack notification', {
        issueId: issue.id,
        threadTs: thread.threadTs,
      });

      // Post processing started message
      await this.slackService.updateStatus(issue.id, 'Starting analysis...');

      // Enhanced AI processing with source debugging
      await this.performEnhancedAnalysis(issue);

    } catch (error) {
      logger.error('Failed to process issue', {
        issueId: issue.id,
        error,
      });

      this.stats.issuesFailed++;

      // Try to post failure message to Slack
      try {
        await this.slackService.notifyFailure(
          issue.id,
          'Internal processing error',
          ['Check logs for details', 'Restart the service if needed']
        );
      } catch (slackError) {
        logger.error('Failed to post failure message to Slack', { slackError });
      }
    }
  }

  /**
   * Perform enhanced AI analysis with source code context
   */
  private async performEnhancedAnalysis(issue: SentryIssue): Promise<void> {
    try {
      logger.info('Starting enhanced AI analysis', { issueId: issue.id });

      // Step 1: Fetch detailed event information
      await this.slackService.updateStatus(issue.id, 'Fetching detailed error information...');
      let event = null;
      try {
        event = await this.sentryService.getLatestEvent(issue.id);
        logger.info('Retrieved detailed event data', { issueId: issue.id });
      } catch (error) {
        logger.warn('Could not fetch detailed event data', { issueId: issue.id, error });
      }

      // Step 2: Create source analysis context  
      await this.slackService.updateStatus(issue.id, 'Analyzing source code context...');
      let sourceContext = null;
      if (event) {
        try {
          sourceContext = await this.sourceFileService.createAnalysisContext(event);
          if (sourceContext) {
            logger.info('Created source analysis context', {
              issueId: issue.id,
              primaryFile: sourceContext.primaryFile.filePath,
              relatedFiles: sourceContext.relatedFiles.length,
              language: sourceContext.primaryFile.fileInfo.language,
            });
          }
        } catch (error) {
          logger.warn('Could not create source analysis context', { issueId: issue.id, error });
        }
      }

      // Step 3: Perform AI analysis
      await this.slackService.updateStatus(issue.id, 'Performing AI analysis...');
      
      if (sourceContext) {
        // Enhanced analysis with source code
        const enhancedAnalysisResult = await this.performSourceCodeAnalysis(issue, sourceContext);
        await this.postEnhancedAnalysisToSlack(issue, enhancedAnalysisResult);

        // Now, attempt to generate fixes based on this enhanced analysis
        if (enhancedAnalysisResult && enhancedAnalysisResult.analysis && enhancedAnalysisResult.analysis.affectedFiles && enhancedAnalysisResult.analysis.affectedFiles.length > 0) {
          await this.slackService.updateStatus(issue.id, 'Attempting to generate code fixes...');
          logger.info('Attempting to generate fixes for AI analysis', { 
            issueId: issue.id, 
            affectedFiles: enhancedAnalysisResult.analysis.affectedFiles 
          });

          const codeContextMap = await this.sourceFileService.fetchMultipleFiles(
            enhancedAnalysisResult.analysis.affectedFiles,
            sourceContext.repositoryInfo.commitSha
          );

          const codeContext: { [filePath: string]: string } = {};
          for (const [key, value] of codeContextMap.entries()) {
            codeContext[key] = value;
          }

          if (Object.keys(codeContext).length > 0) {
            try {
              const fixes = await this.geminiService.generateFixes(
                issue, 
                event, // event might be null, generateFixes handles this
                enhancedAnalysisResult.analysis, // Pass the rich analysis object
                codeContext
              );

              if (fixes && fixes.length > 0) {
                logger.info('Successfully generated code fixes', { issueId: issue.id, fixCount: fixes.length, fixes });
                await this.slackService.updateStatus(issue.id, `Successfully generated ${fixes.length} potential fix(es).`);
                // TODO: Next steps - PR creation, etc.
                this.stats.issuesFixed++; // Increment if we consider fix generation a success for now
              } else {
                logger.info('No fixes generated by AI', { issueId: issue.id });
                await this.slackService.updateStatus(issue.id, 'AI analysis complete, but no specific code fixes were generated.');
              }
            } catch (fixError) {
              logger.error('Failed to generate code fixes', { issueId: issue.id, error: fixError });
              await this.slackService.updateStatus(issue.id, 'Error during code fix generation.');
            }
          } else {
            logger.warn('Could not retrieve code context for any affected files. Skipping fix generation.', { issueId: issue.id, affectedFiles: enhancedAnalysisResult.analysis.affectedFiles });
            await this.slackService.updateStatus(issue.id, 'Analysis complete, but could not retrieve source code for fix generation.');
          }
        } else {
          logger.info('No affected files identified by AI analysis, or analysis failed. Skipping fix generation.', { issueId: issue.id });
        }
        
        logger.info('Enhanced AI analysis completed successfully', { 
          issueId: issue.id,
          hasSourceCode: true 
        });
      } else {
        // Basic analysis without source code
        const basicAnalysis = await this.performBasicAnalysis(issue, event);
        await this.postBasicAnalysisToSlack(issue, basicAnalysis);
        // We might still attempt fixes based on basic analysis if it identifies affected files
        // For now, basic analysis doesn't provide structured affectedFiles, so we skip fix generation here.
        logger.info('Basic AI analysis completed, no source code for automated fixes.', { 
          issueId: issue.id,
          hasSourceCode: false 
        });
        // this.stats.issuesFixed++; // Only count as fixed if actual fixes are applied or PRs created
      }

      // Display cache statistics
      const cacheStats = this.sourceFileService.getCacheStats();
      logger.debug('Source file cache statistics', {
        totalEntries: cacheStats.totalEntries,
        totalSizeKB: Math.round(cacheStats.totalSizeBytes / 1024),
        hitRate: Math.round(cacheStats.hitRate * 100) + '%',
      });

    } catch (error) {
      logger.error('Enhanced analysis failed', { issueId: issue.id, error });
      
      // Post failure message
      await this.slackService.notifyFailure(
        issue.id,
        `AI analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ['Review error logs', 'Check AI service connection', 'Verify GitHub access']
      );
      
      this.stats.issuesFailed++;
    }
  }

  /**
   * Perform AI analysis with source code context
   */
  private async performSourceCodeAnalysis(issue: SentryIssue, sourceContext: any): Promise<any> {
    const errorLines = sourceContext.primaryFile.contextLines.lines
      .map((line: any) => 
        `${line.number.toString().padStart(3)}: ${line.isErrorLine ? '>>> ' : '    '}${line.content}`
      )
      .join('\n');

    // Build comprehensive analysis prompt
    const analysisPrompt = `Analyze this production error with actual source code context and provide specific, actionable fix recommendations.

**Error Details:**
- Title: ${issue.title}
- Type: ${issue.metadata?.type || 'Unknown'}
- Occurrences: ${issue.count} times
- Users Affected: ${issue.userCount}
- Platform: ${sourceContext.primaryFile.fileInfo.language}
- File: ${sourceContext.primaryFile.filePath}
- Environment: ${issue.tags?.find((t: any) => t.key === 'environment')?.value || 'unknown'}

**Source Code Context (line ${sourceContext.primaryFile.errorLocation?.line || 'unknown'}):**
\`\`\`${sourceContext.primaryFile.fileInfo.language}
${errorLines}
\`\`\`

**Related Files in Stack Trace:**
${sourceContext.relatedFiles.map((file: any) => `- ${file.filePath} (${file.fileInfo.language})`).join('\n')}

**Repository Info:**
- Owner: ${sourceContext.repositoryInfo.owner}
- Repo: ${sourceContext.repositoryInfo.repo}
- Commit: ${sourceContext.repositoryInfo.commitSha.substring(0, 12)}

Please provide a detailed JSON response with the following structure:
{
  "rootCause": "Specific technical explanation based on the actual code",
  "fixRecommendation": "Concrete code changes or patterns to implement",
  "codeExample": "Actual code snippet showing the fix (if applicable)",
  "confidenceScore": "8/10",
  "riskLevel": "Low|Medium|High with explanation",
  "testingGuidance": "Specific test cases to verify the fix",
  "preventionTips": "How to prevent similar issues in the future",
  "additionalContext": "Any patterns or dependencies noticed in the code"
}

Focus on the actual source code provided and give specific, implementable recommendations.`;

    // Send to Gemini for analysis
    const model = (this.geminiService as any).model;
    const aiResult = await model.generateContent(analysisPrompt);
    const response = await aiResult.response;
    const aiText = response.text();

    logger.info('Received AI analysis response', {
      responseLength: aiText.length,
      issueId: issue.id
    });

    // Parse AI response
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          type: 'enhanced',
          sourceContext,
          analysis: parsed,
          errorLines
        };
      }
    } catch (parseError) {
      logger.warn('Failed to parse AI response as JSON', { issueId: issue.id });
    }

    // Fallback parsing
    return {
      type: 'enhanced',
      sourceContext,
      analysis: {
        rootCause: this.extractSection(aiText, 'Root Cause') || 'AI analysis indicates a production error requiring investigation',
        fixRecommendation: this.extractSection(aiText, 'Fix') || 'Review the code context and implement proper error handling',
        codeExample: this.extractCodeBlock(aiText) || null,
        confidenceScore: '7/10',
        riskLevel: 'Medium - requires careful testing',
        testingGuidance: 'Create unit tests that reproduce the error condition',
        preventionTips: 'Add type checking and defensive programming practices',
        additionalContext: aiText.substring(0, 300) + '...'
      },
      errorLines
    };
  }

  /**
   * Perform basic AI analysis without source code
   */
  private async performBasicAnalysis(issue: SentryIssue, event: any): Promise<any> {
    const environment = issue.tags?.find((t: any) => t.key === 'environment')?.value || 'unknown';
    
    const analysisPrompt = `Analyze this production error and provide guidance for investigation.

**Error Details:**
- Title: ${issue.title}
- Type: ${issue.metadata?.type || 'Unknown'}
- Occurrences: ${issue.count} times
- Users Affected: ${issue.userCount}
- Environment: ${environment}
- Platform: ${event?.platform || 'unknown'}

Provide practical recommendations for investigating and fixing this error, including:
- Likely root causes
- Investigation steps
- Common fixes for this error type
- Prevention strategies

Keep the response focused and actionable.`;

    const model = (this.geminiService as any).model;
    const aiResult = await model.generateContent(analysisPrompt);
    const response = await aiResult.response;
    const aiText = response.text();

    return {
      type: 'basic',
      analysis: aiText,
      environment
    };
  }

  /**
   * Post enhanced analysis results to Slack
   */
  private async postEnhancedAnalysisToSlack(issue: SentryIssue, analysis: any): Promise<void> {
    const formattedAnalysis = this.formatEnhancedAnalysis(analysis.analysis);
    const codeBlock = '```';
    
    const message = `🎯 **Enhanced AI Source Debugger Analysis** ✨

**🐛 Error Details:**
• **Title:** ${issue.title}
• **Type:** ${issue.metadata?.type || 'Unknown'}
• **Occurrences:** ${issue.count} times
• **Users Affected:** ${issue.userCount}
• **Sentry Link:** ${issue.permalink}

**📁 Source Context:**
• **Repository:** ${analysis.sourceContext.repositoryInfo.owner}/${analysis.sourceContext.repositoryInfo.repo}
• **Commit:** \`${analysis.sourceContext.repositoryInfo.commitSha.substring(0, 12)}\`
• **Primary File:** \`${analysis.sourceContext.primaryFile.filePath}\` (${analysis.sourceContext.primaryFile.fileInfo.language})
• **Error Location:** Line ${analysis.sourceContext.primaryFile.errorLocation?.line || 'unknown'}
• **Related Files:** ${analysis.sourceContext.relatedFiles.length} additional files analyzed

**💻 Code Context:**
${codeBlock}${analysis.sourceContext.primaryFile.fileInfo.language}
${analysis.errorLines}
${codeBlock}

**🤖 AI Analysis Results:**
${formattedAnalysis}

**📊 Related Files:**
${analysis.sourceContext.relatedFiles.map((file: any) => `• \`${file.filePath}\` (${file.fileInfo.language})`).join('\n')}

---
*🚀 Powered by Sentrypede Source Debugger - Production Ready*
*🧠 Enhanced with Google Gemini AI for intelligent code analysis*`;

    await this.slackService.postMessage(message);
  }

  /**
   * Post basic analysis results to Slack
   */
  private async postBasicAnalysisToSlack(issue: SentryIssue, analysis: any): Promise<void> {
    const message = `🔍 **AI Error Analysis** (No Source Code Available)

**🐛 Error Details:**
• **Title:** ${issue.title}
• **Type:** ${issue.metadata?.type || 'Unknown'}
• **Occurrences:** ${issue.count} times
• **Users Affected:** ${issue.userCount}
• **Environment:** ${analysis.environment}
• **Sentry Link:** ${issue.permalink}

**🤖 AI Analysis:**
${analysis.analysis}

**💡 Note:** This is basic analysis without source code context. For enhanced debugging with actual code analysis, ensure errors have unmapped stack traces pointing to repository files.

---
*🚀 Powered by Sentrypede Source Debugger*
*🧠 AI-assisted error analysis by Google Gemini*`;

    await this.slackService.postMessage(message);
  }

  /**
   * Format enhanced AI analysis for display
   */
  private formatEnhancedAnalysis(analysis: any): string {
    let formatted = '';

    if (analysis.rootCause) {
      formatted += `**🔍 Root Cause Analysis:**\n${analysis.rootCause}\n\n`;
    }

    if (analysis.fixRecommendation) {
      formatted += `**💡 Fix Recommendation:**\n${analysis.fixRecommendation}\n\n`;
    }

    if (analysis.codeExample) {
      formatted += `**📝 Code Example:**\n\`\`\`javascript\n${analysis.codeExample}\n\`\`\`\n\n`;
    }

    if (analysis.confidenceScore) {
      formatted += `**🎯 Confidence:** ${analysis.confidenceScore}\n\n`;
    }

    if (analysis.riskLevel) {
      formatted += `**⚠️ Risk Level:** ${analysis.riskLevel}\n\n`;
    }

    if (analysis.testingGuidance) {
      formatted += `**🧪 Testing Guidance:**\n${analysis.testingGuidance}\n\n`;
    }

    if (analysis.preventionTips) {
      formatted += `**🛡️ Prevention Tips:**\n${analysis.preventionTips}\n\n`;
    }

    if (analysis.additionalContext) {
      formatted += `**📋 Additional Context:**\n${analysis.additionalContext}`;
    }

    return formatted || 'Analysis completed - please review the error details and source code context.';
  }

  /**
   * Extract section from AI response text
   */
  private extractSection(text: string, sectionName: string): string | null {
    const patterns = [
      new RegExp(`\\*\\*${sectionName}[^*]*\\*\\*:?\\s*([^*]+)`, 'i'),
      new RegExp(`${sectionName}:?\\s*([^\\n]+)`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return null;
  }

  /**
   * Extract code block from AI response
   */
  private extractCodeBlock(text: string): string | null {
    const codeBlockMatch = text.match(/```(?:javascript|js|typescript|ts)?\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }
    return null;
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
    // Skip setting up process listeners in test environment
    if (process.env.NODE_ENV === 'test') {
      return;
    }

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