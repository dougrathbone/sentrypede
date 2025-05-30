import { InteractiveSlackService } from './services/slack-interactive';
import { SlackConfig } from './config';
import { SentryIssue } from './services/sentry';

/**
 * Demo script showcasing the Interactive Slack Experience
 * 
 * This demonstrates:
 * - Interactive issue notifications with action buttons
 * - Real-time dashboards with metrics
 * - Enhanced user interactions and workflows
 * - Priority-based issue handling
 */

const demoConfig: SlackConfig = {
  botToken: process.env.SLACK_BOT_TOKEN || 'demo-token',
  appToken: process.env.SLACK_APP_TOKEN || 'demo-app-token',
  signingSecret: process.env.SLACK_SIGNING_SECRET || 'demo-secret',
  channelId: process.env.SLACK_CHANNEL_ID || 'C1234567890',
};

const mockIssues: SentryIssue[] = [
  {
    id: 'demo-critical-1',
    title: 'Fatal database connection timeout in payment processing',
    culprit: 'payment/processor.js:142',
    permalink: 'https://sentry.io/demo/issues/critical-1',
    shortId: 'PAY-001',
    status: 'unresolved',
    level: 'fatal',
    count: '2847',
    userCount: 1250,
    firstSeen: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    lastSeen: new Date().toISOString(),
    project: {
      id: 'payment-service',
      name: 'Payment Service',
      slug: 'payment-service',
    },
    metadata: {
      type: 'ConnectionTimeoutError',
      value: 'Database connection timeout after 30s',
    },
    tags: [
      { key: 'environment', value: 'production' },
      { key: 'service', value: 'payment-api' },
      { key: 'severity', value: 'critical' },
    ],
  },
  {
    id: 'demo-high-2',
    title: 'Null reference exception in user authentication',
    culprit: 'auth/validator.ts:89',
    permalink: 'https://sentry.io/demo/issues/high-2',
    shortId: 'AUTH-002',
    status: 'unresolved',
    level: 'error',
    count: '456',
    userCount: 89,
    firstSeen: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
    lastSeen: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
    project: {
      id: 'auth-service',
      name: 'Authentication Service',
      slug: 'auth-service',
    },
    metadata: {
      type: 'TypeError',
      value: "Cannot read property 'id' of null",
    },
    tags: [
      { key: 'environment', value: 'production' },
      { key: 'browser', value: 'Chrome 91' },
      { key: 'user_type', value: 'premium' },
    ],
  },
  {
    id: 'demo-medium-3',
    title: 'API rate limit exceeded in notification service',
    culprit: 'notifications/sender.js:203',
    permalink: 'https://sentry.io/demo/issues/medium-3',
    shortId: 'NOTIF-003',
    status: 'unresolved',
    level: 'warning',
    count: '123',
    userCount: 45,
    firstSeen: new Date(Date.now() - 14400000).toISOString(), // 4 hours ago
    lastSeen: new Date(Date.now() - 1800000).toISOString(), // 30 minutes ago
    project: {
      id: 'notification-service',
      name: 'Notification Service',
      slug: 'notification-service',
    },
    metadata: {
      type: 'RateLimitError',
      value: 'Rate limit of 1000 requests/hour exceeded',
    },
    tags: [
      { key: 'environment', value: 'production' },
      { key: 'service', value: 'email-api' },
      { key: 'region', value: 'us-east-1' },
    ],
  },
];

const mockEvents: any[] = [
  {
    id: 'event-1',
    message: 'Database connection timeout',
    platform: 'javascript',
    timestamp: new Date().toISOString(),
    entries: [
      {
        type: 'exception',
        data: {
          values: [
            {
              type: 'ConnectionTimeoutError',
              value: 'Database connection timeout after 30s',
              stacktrace: {
                frames: [
                  {
                    filename: 'payment/processor.js',
                    lineno: 142,
                    function: 'processPayment',
                  },
                  {
                    filename: 'db/connection.js',
                    lineno: 67,
                    function: 'executeQuery',
                  },
                  {
                    filename: 'db/pool.js',
                    lineno: 23,
                    function: 'getConnection',
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  },
  {
    id: 'event-2',
    message: 'Null reference exception',
    platform: 'javascript',
    timestamp: new Date().toISOString(),
    entries: [
      {
        type: 'exception',
        data: {
          values: [
            {
              type: 'TypeError',
              value: "Cannot read property 'id' of null",
              stacktrace: {
                frames: [
                  {
                    filename: 'auth/validator.ts',
                    lineno: 89,
                    function: 'validateUser',
                  },
                  {
                    filename: 'auth/middleware.ts',
                    lineno: 45,
                    function: 'authenticate',
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  },
  {
    id: 'event-3',
    message: 'Rate limit exceeded',
    platform: 'javascript',
    timestamp: new Date().toISOString(),
    entries: [
      {
        type: 'exception',
        data: {
          values: [
            {
              type: 'RateLimitError',
              value: 'Rate limit of 1000 requests/hour exceeded',
              stacktrace: {
                frames: [
                  {
                    filename: 'notifications/sender.js',
                    lineno: 203,
                    function: 'sendEmail',
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  },
];

async function demoInteractiveSlackExperience() {
  console.log('🚀 Starting Interactive Slack Experience Demo...\n');

  // Initialize the Interactive Slack Service
  const slackService = new InteractiveSlackService(demoConfig);
  
  try {
    // Demo 1: Critical Issue with Immediate Action Buttons
    console.log('📊 Demo 1: Critical Issue Notification');
    console.log('========================================');
    
    const criticalThread = await slackService.notifyNewIssue(mockIssues[0], mockEvents[0]);
    
    console.log(`✅ Posted critical issue notification:`);
    console.log(`   - Issue: ${mockIssues[0].title}`);
    console.log(`   - Priority: ${criticalThread.priority} 🚨`);
    console.log(`   - Thread ID: ${criticalThread.threadTs}`);
    console.log(`   - Interactive buttons: Fix Now, Details, Escalate, Ignore`);
    console.log(`   - Auto-calculated priority based on 1,250 affected users\n`);

    // Demo 2: Simulate User Interactions
    console.log('👆 Demo 2: Simulating Button Interactions');
    console.log('==========================================');
    
    // Simulate "Fix Now" interaction for high priority issue
    const highThread = await slackService.notifyNewIssue(mockIssues[1], mockEvents[1]);
    
    console.log(`✅ Posted high priority issue:`);
    console.log(`   - Issue: ${mockIssues[1].title}`);
    console.log(`   - Priority: ${highThread.priority} 🔴`);
    console.log(`   - 89 users affected by auth bug\n`);

    // Simulate user clicking "Fix Now"
    const thread = slackService.getThread(mockIssues[1].id);
    if (thread) {
      thread.status = 'analyzing';
      thread.assignedTo = 'U987654321';
      thread.interactionHistory.push({
        timestamp: new Date(),
        action: 'fix_now',
        userId: 'U987654321',
        metadata: { priority: 'high' },
      });
      
      console.log(`🚀 User interaction simulated:`);
      console.log(`   - Action: Fix Now clicked`);
      console.log(`   - User: <@U987654321> (Senior Developer)`);
      console.log(`   - Status: ${thread.status}`);
      console.log(`   - AI analysis initiated automatically\n`);
    }

    // Demo 3: Dashboard with Rich Metrics
    console.log('📈 Demo 3: Interactive Dashboard');
    console.log('=================================');

    // Add the third issue
    await slackService.notifyNewIssue(mockIssues[2], mockEvents[2]);

    // Simulate some completed fixes
    await slackService.notifySuccess(
      mockIssues[2].id,
      'https://github.com/company/notification-service/pull/456',
      'Added exponential backoff and circuit breaker for rate limiting'
    );

    const metrics = slackService.getMetrics();
    console.log(`📊 Current Dashboard Metrics:`);
    console.log(`   - Total Issues: ${metrics.totalIssues}`);
    console.log(`   - Resolved Today: ${metrics.resolvedToday}`);
    console.log(`   - Success Rate: ${metrics.successRate}%`);
    console.log(`   - Average Fix Time: ${metrics.averageFixTime} minutes`);
    console.log(`   - Interactive refresh buttons available\n`);

    // Demo 4: Enhanced Error Details
    console.log('🔍 Demo 4: Detailed Issue Analysis');
    console.log('===================================');
    
    const detailedIssue = slackService.getThread(mockIssues[0].id);
    if (detailedIssue) {
      console.log(`🔍 Detailed analysis available for: ${mockIssues[0].shortId}`);
      console.log(`   - Full stack trace with 3 relevant frames`);
      console.log(`   - Error context: Database timeout in payment processing`);
      console.log(`   - Impact: 2,847 occurrences affecting 1,250 users`);
      console.log(`   - Interactive buttons: Show full details, escalate to incident\n`);
    }

    // Demo 5: Team Interaction History
    console.log('👥 Demo 5: Team Interaction Tracking');
    console.log('====================================');
    
    // Simulate various team interactions
    const authThread = slackService.getThread(mockIssues[1].id);
    if (authThread) {
      authThread.interactionHistory.push(
        {
          timestamp: new Date(Date.now() - 1800000), // 30 min ago
          action: 'show_details',
          userId: 'U123456789',
          metadata: { role: 'DevOps Engineer' },
        },
        {
          timestamp: new Date(Date.now() - 900000), // 15 min ago
          action: 'escalate',
          userId: 'U123456789',
          metadata: { reason: 'Affects premium users' },
        },
        {
          timestamp: new Date(),
          action: 'fix_now',
          userId: 'U987654321',
          metadata: { experience: 'Senior Developer' },
        }
      );

      console.log(`👥 Team interaction history:`);
      authThread.interactionHistory.forEach((interaction, idx) => {
        console.log(`   ${idx + 1}. ${interaction.action} by <@${interaction.userId}> at ${interaction.timestamp.toLocaleTimeString()}`);
      });
      console.log(`   - Full audit trail for compliance and learning\n`);
    }

    // Demo 6: Priority-Based Workflows
    console.log('🎯 Demo 6: Smart Priority System');
    console.log('=================================');
    
    console.log(`🎯 Automatic priority calculation:`);
    mockIssues.forEach((issue) => {
      const thread = slackService.getThread(issue.id);
      if (thread) {
        const priorityEmoji = thread.priority === 'critical' ? '🚨' : 
                            thread.priority === 'high' ? '🔴' : 
                            thread.priority === 'medium' ? '🟡' : '🟢';
        console.log(`   ${priorityEmoji} ${thread.priority.toUpperCase()}: ${issue.shortId}`);
        console.log(`      - ${issue.userCount} users affected`);
        console.log(`      - ${issue.count} total occurrences`);
        console.log(`      - Level: ${issue.level}`);
      }
    });

    console.log('\n🎉 Interactive Slack Experience Demo Complete!');
    console.log('===============================================');
    console.log('✨ Key Features Demonstrated:');
    console.log('   🚀 One-click "Fix Now" automation');
    console.log('   🔍 Detailed error analysis with stack traces');
    console.log('   ⚠️  Smart escalation workflows');
    console.log('   🙈 Issue filtering and management');
    console.log('   📊 Real-time dashboards and metrics');
    console.log('   👥 Team interaction tracking');
    console.log('   🎯 Intelligent priority calculation');
    console.log('   💬 Enhanced Slack commands (@mention support)');
    console.log('   🔄 Interactive refresh and retry buttons');
    console.log('   📈 Success rate and performance tracking');

  } catch (error) {
    console.error('❌ Demo failed:', error);
  }
}

// Interactive Usage Examples
function showUsageExamples() {
  console.log('\n📖 Usage Examples:');
  console.log('==================');
  console.log('');
  console.log('💬 Slack Commands:');
  console.log('   @Sentrypede dashboard  → Show error metrics and trends');
  console.log('   @Sentrypede status     → Current system status');
  console.log('   @Sentrypede help       → Interactive help guide');
  console.log('');
  console.log('🔘 Interactive Buttons:');
  console.log('   🚀 Fix Now     → Start AI-powered automated fix');
  console.log('   🔍 Details     → Show full error analysis');
  console.log('   ⚠️  Escalate    → Mark as critical, notify team');
  console.log('   🙈 Ignore      → Skip automated processing');
  console.log('   📊 Dashboard   → View real-time metrics');
  console.log('   🔄 Refresh     → Update dashboard data');
  console.log('');
  console.log('📈 Dashboard Metrics:');
  console.log('   • Total issues processed today');
  console.log('   • Success rate percentage');
  console.log('   • Average fix time');
  console.log('   • Status distribution (new, analyzing, fixed, failed)');
  console.log('   • Priority breakdown (critical, high, medium, low)');
  console.log('   • Top error types and trends');
  console.log('   • Team activity and contributions');
  console.log('');
  console.log('🎯 Smart Features:');
  console.log('   • Automatic priority calculation based on impact');
  console.log('   • User assignment tracking');
  console.log('   • Interaction history and audit trails');
  console.log('   • Retry mechanisms for failed fixes');
  console.log('   • Incident escalation workflows');
  console.log('   • Rich error context with stack traces');
}

// Run the demo
async function main() {
  console.log('🤖 Sentrypede Interactive Slack Experience Demo');
  console.log('================================================\n');
  
  await demoInteractiveSlackExperience();
  showUsageExamples();
  
  console.log('\n🎯 Next Steps:');
  console.log('==============');
  console.log('1. Set up your Slack app with proper permissions');
  console.log('2. Configure environment variables for Slack tokens');
  console.log('3. Deploy the InteractiveSlackService to your server');
  console.log('4. Test with real Sentry issues');
  console.log('5. Customize priority rules for your team');
  console.log('6. Train your team on interactive features');
  console.log('\n🔗 For setup instructions, see: docs/slack-interactive-setup.md');
}

if (require.main === module) {
  main().catch(console.error);
}

export { demoInteractiveSlackExperience }; 