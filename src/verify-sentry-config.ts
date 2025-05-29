#!/usr/bin/env node
import dotenv from 'dotenv';
import { loadConfig } from './config';
import { SentryService } from './services/sentry';

// Load environment variables
dotenv.config();

async function verifySentryConfig() {
  console.log('🔍 Verifying Sentry Configuration...\n');

  try {
    // Load configuration
    const config = loadConfig();
    const sentryService = new SentryService(config.sentry);

    // List organizations
    console.log('📋 Checking organizations...');
    const orgs = await sentryService.listOrganizations();
    console.log(`✅ Found ${orgs.length} organization(s):\n`);
    
    orgs.forEach(org => {
      console.log(`   ${org.slug} - ${org.name}`);
      if (org.slug === config.sentry.organizationSlug) {
        console.log(`   ✅ This is your configured organization\n`);
      }
    });

    // List projects
    console.log('📁 Listing projects in your organization...');
    const projects = await sentryService.listProjects();
    console.log(`✅ Found ${projects.length} project(s):\n`);
    
    projects.forEach(project => {
      const isConfigured = config.sentry.projectSlugs.includes(project.slug);
      const marker = isConfigured ? '✅' : '  ';
      console.log(`   ${marker} ${project.slug} - ${project.name} (${project.platform || 'unknown platform'})`);
    });

    console.log('\n📊 Configuration Summary:');
    console.log(`   Organization: ${config.sentry.organizationSlug}`);
    console.log(`   Configured projects: ${config.sentry.projectSlugs.join(', ')}`);
    console.log(`   Environments: ${config.sentry.environments.join(', ')}`);

    // Verify configuration
    console.log('\n🔧 Verifying configuration...');
    const verification = await sentryService.verifyConfiguration();
    
    if (verification.valid) {
      console.log('✅ Configuration is valid!\n');
    } else {
      console.log('❌ Configuration has errors:\n');
      verification.errors.forEach(error => {
        console.log(`   - ${error}`);
      });
      
      if (verification.availableProjects.length > 0) {
        console.log('\n💡 Available projects you can use:');
        console.log(`   ${verification.availableProjects.join(', ')}`);
        console.log('\n   Update SENTRY_PROJECT_SLUGS in your .env file with the correct project slugs.');
      }
    }

  } catch (error: any) {
    console.error('\n❌ Failed to verify configuration:');
    console.error(`   Error: ${error.message}`);
    
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      
      if (error.response.status === 401) {
        console.error('\n🔑 Authentication failed. Please check:');
        console.error('   - Your SENTRY_AUTH_TOKEN is correct');
        console.error('   - The token has not expired');
        console.error('   - The token has the required scopes');
      }
    }
    
    process.exit(1);
  }
}

// Run verification
verifySentryConfig().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
}); 