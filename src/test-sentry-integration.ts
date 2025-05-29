#!/usr/bin/env node
import dotenv from 'dotenv';
import { loadConfig } from './config';
import { SentryService } from './services/sentry';

// Load environment variables
dotenv.config();

async function testSentryIntegration() {
  console.log('🧪 Testing Sentry Integration...\n');

  try {
    // Load configuration
    const config = loadConfig();
    console.log('✅ Configuration loaded successfully');
    console.log(`   Organization: ${config.sentry.organizationSlug}`);
    console.log(`   Projects: ${config.sentry.projectSlugs.join(', ')}`);
    console.log(`   Environments: ${config.sentry.environments.join(', ')}\n`);

    // Create Sentry service
    const sentryService = new SentryService(config.sentry);
    console.log('✅ Sentry service initialized\n');

    // Test 1: Fetch recent issues
    console.log('📋 Fetching recent issues...');
    const issues = await sentryService.fetchRecentIssues();
    console.log(`✅ Found ${issues.length} issues\n`);

    if (issues.length > 0) {
      // Display first few issues
      console.log('📊 Sample issues:');
      issues.slice(0, 3).forEach((issue, index) => {
        console.log(`\n${index + 1}. ${issue.title}`);
        console.log(`   ID: ${issue.id}`);
        console.log(`   Project: ${issue.project.name} (${issue.project.slug})`);
        console.log(`   Level: ${issue.level}`);
        console.log(`   Status: ${issue.status}`);
        console.log(`   Count: ${issue.count}`);
        console.log(`   First seen: ${new Date(issue.firstSeen).toLocaleString()}`);
        console.log(`   Last seen: ${new Date(issue.lastSeen).toLocaleString()}`);
        console.log(`   Link: ${issue.permalink}`);
        
        // Check if should process
        try {
          const shouldProcess = sentryService.shouldProcessIssue(issue);
          console.log(`   Should process: ${shouldProcess ? '✅ Yes' : '❌ No'}`);
        } catch (error) {
          console.log(`   Should process: ⚠️  Error checking - ${error}`);
        }
      });

      // Test 2: Get detailed information for the first issue
      const firstIssue = issues[0];
      console.log(`\n📝 Fetching details for issue ${firstIssue.id}...`);
      
      try {
        await sentryService.getIssueDetails(firstIssue.id);
        console.log('✅ Issue details fetched successfully');
        
        // Test 3: Get latest event
        console.log(`\n🔍 Fetching latest event for issue ${firstIssue.id}...`);
        const latestEvent = await sentryService.getLatestEvent(firstIssue.id);
        console.log('✅ Latest event fetched successfully');
        
        // Test 4: Extract stack trace
        console.log('\n📚 Extracting stack trace...');
        const stackTrace = sentryService.extractStackTrace(latestEvent);
        if (stackTrace) {
          console.log('✅ Stack trace extracted:');
          console.log(stackTrace);
        } else {
          console.log('⚠️  No stack trace found in the event');
        }
        
        // Show event details
        console.log('\n📦 Event details:');
        console.log(`   Platform: ${latestEvent.platform}`);
        console.log(`   Timestamp: ${new Date(latestEvent.timestamp).toLocaleString()}`);
        console.log(`   Message: ${latestEvent.message || 'N/A'}`);
        
        if (latestEvent.tags && latestEvent.tags.length > 0) {
          console.log('   Tags:');
          latestEvent.tags.forEach(tag => {
            console.log(`     ${tag.key}: ${tag.value}`);
          });
        }
        
      } catch (error: any) {
        console.log(`⚠️  Could not fetch details for issue: ${error.message}`);
      }
    } else {
      console.log('ℹ️  No issues found. This could mean:');
      console.log('   - Your projects have no recent errors (great!)');
      console.log('   - The environment filter is excluding all issues');
      console.log('   - The project slugs might be incorrect');
    }

    // Test 5: Check processed issues tracking
    console.log('\n🔄 Testing issue tracking...');
    const beforeCount = sentryService.getProcessedCount();
    console.log(`   Processed issues before: ${beforeCount}`);
    
    if (issues.length > 0) {
      sentryService.markAsProcessed(issues[0].id);
      const afterCount = sentryService.getProcessedCount();
      console.log(`   Processed issues after marking: ${afterCount}`);
      console.log(`   Should process same issue again: ${sentryService.shouldProcessIssue(issues[0])}`);
    }

    console.log('\n✅ All Sentry integration tests completed successfully!');
    console.log('\n📌 Summary:');
    console.log(`   - API connection: Working`);
    console.log(`   - Projects accessible: ${config.sentry.projectSlugs.length}`);
    console.log(`   - Issues found: ${issues.length}`);
    console.log(`   - Ready for monitoring: Yes`);

  } catch (error: any) {
    console.error('\n❌ Sentry integration test failed:');
    console.error(`   Error: ${error.message}`);
    
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Status Text: ${error.response.statusText}`);
      
      // Show the actual error response data
      if (error.response.data) {
        console.error(`   Response: ${JSON.stringify(error.response.data, null, 2)}`);
      }
      
      if (error.response.status === 401) {
        console.error('\n🔑 Authentication failed. Please check:');
        console.error('   - Your SENTRY_AUTH_TOKEN is correct');
        console.error('   - The token has the required scopes (project:read, org:read, event:read)');
        console.error('   - The token has not expired');
      } else if (error.response.status === 404) {
        console.error('\n🔍 Resource not found. Please check:');
        console.error('   - Your SENTRY_ORG_SLUG is correct');
        console.error('   - Your SENTRY_PROJECT_SLUGS are correct');
        console.error('   - You have access to these projects');
      } else if (error.response.status === 400) {
        console.error('\n⚠️  Bad Request. This usually means:');
        console.error('   - Invalid query parameters');
        console.error('   - Check the environments filter');
        console.error('   - Check the date range');
      }
    }
    
    process.exit(1);
  }
}

// Run the test
testSentryIntegration().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
}); 