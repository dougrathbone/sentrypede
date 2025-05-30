#!/usr/bin/env ts-node

/**
 * Debug Sentry token issues
 * Run with: npx ts-node src/debug-sentry-token.ts
 */

import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

async function debugToken() {
  console.log('🔧 Debugging Sentry Token Issues\n');
  
  const token = process.env.SENTRY_AUTH_TOKEN;
  
  if (!token) {
    console.log('❌ No SENTRY_AUTH_TOKEN found');
    console.log('🔗 Set it in your .env file');
    return;
  }

  console.log('🔍 Token Analysis:');
  console.log(`   Length: ${token.length} characters`);
  console.log(`   Starts with: ${token.substring(0, 10)}...`);
  console.log(`   Ends with: ...${token.substring(token.length - 10)}`);
  
  // Check token format
  if (token.startsWith('sntrys_')) {
    console.log('⚠️  WARNING: This is an Organization Auth Token');
    console.log('   These have very limited permissions');
    console.log('   🔧 Solution: Create Internal Integration instead');
    return;
  } else if (token.startsWith('sntryu_')) {
    console.log('📝 User Auth Token detected');
  } else if (token.startsWith('sntryi_')) {
    console.log('✅ Internal Integration token detected');
  } else {
    console.log('❓ Unknown token format');
  }

  // Test basic connectivity
  console.log('\n🌐 Testing connectivity...');
  try {
    await axios.head('https://sentry.io/api/0/', {
      timeout: 5000,
    });
    console.log('✅ Can reach Sentry API');
  } catch (error) {
    console.log('❌ Cannot reach Sentry API');
    console.log('   Check your internet connection');
    return;
  }

  // Test token with minimal endpoint
  console.log('\n🔐 Testing token validity...');
  try {
    const response = await axios.get('https://sentry.io/api/0/organizations/', {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      timeout: 10000,
    });
    
    console.log('✅ Token works! Found organizations:');
    response.data.forEach((org: any) => {
      console.log(`   - ${org.slug}: ${org.name}`);
    });
    
  } catch (error: any) {
    console.log('❌ Token validation failed');
    
    if (error.response) {
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Message: ${error.response.data?.detail || error.response.statusText}`);
      
      if (error.response.status === 401) {
        console.log('\n🔧 401 Troubleshooting:');
        console.log('   1. Double-check token copy/paste');
        console.log('   2. Ensure it\'s an Internal Integration token');
        console.log('   3. Verify Organization:Read permission is enabled');
        console.log('   4. Try creating a brand new integration');
        console.log('   5. Check if token was revoked in Sentry settings');
      }
    } else {
      console.log(`   Network error: ${error.message}`);
    }
  }

  console.log('\n📋 Next Steps:');
  console.log('1. Go to: https://dovetail.sentry.io/settings/developer-settings/');
  console.log('2. Create new Internal Integration');
  console.log('3. Copy token and update .env file');
  console.log('4. Run this script again to verify');
}

if (require.main === module) {
  debugToken().catch(console.error);
}

export { debugToken }; 