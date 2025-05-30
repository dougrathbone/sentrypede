import { GitHubService } from './services/github';
import { loadConfig } from './config';
import { logger } from './utils/logger';

async function testGitHubIntegration() {
  logger.info('Starting GitHub integration test...');

  try {
    const config = loadConfig();
    const githubService = new GitHubService(config.github);

    // Test 1: Get repository info
    logger.info('Test 1: Getting repository information...');
    const repo = await githubService.getRepository();
    logger.info('Repository info:', {
      name: repo.name,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      language: repo.language,
    });

    // Test 2: Check if we can access the default branch
    logger.info('Test 2: Checking default branch access...');
    const branchExists = await githubService.branchExists(repo.default_branch);
    logger.info(`Default branch "${repo.default_branch}" exists:`, branchExists);

    // Test 3: List files in root directory
    logger.info('Test 3: Listing files in root directory...');
    const files = await githubService.listFiles('');
    logger.info('Files found:', files.slice(0, 5)); // Show first 5 files

    // Test 4: Get README content
    logger.info('Test 4: Getting README content...');
    const readmeContent = await githubService.getFileContent('README.md');
    if (readmeContent) {
      logger.info('README.md found, length:', readmeContent.length);
    } else {
      logger.warn('README.md not found');
    }

    // Test 5: Search for code
    logger.info('Test 5: Searching for code...');
    const searchResults = await githubService.searchCode('function');
    logger.info('Search results:', searchResults.slice(0, 3));

    // Test 6: Create a test branch (optional - requires write permissions)
    const testBranchName = `test/github-integration-${Date.now()}`;
    logger.info(`Test 6: Creating test branch "${testBranchName}"...`);
    
    try {
      await githubService.createBranch(testBranchName);
      logger.info('Test branch created successfully');

      // Clean up - delete the test branch
      logger.info('Cleaning up test branch...');
      await githubService.deleteBranch(testBranchName);
      logger.info('Test branch deleted');
    } catch (error: any) {
      if (error.status === 403) {
        logger.warn('Skipping branch creation test - insufficient permissions');
      } else {
        throw error;
      }
    }

    logger.info('✅ All GitHub integration tests passed!');
    logger.info('GitHub integration is properly configured.');

  } catch (error: any) {
    logger.error('❌ GitHub integration test failed:', error);
    
    if (error.status === 401) {
      logger.error('Authentication failed. Please check your GITHUB_TOKEN.');
    } else if (error.status === 404) {
      logger.error('Repository not found. Please check GITHUB_OWNER and GITHUB_REPO.');
    } else if (error.status === 403) {
      logger.error('Permission denied. Your token may not have sufficient permissions.');
      logger.info('Required permissions: repo (full control of private repositories)');
    } else {
      logger.error('Error details:', {
        message: error.message,
        status: error.status,
        response: error.response?.data,
      });
    }
    
    process.exit(1);
  }
}

// Run the test
testGitHubIntegration().catch((error) => {
  logger.error('Unexpected error:', error);
  process.exit(1);
}); 