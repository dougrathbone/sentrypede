import { GitHubService, GitHubFile } from './services/github';
import { loadConfig } from './config';
import { logger } from './utils/logger';

async function demoGitHubIntegration() {
  logger.info('🚀 Starting GitHub Integration Demo...\n');

  try {
    const config = loadConfig();
    const github = new GitHubService(config.github);

    // Demo 1: Repository Information
    logger.info('📊 Demo 1: Getting Repository Information');
    const repo = await github.getRepository();
    logger.info('Repository:', {
      name: repo.name,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      language: repo.language,
      size: `${(repo.size / 1024).toFixed(2)} MB`,
    });

    // Demo 2: Search for Error Handling Code
    logger.info('\n🔍 Demo 2: Searching for Error Handling Patterns');
    const errorPatterns = await github.searchCode('catch (error)');
    logger.info(`Found ${errorPatterns.length} files with error handling:`);
    errorPatterns.slice(0, 3).forEach(result => {
      logger.info(`  - ${result.path}`);
    });

    // Demo 3: Simulate Creating a Fix for a Sentry Issue
    logger.info('\n🐛 Demo 3: Simulating Sentry Issue Fix');
    
    // Simulate a Sentry issue
    const mockIssue = {
      id: 'DEMO-123',
      title: 'TypeError: Cannot read property \'name\' of undefined',
      file: 'src/components/UserProfile.js',
      line: 42,
    };

    logger.info('Mock Sentry Issue:', mockIssue);

    // Check if the file exists
    const fileContent = await github.getFileContent(mockIssue.file);
    if (fileContent) {
      logger.info(`✅ Found file: ${mockIssue.file} (${fileContent.length} characters)`);
    } else {
      logger.info(`ℹ️  File not found: ${mockIssue.file} (this is expected in demo)`);
    }

    // Demo 4: Show what a fix would look like
    logger.info('\n💡 Demo 4: Example Fix Generation');
    
    const exampleFix: GitHubFile = {
      path: mockIssue.file,
      content: `// Example fix for: ${mockIssue.title}
export function UserProfile({ user }) {
  // Added null check to prevent TypeError
  if (!user || !user.name) {
    return <div>Loading user profile...</div>;
  }
  
  return (
    <div className="user-profile">
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </div>
  );
}`,
    };

    logger.info('Generated fix:');
    logger.info('```javascript');
    logger.info(exampleFix.content);
    logger.info('```');

    // Demo 5: Show PR creation process (without actually creating)
    logger.info('\n📝 Demo 5: Pull Request Creation Process');
    logger.info('When creating a real fix, Sentrypede would:');
    logger.info('1. Create branch: fix/sentry-issue-DEMO-123');
    logger.info('2. Commit the fix with message: "fix: TypeError: Cannot read property \'name\' of undefined"');
    logger.info('3. Open a PR with:');
    logger.info('   - Title: 🐛 Fix: TypeError: Cannot read property \'name\' of undefined');
    logger.info('   - Automated description with issue details');
    logger.info('   - Review instructions');
    logger.info('   - Link to Sentry issue');

    // Demo 6: List recent branches (to show existing fixes)
    logger.info('\n🌿 Demo 6: Checking for Existing Fix Branches');
    try {
      // This is a simple check - in reality, we'd list all branches
      const testBranch = 'fix/sentry-issue-TEST';
      const exists = await github.branchExists(testBranch);
      logger.info(`Branch "${testBranch}" exists: ${exists}`);
    } catch (error) {
      logger.info('Could not check branches (this is normal in demo)');
    }

    logger.info('\n✨ GitHub Integration Demo Complete!');
    logger.info('The GitHub service is ready to:');
    logger.info('  ✅ Create branches for fixes');
    logger.info('  ✅ Commit AI-generated code changes');
    logger.info('  ✅ Open pull requests for review');
    logger.info('  ✅ Add comments and updates to PRs');

  } catch (error: any) {
    logger.error('❌ Demo failed:', error);
    
    if (error.status === 401) {
      logger.error('Authentication failed. Please check your GITHUB_TOKEN.');
    } else if (error.status === 404) {
      logger.error('Repository not found. Please check GITHUB_OWNER and GITHUB_REPO.');
    } else {
      logger.error('Error details:', {
        message: error.message,
        status: error.status,
      });
    }
  }
}

// Run the demo
demoGitHubIntegration().catch((error) => {
  logger.error('Unexpected error:', error);
  process.exit(1);
}); 