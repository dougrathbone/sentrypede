#!/usr/bin/env node
import dotenv from 'dotenv';
import { loadConfig } from './config';
import { SlackService } from './services/slack';
import { SentryIssue } from './services/sentry';

dotenv.config();

async function demoSlack() {
  console.log('🎯 Slack Service Demo\n');

  try {
    const config = loadConfig();
    const slack = new SlackService(config.slack);
    await slack.start();
    console.log('✅ Slack service started\n');

    // Create a mock issue
    const issue: SentryIssue = {
      id: 'demo-' + Date.now(),
      title: 'TypeError: Cannot read property \'map\' of undefined',
      culprit: 'components/UserList.tsx in renderUsers',
      permalink: 'https://sentry.io/organizations/demo/issues/demo-123/',
      shortId: 'DEMO-123',
      status: 'unresolved',
      level: 'error',
      count: '156',
      userCount: 23,
      firstSeen: new Date(Date.now() - 3600000).toISOString(),
      lastSeen: new Date().toISOString(),
      project: {
        id: '1',
        name: 'Frontend App',
        slug: 'frontend-app',
      },
      metadata: {
        type: 'TypeError',
        value: 'Cannot read property \'map\' of undefined',
      },
      tags: [
        { key: 'environment', value: 'production' },
        { key: 'browser', value: 'Chrome 120.0' },
      ],
    };

    // 1. Notify about new issue
    console.log('1️⃣ Notifying about new issue...');
    await slack.notifyNewIssue(issue);
    console.log('   ✅ Issue notification sent\n');

    await delay(2000);

    // 2. Update status (simple one-liner)
    console.log('2️⃣ Updating status...');
    await slack.updateStatus(issue.id, 'Fetching error details from Sentry...');
    await delay(1500);
    
    await slack.updateStatus(issue.id, 'Analyzing stack trace...', 'Found 3 similar patterns in codebase');
    await delay(2000);
    console.log('   ✅ Status updates sent\n');

    // 3. Post analysis (simple object)
    console.log('3️⃣ Posting analysis...');
    await slack.postAnalysis(issue.id, {
      summary: 'Attempting to map over undefined users array',
      cause: 'The users prop is not being passed to UserList component',
      suggestion: 'Add default props or null check:\nconst users = props.users || [];',
      confidence: 0.85,
    });
    console.log('   ✅ Analysis posted\n');

    await delay(2000);

    // 4. Success scenario
    console.log('4️⃣ Posting success...');
    await slack.updateStatus(issue.id, 'Creating pull request...');
    await delay(1500);
    
    await slack.notifySuccess(
      issue.id, 
      'https://github.com/demo/repo/pull/456',
      'Added null check to UserList component'
    );
    console.log('   ✅ Success notification sent\n');

    await delay(3000);

    // 5. Failure scenario (different issue)
    const failedIssue = { ...issue, id: 'demo-fail-' + Date.now() };
    
    console.log('5️⃣ Demonstrating failure scenario...');
    await slack.notifyNewIssue(failedIssue);
    await delay(1500);
    
    await slack.updateStatus(failedIssue.id, 'Analyzing issue...');
    await delay(1500);
    
    await slack.notifyFailure(
      failedIssue.id,
      'Unable to determine root cause - error occurs in minified code',
      [
        'Enable source maps in production',
        'Check if error boundaries are properly configured',
        'Manual investigation required',
      ]
    );
    console.log('   ✅ Failure notification sent\n');

    // Show the simple API
    console.log('\n📝 API Summary:');
    console.log('   • notifyNewIssue(issue) - Post initial notification');
    console.log('   • updateStatus(id, status, details?) - Update progress');
    console.log('   • postAnalysis(id, {summary, cause, suggestion, confidence}) - Share findings');
    console.log('   • notifySuccess(id, prUrl, summary?) - Celebrate success');
    console.log('   • notifyFailure(id, reason, suggestions?) - Explain failure');
    console.log('\n✨ That\'s it! Simple and effective.\n');

    // Keep running for interactions
    console.log('⏳ Service running for 20 seconds...');
    console.log('   Try: @Sentrypede status\n');
    await delay(20000);

    await slack.stop();
    console.log('✅ Demo complete!');

  } catch (error: any) {
    console.error('❌ Demo failed:', error.message);
    process.exit(1);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

demoSlack().catch(console.error); 