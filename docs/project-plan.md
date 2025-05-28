# Sentrypede Project Plan

## Project Overview
Building an automated Slack agent that monitors Sentry for new errors, attempts to fix them using AI (Google Gemini), and creates pull requests for human review.

## Development Progress

### Phase 1: Foundation & Configuration ✅ (In Progress)
- [x] Project structure setup
- [x] Configuration management system
- [x] Environment variable handling
- [x] Basic logging setup
- [x] Package.json and dependencies

### Phase 2: Slack Integration ✅ (Completed)
- [x] Slack Bot Token setup
- [x] Slack API client configuration
- [x] Message posting functionality
- [x] Thread management for updates
- [x] Error handling for Slack operations

### Phase 3: Sentry Integration ✅ (Completed)
- [x] Sentry API client setup (basic auth token)
- [x] OAuth connection flow for Sentry
- [x] Issue monitoring and polling
- [x] Issue filtering and deduplication
- [x] Context extraction from Sentry alerts
- [x] Rate limiting and error handling

### Phase 4: Core Agent Logic ✅ (Completed)
- [x] Main worker loop
- [x] Issue processing pipeline
- [x] State management for processed issues
- [x] Retry mechanisms
- [x] Graceful shutdown handling

### Phase 5: AI Integration (Google Gemini)
- [ ] Gemini API client setup
- [ ] Code analysis prompts
- [ ] Fix generation logic
- [ ] Response parsing and validation
- [ ] Error handling for AI failures

### Phase 6: GitHub Integration
- [ ] GitHub API client setup
- [ ] Repository cloning/checkout
- [ ] Branch creation and management
- [ ] File modification logic
- [ ] Pull request creation

### Phase 7: Testing & Unit Test Generation
- [ ] Test runner integration
- [ ] Unit test generation with AI
- [ ] Test execution and validation
- [ ] Test result reporting

### Phase 8: Deployment & Production
- [ ] Docker containerization
- [ ] AWS Lambda deployment option
- [ ] Production configuration
- [ ] Monitoring and observability
- [ ] Documentation

## Today's Goals (Current Session) ✅
1. ✅ Create project structure and plan
2. ✅ Set up package.json with dependencies
3. ✅ Create configuration management system
4. ✅ Build Slack agent worker foundation
5. ✅ Implement Sentry monitoring (basic auth)
6. ✅ Add OAuth connection flow for Sentry
7. ✅ Write comprehensive unit tests for OAuth flow
8. ✅ Test all components

## Session Progress Log
- Reviewed existing codebase structure
- Found that basic Slack and Sentry services are already implemented
- Slack service has comprehensive functionality including thread management
- Sentry service uses auth token approach, needs OAuth implementation
- Configuration management is already set up
- Need to add OAuth flow for Sentry as requested

### OAuth Implementation Summary
- Created `SentryOAuthService` with full OAuth 2.0 flow support
  - Authorization URL generation with state parameter
  - Authorization code exchange for access token
  - Automatic token refresh before expiration
  - Token revocation support
  - Express server for handling OAuth callbacks
- Created `SentryServiceFactory` to handle both auth token and OAuth approaches
  - Seamless switching between auth methods based on configuration
  - Automatic token refresh on 401 errors
  - Proxy pattern for lazy initialization
- Updated `SentryAgent` to support OAuth flow
  - Detects when OAuth is required and posts to Slack
  - Waits for authorization with timeout
  - Posts success message when authorized
- Added `postMessage` method to SlackService for general messages
- Comprehensive unit tests for all new functionality (21 tests for OAuth, 5 for factory)
- All 85 tests passing

### CI/CD Implementation Summary
- Created GitHub Actions workflows:
  - **CI Workflow** (`.github/workflows/ci.yml`):
    - Multi-version testing (Node.js 18.x and 20.x)
    - Linting with ESLint
    - Unit tests with coverage reporting
    - Security scanning (npm audit and Snyk)
    - Docker image building and pushing
  - **Release Workflow** (`.github/workflows/release.yml`):
    - Automated GitHub releases on version tags
    - npm package publishing
    - Docker image versioning
- Added Dependabot configuration for automated dependency updates
- Created production-ready Dockerfile with:
  - Multi-stage build for smaller images
  - Non-root user for security
  - Proper signal handling with dumb-init
- Updated documentation with CI/CD details and badges

## Notes
- Using TypeScript on Node.js as specified
- Focus on modular, testable architecture
- Comprehensive error handling and logging
- Security-first approach for API credentials
- OAuth implementation will provide better security and user experience
- The OAuth flow is optional - can still use direct auth tokens if preferred
- CI/CD pipeline ensures code quality and automated deployments
