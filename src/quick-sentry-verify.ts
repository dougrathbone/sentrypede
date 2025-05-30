#!/usr/bin/env ts-node

/**
 * Quick Sentry verification script
 * Run with: npx ts-node src/quick-sentry-verify.ts
 */

import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

async function quickVerify() {
  console.log('🔐 Quick Sentry Token Verification\n');

  const token = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG_SLUG || 'dovetail';

  if (!token) {
    console.log('❌ SENTRY_AUTH_TOKEN not found in environment variables');
    console.log('💡 Make sure to update your .env file with the new token\n');
    process.exit(1);
  }

  const maskedToken = token.substring(0, 8) + '...' + token.substring(token.length - 4);
  console.log(`🔑 Testing token: ${maskedToken}`);
  console.log(`🏢 Organization: ${org}\n`);

  try {
    // Test the most basic endpoint first
    console.log('1. Testing projects endpoint...');
    const response = await axios.get(`https://sentry.io/api/0/organizations/${org}/projects/`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      timeout: 10000,
    });

    console.log('✅ SUCCESS! Token is working');
    console.log(`📁 Found ${response.data.length} projects:`);
    
    if (response.data.length > 0) {
      response.data.slice(0, 5).forEach((project: any, index: number) => {
        console.log(`   ${index + 1}. ${project.slug} (${project.name})`);
      });
      
      if (response.data.length > 5) {
        console.log(`   ... and ${response.data.length - 5} more`);
      }

      console.log('\n📝 Add these project slugs to your SENTRY_PROJECT_SLUGS:');
      const slugs = response.data.slice(0, 3).map((p: any) => p.slug).join(',');
      console.log(`SENTRY_PROJECT_SLUGS=${slugs}`);
    }

    console.log('\n🎉 Your Sentry authentication is working correctly!');
    console.log('🚀 You can now run Sentrypede with: npm start');

  } catch (error: any) {
    console.log('❌ FAILED');
    
    if (error.response?.status === 401) {
      console.log('🔐 Still getting 401 - Token issues:');
      console.log('   • Double-check you copied the token correctly');
      console.log('   • Make sure it\'s an Internal Integration token');
      console.log('   • Verify the token has Project:Read permissions');
      console.log('   • Try creating a completely new integration');
    } else if (error.response?.status === 404) {
      console.log('🔍 404 Error - Organization not found:');
      console.log(`   • Check if organization slug "${org}" is correct`);
      console.log('   • Visit: https://sentry.io/settings/ to see your orgs');
    } else {
      console.log(`🚨 Unexpected error: ${error.message}`);
      if (error.response?.data) {
        console.log(`   Response: ${JSON.stringify(error.response.data)}`);
      }
    }
    
    console.log('\n💬 Need help? Check the setup guide:');
    console.log('   docs/sentry-setup.md');
  }
}

if (require.main === module) {
  quickVerify().catch(console.error);
}

export { quickVerify }; 