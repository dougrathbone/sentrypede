import { logger } from './utils/logger';

// Mock implementations for demo purposes
interface MockService {
  name: string;
  connected: boolean;
  testConnection(): Promise<boolean>;
}

class MockSentryService implements MockService {
  name = 'Sentry';
  connected = true;

  async testConnection(): Promise<boolean> {
    logger.info('🔍 Testing Sentry connection...');
    await this.delay(1000);
    logger.info('✅ Sentry connected - found demo organization');
    return true;
  }

  async fetchIssues() {
    logger.info('📋 Fetching recent Sentry issues...');
    await this.delay(1500);
    
    const mockIssues = [
      {
        id: 'DEMO-001',
        title: 'TypeError: Cannot read property \'name\' of undefined',
        culprit: 'src/utils/user.js in getUserDisplayName',
        count: '127',
        userCount: 23,
        level: 'error',
        firstSeen: new Date(Date.now() - 86400000).toISOString(),
        lastSeen: new Date().toISOString(),
        project: { name: 'Demo App', slug: 'demo-app' },
        metadata: { type: 'TypeError', value: 'Cannot read property \'name\' of undefined' },
      }
    ];

    logger.info(`Found ${mockIssues.length} unresolved issues`);
    return mockIssues;
  }

  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class MockSlackService implements MockService {
  name = 'Slack';
  connected = true;

  async testConnection(): Promise<boolean> {
    logger.info('💬 Testing Slack connection...');
    await this.delay(800);
    logger.info('✅ Slack connected - #bugs-alerts channel ready');
    return true;
  }

  async postIssue(issue: any) {
    logger.info(`📨 Posting issue to Slack: ${issue.title}`);
    await this.delay(500);
    logger.info('✅ Issue posted to #bugs-alerts thread');
    return { threadTs: '1234567890.123456' };
  }

  async updateStatus(_issueId: string, status: string) {
    logger.info(`🔄 Updating status: ${status}`);
    await this.delay(300);
  }

  async postAnalysis(_issueId: string, analysis: any) {
    logger.info('📊 Posting AI analysis to Slack thread:');
    logger.info(`   Summary: ${analysis.summary}`);
    logger.info(`   Confidence: ${Math.round(analysis.confidence * 100)}%`);
    await this.delay(500);
  }

  async notifySuccess(_issueId: string, prUrl: string, summary: string) {
    logger.info(`✅ Success notification sent to Slack:`);
    logger.info(`   Pull Request: ${prUrl}`);
    logger.info(`   Summary: ${summary}`);
    await this.delay(300);
  }

  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class MockGitHubService implements MockService {
  name = 'GitHub';
  connected = true;

  async testConnection(): Promise<boolean> {
    logger.info('🐙 Testing GitHub connection...');
    await this.delay(1200);
    logger.info('✅ GitHub connected - dovetail/sentrypede repository accessible');
    return true;
  }

  async getFileContent(filePath: string) {
    logger.info(`📂 Fetching file content: ${filePath}`);
    await this.delay(800);
    
    const mockCode = `export function getUserDisplayName(user) {
  return user.name || user.email;
}

export function formatUserGreeting(user) {
  const name = getUserDisplayName(user);
  return \`Hello, \${name}!\`;
}`;
    
    logger.info(`✅ Retrieved ${filePath} (${mockCode.length} characters)`);
    return mockCode;
  }

  async createPullRequest(issueId: string, _title: string, files: any[]) {
    logger.info('🔧 Creating pull request...');
    logger.info(`   Branch: fix/sentry-${issueId}-${Date.now()}`);
    logger.info(`   Files: ${files.map(f => f.path).join(', ')}`);
    await this.delay(2000);
    
    const prUrl = `https://github.com/dovetail/sentrypede/pull/${Math.floor(Math.random() * 1000) + 1}`;
    logger.info(`✅ Pull request created: ${prUrl}`);
    return { html_url: prUrl, number: 123 };
  }

  async addComment(prNumber: number, _comment: string) {
    logger.info(`💬 Adding AI analysis comment to PR #${prNumber}`);
    await this.delay(500);
  }

  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class MockGeminiService implements MockService {
  name = 'Google Gemini AI';
  connected = true;

  async testConnection(): Promise<boolean> {
    logger.info('🤖 Testing Gemini AI connection...');
    await this.delay(1500);
    logger.info('✅ Gemini AI connected - ready for error analysis');
    return true;
  }

  async analyzeAndFix(issue: any, _event: any, codeContext: any) {
    logger.info('🧠 Analyzing error with Gemini AI...');
    logger.info('   📖 Processing error details and stack trace');
    await this.delay(1000);
    
    logger.info('   🔍 Examining code context');
    await this.delay(1500);
    
    logger.info('   💡 Generating fix recommendations');
    await this.delay(2000);

    const analysis = {
      summary: 'Null reference error when accessing user properties',
      rootCause: 'The user object can be undefined when the function is called before authentication completes',
      suggestedFix: 'Add null checking before accessing user properties',
      confidence: 0.87,
      affectedFiles: ['src/utils/user.js'],
      explanation: 'The error occurs because the code assumes the user object always exists, but it can be undefined during the authentication flow. Adding proper null checks will prevent this error.'
    };

    const fixes = [{
      filePath: 'src/utils/user.js',
      originalCode: codeContext['src/utils/user.js'],
      fixedCode: `export function getUserDisplayName(user) {
  // Added null check to prevent TypeError
  if (!user) {
    return 'Unknown User';
  }
  return user.name || user.email || 'Unknown User';
}

export function formatUserGreeting(user) {
  // Added null check for additional safety
  if (!user) {
    return 'Hello, Unknown User!';
  }
  const name = getUserDisplayName(user);
  return \`Hello, \${name}!\`;
}`,
      changes: [
        'Added null/undefined checks',
        'Added default return values',
        'Added defensive programming patterns',
        'Added 6 lines of error handling code'
      ]
    }];

    const testCode = `describe('getUserDisplayName', () => {
  test('handles undefined user gracefully', () => {
    expect(getUserDisplayName(undefined)).toBe('Unknown User');
    expect(getUserDisplayName(null)).toBe('Unknown User');
  });

  test('returns name when user has name property', () => {
    const user = { name: 'John Doe', email: 'john@example.com' };
    expect(getUserDisplayName(user)).toBe('John Doe');
  });

  test('falls back to email when name is missing', () => {
    const user = { email: 'john@example.com' };
    expect(getUserDisplayName(user)).toBe('john@example.com');
  });
});`;

    const pullRequestDescription = `## 🤖 AI-Generated Fix for Sentry Issue

This pull request was automatically generated by Sentrypede using AI analysis.

### 📋 Issue Details
- **Sentry Issue ID**: ${issue.id}
- **Error**: ${issue.title}
- **Occurrences**: ${issue.count}
- **Users Affected**: ${issue.userCount}

### 🔍 Analysis
**Summary**: ${analysis.summary}

**Root Cause**: ${analysis.rootCause}

**Confidence**: ${Math.round(analysis.confidence * 100)}%

### 📝 Changes Made
- \`src/utils/user.js\`

**Modifications**:
${fixes[0].changes.map(c => `- ${c}`).join('\n')}

### 💡 Explanation
${analysis.explanation}

### ⚠️ Important Notes
- This fix was generated by AI with ${Math.round(analysis.confidence * 100)}% confidence
- Please review carefully before merging
- Consider adding tests if not included
- Verify the fix doesn't introduce new issues

---
*Generated by [Sentrypede](https://github.com/sentrypede) 🐛🤖 powered by Google Gemini*`;

    logger.info('🎯 Analysis complete:');
    logger.info(`   Summary: ${analysis.summary}`);
    logger.info(`   Root Cause: ${analysis.rootCause}`);
    logger.info(`   Confidence: ${Math.round(analysis.confidence * 100)}%`);
    logger.info(`   Affected Files: ${analysis.affectedFiles.length}`);
    logger.info(`   Fixes Generated: ${fixes.length}`);

    return {
      analysis,
      fixes,
      testCode,
      pullRequestDescription
    };
  }

  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

async function runFullWorkflowDemo() {
  logger.info('🚀 Sentrypede Full Workflow Demo');
  logger.info('=====================================\n');

  try {
    // Initialize services
    logger.info('📦 Initializing services...\n');
    const sentryService = new MockSentryService();
    const slackService = new MockSlackService();
    const githubService = new MockGitHubService();
    const geminiService = new MockGeminiService();

    // Test all connections
    logger.info('🔍 Step 1: Testing service connections...\n');
    
    const services = [sentryService, slackService, githubService, geminiService];
    for (const service of services) {
      await service.testConnection();
    }
    logger.info('');

    // Fetch issues
    logger.info('📋 Step 2: Monitoring Sentry for new issues...\n');
    const issues = await sentryService.fetchIssues();
    const issue = issues[0];
    logger.info('');

    // Process the issue
    logger.info('🐛 Step 3: Processing critical error...\n');
    logger.info(`Issue: ${issue.title}`);
    logger.info(`Affected Users: ${issue.userCount}`);
    logger.info(`Occurrences: ${issue.count}`);
    logger.info('');

    // Post to Slack
    logger.info('💬 Step 4: Notifying team via Slack...\n');
    await slackService.postIssue(issue);
    logger.info('');

    // Get code context
    logger.info('📂 Step 5: Gathering code context from GitHub...\n');
    const codeContext = {
      'src/utils/user.js': await githubService.getFileContent('src/utils/user.js')
    };
    logger.info('');

    // Analyze with AI
    logger.info('🤖 Step 6: AI-powered error analysis...\n');
    await slackService.updateStatus(issue.id, 'Analyzing error with AI...');
    const fixResult = await geminiService.analyzeAndFix(issue, null, codeContext);
    logger.info('');

    // Post analysis to Slack
    logger.info('📊 Step 7: Sharing analysis with team...\n');
    await slackService.postAnalysis(issue.id, fixResult.analysis);
    logger.info('');

    // Create PR if confident enough
    if (fixResult.analysis.confidence > 0.5) {
      logger.info('🔧 Step 8: Creating automated fix...\n');
      await slackService.updateStatus(issue.id, 'Creating pull request with fix...');
      
      const githubFiles = fixResult.fixes.map(fix => ({
        path: fix.filePath,
        content: fix.fixedCode,
      }));

      const pr = await githubService.createPullRequest(issue.id, issue.title, githubFiles);
      
      // Add AI analysis as comment
      await githubService.addComment(pr.number, fixResult.pullRequestDescription);
      
      // Notify success
      await slackService.notifySuccess(issue.id, pr.html_url, fixResult.analysis.summary);
      logger.info('');

      // Show generated test
      logger.info('🧪 Step 9: Generated test code:\n');
      logger.info('```javascript');
      logger.info(fixResult.testCode);
      logger.info('```\n');
    }

    logger.info('✨ Demo completed successfully!');
    logger.info('=====================================');
    logger.info('');
    logger.info('🎯 Key Features Demonstrated:');
    logger.info('   ✅ Real-time Sentry monitoring');
    logger.info('   ✅ Slack team notifications');
    logger.info('   ✅ AI-powered error analysis (87% confidence)');
    logger.info('   ✅ Automated code fix generation');
    logger.info('   ✅ GitHub pull request creation');
    logger.info('   ✅ Unit test generation');
    logger.info('   ✅ End-to-end workflow automation');
    logger.info('');
    logger.info('🚀 Sentrypede: Making bug fixing as automated as possible!');

  } catch (error: any) {
    logger.error('❌ Demo failed:', error);
    process.exit(1);
  }
}

// Run the demo
runFullWorkflowDemo().catch((error) => {
  logger.error('Unexpected error:', error);
  process.exit(1);
}); 