#!/usr/bin/env node
import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

async function testSentryAuth() {
  console.log('🔍 Testing Sentry Authentication...\n');

  const authToken = process.env.SENTRY_AUTH_TOKEN;
  const orgSlug = process.env.SENTRY_ORG_SLUG;

  if (!authToken || !orgSlug) {
    console.error('❌ Missing required environment variables');
    console.error('   Please ensure SENTRY_AUTH_TOKEN and SENTRY_ORG_SLUG are set');
    process.exit(1);
  }

  // Mask the token for display
  const maskedToken = authToken.substring(0, 10) + '...' + authToken.substring(authToken.length - 4);
  console.log(`📝 Using auth token: ${maskedToken}`);
  console.log(`🏢 Organization slug: ${orgSlug}\n`);

  try {
    // Test 1: Try to get user info (this should work with auth tokens)
    console.log('1️⃣ Testing user endpoint...');
    try {
      const userResponse = await axios.get('https://sentry.io/api/0/users/me/', {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
      console.log('✅ User endpoint successful');
      console.log(`   User: ${userResponse.data.name || userResponse.data.email}`);
    } catch (error: any) {
      console.log(`❌ User endpoint failed: ${error.response?.status} ${error.response?.statusText}`);
    }

    // Test 2: Try organization-specific endpoint
    console.log('\n2️⃣ Testing organization endpoint...');
    try {
      const orgResponse = await axios.get(`https://sentry.io/api/0/organizations/${orgSlug}/`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
      console.log('✅ Organization endpoint successful');
      console.log(`   Organization: ${orgResponse.data.name}`);
    } catch (error: any) {
      console.log(`❌ Organization endpoint failed: ${error.response?.status} ${error.response?.statusText}`);
      if (error.response?.data) {
        console.log(`   Error: ${JSON.stringify(error.response.data)}`);
      }
    }

    // Test 3: Try projects endpoint with different URL patterns
    console.log('\n3️⃣ Testing projects endpoint...');
    
    // Try the organization projects endpoint
    try {
      const projectsResponse = await axios.get(`https://sentry.io/api/0/organizations/${orgSlug}/projects/`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
      console.log('✅ Organization projects endpoint successful');
      console.log(`   Found ${projectsResponse.data.length} projects`);
      
      if (projectsResponse.data.length > 0) {
        console.log('   Projects:');
        projectsResponse.data.slice(0, 3).forEach((project: any) => {
          console.log(`     - ${project.slug} (${project.name})`);
        });
      }
    } catch (error: any) {
      console.log(`❌ Organization projects endpoint failed: ${error.response?.status} ${error.response?.statusText}`);
    }

    // Test 4: Try a simple issues endpoint
    console.log('\n4️⃣ Testing issues endpoint...');
    try {
      const issuesResponse = await axios.get(`https://sentry.io/api/0/organizations/${orgSlug}/issues/`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
        params: {
          limit: 5,
          statsPeriod: '24h',
        },
      });
      console.log('✅ Issues endpoint successful');
      console.log(`   Found ${issuesResponse.data.length} issues`);
    } catch (error: any) {
      console.log(`❌ Issues endpoint failed: ${error.response?.status} ${error.response?.statusText}`);
    }

    // Test 5: Check token type and permissions
    console.log('\n5️⃣ Analyzing token type...');
    if (authToken.startsWith('sntrys_')) {
      console.log('📌 Token type: Organization Auth Token');
      console.log('   Note: Organization auth tokens have limited permissions');
      console.log('   They cannot access /api/0/organizations/ endpoint');
      console.log('   Use project-specific endpoints instead');
    } else if (authToken.startsWith('sntryu_')) {
      console.log('📌 Token type: User Auth Token');
    } else {
      console.log('📌 Token type: Unknown or Internal Integration');
    }

    console.log('\n💡 Recommendations:');
    console.log('   - For CI/CD and source maps: Use Organization Auth Tokens');
    console.log('   - For full API access: Create an Internal Integration');
    console.log('   - Organization auth tokens cannot list organizations');
    console.log('   - Use the exact project slugs in your configuration');

  } catch (error: any) {
    console.error('\n❌ Unexpected error:', error.message);
  }
}

// Run the test
testSentryAuth().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 