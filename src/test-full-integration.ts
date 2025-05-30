import { loadConfig } from './config';
import { SentryService } from './services/sentry';
import { SlackService } from './services/slack';
import { GitHubService } from './services/github';
import { GeminiService } from './services/gemini';
import { logger } from './utils/logger';

async function testFullIntegration() {
  logger.info('🚀 Starting Sentrypede Full Integration Test\n');

  try {
    // Load configuration
    const config = loadConfig();
    
    // Initialize services
    logger.info('📦 Initializing services...');
    const sentryService = new SentryService(config.sentry);
    const slackService = new SlackService(config.slack);
    const githubService = new GitHubService(config.github);
    const geminiService = new GeminiService(config.gemini);

    // Test 1: Verify all services are accessible
    logger.info('\n🔍 Test 1: Verifying service connections...');
    
    // Test Sentry
    const sentryConfig = await sentryService.verifyConfiguration();
    if (!sentryConfig.valid) {
      logger.error('❌ Sentry configuration invalid:', sentryConfig.errors);
      return;
    }
    logger.info('✅ Sentry connected');

    // Test GitHub
    const githubRepo = await githubService.getRepository();
    logger.info('✅ GitHub connected:', githubRepo.full_name);

    // Test Gemini
    const geminiConnected = await geminiService.testConnection();
    if (!geminiConnected) {
      logger.error('❌ Gemini connection failed');
      return;
    }
    logger.info('✅ Gemini connected');

    // Test Slack
    await slackService.start();
    logger.info('✅ Slack connected');

    // Test 2: Fetch recent Sentry issues
    logger.info('\n📋 Test 2: Fetching recent Sentry issues...');
    const issues = await sentryService.fetchRecentIssues();
    logger.info(`Found ${issues.length} issues`);

    if (issues.length === 0) {
      logger.warn('No issues found. Creating a demo flow...');
      await runDemoFlow(slackService, githubService, geminiService);
    } else {
      // Process the first unprocessed issue
      const issue = issues.find(i => sentryService.shouldProcessIssue(i));
      
      if (!issue) {
        logger.warn('No unprocessed issues found. Using first issue for demo...');
        const demoIssue = issues[0];
        await processIssue(demoIssue, sentryService, slackService, githubService, geminiService);
      } else {
        logger.info(`\n🐛 Processing issue: ${issue.title}`);
        await processIssue(issue, sentryService, slackService, githubService, geminiService);
      }
    }

    // Cleanup
    await slackService.stop();
    logger.info('\n✨ Integration test completed successfully!');

  } catch (error: any) {
    logger.error('❌ Integration test failed:', error);
    logger.error('Error details:', {
      message: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

async function processIssue(
  issue: any,
  sentryService: SentryService,
  slackService: SlackService,
  githubService: GitHubService,
  geminiService: GeminiService
) {
  try {
    // Step 1: Post to Slack
    logger.info('\n💬 Step 1: Posting to Slack...');
    const thread = await slackService.notifyNewIssue(issue);
    logger.info('Posted to Slack thread:', thread.threadTs);

    // Step 2: Get issue details and event
    logger.info('\n🔍 Step 2: Fetching issue details...');
    await slackService.updateStatus(issue.id, 'Fetching issue details...');
    
    let event = null;
    try {
      event = await sentryService.getLatestEvent(issue.id);
      logger.info('Retrieved event data');
    } catch (error) {
      logger.warn('Could not fetch event data:', error);
    }

    // Step 3: Get code context from GitHub
    logger.info('\n📂 Step 3: Getting code context from GitHub...');
    await slackService.updateStatus(issue.id, 'Analyzing code in repository...');
    
    const codeContext: { [key: string]: string } = {};
    
    // Try to get the file mentioned in the error
    if (issue.culprit) {
      const filePath = extractFilePath(issue.culprit);
      if (filePath) {
        logger.info(`Attempting to fetch: ${filePath}`);
        const content = await githubService.getFileContent(filePath);
        if (content) {
          codeContext[filePath] = content;
          logger.info(`Retrieved ${filePath} (${content.length} chars)`);
        } else {
          logger.warn(`File not found: ${filePath}`);
        }
      }
    }

    // Step 4: Analyze with Gemini
    logger.info('\n🤖 Step 4: Analyzing with Gemini AI...');
    await slackService.updateStatus(issue.id, 'Analyzing error with AI...');
    
    const fixResult = await geminiService.analyzeAndFix(issue, event, codeContext);
    
    logger.info('Analysis complete:', {
      summary: fixResult.analysis.summary,
      confidence: fixResult.analysis.confidence,
      affectedFiles: fixResult.analysis.affectedFiles,
      fixesGenerated: fixResult.fixes.length,
    });

    // Post analysis to Slack
    await slackService.postAnalysis(issue.id, {
      summary: fixResult.analysis.summary,
      cause: fixResult.analysis.rootCause,
      suggestion: fixResult.analysis.suggestedFix,
      confidence: fixResult.analysis.confidence,
    });

    // Step 5: Create GitHub PR if we have fixes
    if (fixResult.fixes.length > 0 && fixResult.analysis.confidence > 0.5) {
      logger.info('\n🔧 Step 5: Creating GitHub pull request...');
      await slackService.updateStatus(issue.id, 'Creating pull request with fix...');
      
      try {
        // Convert fixes to GitHub format
        const githubFiles = fixResult.fixes.map(fix => ({
          path: fix.filePath,
          content: fix.fixedCode,
        }));

        // Create the PR
        const pr = await githubService.createFixForIssue(
          issue.id,
          issue.title,
          githubFiles
        );

        logger.info('✅ Pull request created:', pr.html_url);
        
        // Update PR description with AI analysis
        await githubService.createPullRequestComment(
          pr.number,
          fixResult.pullRequestDescription
        );

        // Notify Slack of success
        await slackService.notifySuccess(
          issue.id,
          pr.html_url,
          fixResult.analysis.summary
        );

        // Add test code as a comment if available
        if (fixResult.testCode) {
          await githubService.createPullRequestComment(
            pr.number,
            `## 🧪 Suggested Test Code\n\n\`\`\`javascript\n${fixResult.testCode}\n\`\`\``
          );
        }

      } catch (error: any) {
        logger.error('Failed to create PR:', error);
        await slackService.notifyFailure(
          issue.id,
          `Failed to create pull request: ${error.message}`,
          ['Check GitHub permissions', 'Verify repository access']
        );
      }
    } else {
      logger.info('\n⚠️  No automated fix generated');
      await slackService.notifyFailure(
        issue.id,
        fixResult.analysis.confidence <= 0.5 
          ? 'Low confidence in automated fix'
          : 'No code changes needed',
        [
          'Manual investigation recommended',
          `AI confidence: ${Math.round(fixResult.analysis.confidence * 100)}%`,
          fixResult.analysis.explanation,
        ]
      );
    }

    // Mark as processed
    sentryService.markAsProcessed(issue.id);

  } catch (error: any) {
    logger.error('Error processing issue:', error);
    await slackService.notifyFailure(
      issue.id,
      `Processing failed: ${error.message}`,
      ['Check logs for details']
    );
  }
}

async function runDemoFlow(
  slackService: SlackService,
  githubService: GitHubService,
  geminiService: GeminiService
) {
  logger.info('\n🎭 Running demo flow with mock data...');
  
  // Create a mock issue
  const mockIssue = {
    id: 'demo-' + Date.now(),
    title: 'TypeError: Cannot read property \'name\' of undefined',
    culprit: 'src/utils/user.js in getUserDisplayName',
    permalink: 'https://sentry.io/demo',
    shortId: 'DEMO-1',
    status: 'unresolved',
    level: 'error',
    count: '42',
    userCount: 10,
    firstSeen: new Date(Date.now() - 3600000).toISOString(),
    lastSeen: new Date().toISOString(),
    project: {
      id: 'demo',
      name: 'Demo Project',
      slug: 'demo-project',
    },
    metadata: {
      type: 'TypeError',
      value: 'Cannot read property \'name\' of undefined',
    },
    tags: [
      { key: 'environment', value: 'production' },
      { key: 'browser', value: 'Chrome 120' },
    ],
  };

  // Create mock code
  const mockCode = {
    'src/utils/user.js': `export function getUserDisplayName(user) {
  return user.name || user.email;
}

export function formatUserGreeting(user) {
  const name = getUserDisplayName(user);
  return \`Hello, \${name}!\`;
}`,
  };

  // Post to Slack
  const thread = await slackService.notifyNewIssue(mockIssue);
  logger.info('Demo issue posted to Slack');

  // Analyze with Gemini
  await slackService.updateStatus(mockIssue.id, 'Analyzing demo issue...');
  const fixResult = await geminiService.analyzeAndFix(mockIssue, null, mockCode);
  
  // Post analysis
  await slackService.postAnalysis(mockIssue.id, {
    summary: fixResult.analysis.summary,
    cause: fixResult.analysis.rootCause,
    suggestion: fixResult.analysis.suggestedFix,
    confidence: fixResult.analysis.confidence,
  });

  logger.info('Demo analysis complete:', {
    confidence: fixResult.analysis.confidence,
    fixesGenerated: fixResult.fixes.length,
  });

  // Show what would happen
  if (fixResult.fixes.length > 0) {
    logger.info('\n📝 Demo: Would create PR with these changes:');
    fixResult.fixes.forEach(fix => {
      logger.info(`\nFile: ${fix.filePath}`);
      logger.info('Changes:', fix.changes);
    });
  }

  await slackService.updateStatus(
    mockIssue.id,
    '✅ Demo completed - no real PR created'
  );
}

function extractFilePath(culprit: string): string | null {
  // Extract file path from Sentry culprit string
  // Examples: 
  // - "app.js in handleUser"
  // - "/src/utils/user.js in getUserName at line 42"
  const match = culprit.match(/^([^\s]+)\s+in\s+/);
  return match ? match[1] : null;
}

// Run the integration test
testFullIntegration().catch((error) => {
  logger.error('Unexpected error:', error);
  process.exit(1);
}); 