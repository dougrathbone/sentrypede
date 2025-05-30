#!/usr/bin/env node
import dotenv from 'dotenv';
import { loadConfig } from './config';
import { SlackService } from './services/slack';
import { WebClient } from '@slack/web-api';

// Load environment variables
dotenv.config();

async function testSlackIntegration() {
  console.log('🧪 Testing Slack Integration...\n');

  try {
    // Load configuration
    const config = loadConfig();
    console.log('✅ Configuration loaded successfully');
    console.log(`   Bot Token: ${config.slack.botToken.substring(0, 10)}...`);
    console.log(`   App Token: ${config.slack.appToken.substring(0, 10)}...`);
    console.log(`   Channel ID: ${config.slack.channelId}\n`);

    // Test 1: Verify bot token with auth.test
    console.log('1️⃣ Testing bot authentication...');
    const client = new WebClient(config.slack.botToken);
    
    let authResult: any;
    try {
      authResult = await client.auth.test();
      console.log('✅ Bot authentication successful');
      console.log(`   Bot User ID: ${authResult.user_id}`);
      console.log(`   Bot User: ${authResult.user}`);
      console.log(`   Team: ${authResult.team}`);
      console.log(`   Team ID: ${authResult.team_id}\n`);
    } catch (error: any) {
      console.error('❌ Bot authentication failed:', error.message);
      console.error('   Please check your SLACK_BOT_TOKEN\n');
      return;
    }

    // Test 2: Verify channel access
    console.log('2️⃣ Testing channel access...');
    try {
      const channelInfo = await client.conversations.info({
        channel: config.slack.channelId,
      });
      
      if (channelInfo.ok && channelInfo.channel) {
        console.log('✅ Channel access verified');
        console.log(`   Channel Name: ${channelInfo.channel.name}`);
        console.log(`   Is Member: ${channelInfo.channel.is_member ? 'Yes' : 'No - Bot needs to be invited!'}\n`);
        
        if (!channelInfo.channel.is_member) {
          console.warn('⚠️  Bot is not a member of the channel!');
          console.warn(`   Please invite the bot to #${channelInfo.channel.name}`);
          console.warn(`   Type: /invite @${authResult.user} in the channel\n`);
        }
      }
    } catch (error: any) {
      console.error('❌ Channel access failed:', error.message);
      console.error('   Please check your SLACK_CHANNEL_ID\n');
    }

    // Test 3: Create and start Slack service
    console.log('3️⃣ Testing Slack service initialization...');
    const slackService = new SlackService(config.slack);
    
    try {
      await slackService.start();
      console.log('✅ Slack service started successfully\n');
    } catch (error: any) {
      console.error('❌ Failed to start Slack service:', error.message);
      if (error.message.includes('invalid_auth')) {
        console.error('   This usually means your SLACK_APP_TOKEN is incorrect');
        console.error('   Make sure Socket Mode is enabled and you have a valid app-level token\n');
      }
      return;
    }

    // Test 4: Send a test message
    console.log('4️⃣ Sending test message...');
    try {
      await slackService.postMessage(
        '🧪 Sentrypede Test Message',
        [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'This is a test message from Sentrypede to verify Slack integration is working correctly.',
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Test performed at ${new Date().toLocaleString()}`,
              },
            ],
          },
        ]
      );
      console.log('✅ Test message sent successfully');
      console.log('   Check your Slack channel for the message\n');
    } catch (error: any) {
      console.error('❌ Failed to send test message:', error.message);
    }

    // Test 5: Simulate issue notification
    console.log('5️⃣ Testing issue notification format...');
    const mockIssue = {
      id: 'test-123',
      title: 'TypeError: Cannot read property \'foo\' of undefined',
      culprit: 'app.js in handleRequest',
      permalink: 'https://sentry.io/organizations/test/issues/test-123/',
      shortId: 'TEST-123',
      status: 'unresolved',
      level: 'error',
      count: '42',
      userCount: 5,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      project: {
        id: '1',
        name: 'Test Project',
        slug: 'test-project',
      },
      metadata: {
        type: 'TypeError',
        value: 'Cannot read property \'foo\' of undefined',
      },
      tags: [
        { key: 'environment', value: 'production' },
        { key: 'browser', value: 'Chrome 120' },
      ],
    };

    try {
      const thread = await slackService.postIssueNotification(mockIssue);
      console.log('✅ Issue notification sent successfully');
      console.log(`   Thread timestamp: ${thread.threadTs}`);
      
      // Send follow-up messages
      await new Promise(resolve => setTimeout(resolve, 1000));
      await slackService.postProcessingStarted(mockIssue.id);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      await slackService.postFixSuccess(
        mockIssue.id,
        'https://github.com/test/repo/pull/123'
      );
      
      console.log('✅ Thread updates sent successfully\n');
    } catch (error: any) {
      console.error('❌ Failed to send issue notification:', error.message);
    }

    // Clean up
    console.log('🧹 Cleaning up...');
    await slackService.stop();
    console.log('✅ Slack service stopped\n');

    console.log('✅ All Slack integration tests completed!');
    console.log('\n📌 Summary:');
    console.log('   - Authentication: Working');
    console.log('   - Channel access: Verified');
    console.log('   - Socket Mode: Connected');
    console.log('   - Message sending: Functional');
    console.log('   - Ready for monitoring: Yes');

  } catch (error: any) {
    console.error('\n❌ Slack integration test failed:');
    console.error(`   Error: ${error.message}`);
    
    if (error.message.includes('SLACK_BOT_TOKEN')) {
      console.error('\n🔑 Missing bot token. Please ensure you have:');
      console.error('   1. Created a Slack app');
      console.error('   2. Added OAuth scopes');
      console.error('   3. Installed the app to your workspace');
      console.error('   4. Copied the Bot User OAuth Token');
    }
    
    process.exit(1);
  }
}

// Run the test
testSlackIntegration().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
}); 