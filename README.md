# Sentrypede 🐛🤖

An AI-powered Slack agent that monitors Sentry for application bugs and automatically creates pull requests with fixes.

## Features

- 🔍 **Real-time Monitoring**: Continuously monitors Sentry for new errors
- 🤖 **AI-Powered Analysis**: Uses Google Gemini AI to analyze errors and generate fixes
- 💬 **Slack Integration**: Posts updates to Slack with interactive controls
- 🔧 **Automated Fixes**: Creates GitHub pull requests with code fixes
- 📊 **Smart Filtering**: Processes only relevant errors based on environment and severity
- 🔐 **OAuth Support**: Secure authentication with Sentry
- 🧪 **Test Generation**: Creates unit tests for the fixes

## How It Works

1. **Monitor**: Sentrypede polls Sentry for new unresolved errors
2. **Notify**: Posts error details to a Slack channel
3. **Analyze**: Uses Gemini AI to understand the root cause
4. **Fix**: Generates code patches to resolve the issue
5. **Submit**: Creates a pull request on GitHub with the fix
6. **Update**: Keeps the Slack thread updated with progress

## Prerequisites

- Node.js 18+ and npm
- Sentry account with Internal Integration
- Slack workspace with app permissions
- GitHub repository with write access
- Google AI API key for Gemini

## Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/sentrypede.git
   cd sentrypede
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Configure services**
   - [Sentry Setup](docs/sentry-setup.md) - Create Internal Integration
   - [Slack Setup](docs/slack-setup.md) - Configure bot and permissions
   - [GitHub Setup](docs/github-setup.md) - Generate personal access token
   - [Gemini Setup](docs/gemini-setup.md) - Get Google AI API key

5. **Run the application**
   ```bash
   npm run build
   npm start
   ```

## Configuration

### Environment Variables

```bash
# Sentry Configuration
SENTRY_AUTH_TOKEN=your-internal-integration-token
SENTRY_ORGANIZATION_SLUG=your-org
SENTRY_PROJECT_SLUGS=project1,project2
SENTRY_ENVIRONMENTS=production,staging

# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_CHANNEL_ID=C1234567890

# GitHub Configuration
GITHUB_TOKEN=ghp_your-personal-access-token
GITHUB_OWNER=your-username-or-org
GITHUB_REPO=your-repo-name
GITHUB_DEFAULT_BRANCH=main
GITHUB_ENABLE_PULL_REQUESTS=true

# Gemini AI Configuration
GEMINI_API_KEY=your-google-ai-api-key
GEMINI_MODEL=gemini-pro
GEMINI_MAX_TOKENS=4096

# Worker Configuration
WORKER_POLL_INTERVAL=60000
WORKER_ENABLED=true
```

### Development & Testing Mode

For development and testing environments, you can disable live pull request creation:

```bash
GITHUB_ENABLE_PULL_REQUESTS=false
```

When disabled, Sentrypede will simulate the PR creation workflow without making actual changes to your repository. This allows you to:
- Test the end-to-end workflow safely
- Debug fix generation without creating branches
- Run demos without affecting production repositories
- Validate configurations in staging environments

## Testing

Run the test suite:
```bash
npm test
```

Test individual integrations:
```bash
npm run test:sentry    # Test Sentry connection
npm run test:slack     # Test Slack integration
npm run test:github    # Test GitHub access
npm run test:full      # Run full integration test
```

## Development

### Project Structure

```
sentrypede/
├── src/
│   ├── config/         # Configuration management
│   ├── services/       # External service integrations
│   │   ├── sentry.ts   # Sentry API client
│   │   ├── slack.ts    # Slack bot service
│   │   ├── github.ts   # GitHub API client
│   │   └── gemini.ts   # Google Gemini AI service
│   ├── agent/          # Core worker logic
│   └── utils/          # Utilities and helpers
├── docs/               # Documentation
└── tests/              # Test files
```

### Available Scripts

- `npm run dev` - Run in development mode with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm run lint` - Run ESLint
- `npm run typecheck` - Run TypeScript type checking
- `npm test:watch` - Run tests in watch mode
- `npm test:coverage` - Generate test coverage report

## AI-Powered Analysis

Sentrypede uses Google Gemini AI to:

1. **Understand Errors**: Analyzes stack traces, error messages, and breadcrumbs
2. **Identify Root Causes**: Determines why the error occurred
3. **Generate Fixes**: Creates code patches that resolve the issue
4. **Assess Confidence**: Provides a confidence score (0-1) for each fix
5. **Write Tests**: Generates unit tests to verify the fix

### Example Fix

For a `TypeError: Cannot read property 'name' of undefined`:

**Original Code:**
```javascript
function getUserDisplayName(user) {
  return user.name || user.email;
}
```

**AI-Generated Fix:**
```javascript
function getUserDisplayName(user) {
  // Added null check to prevent TypeError
  if (!user) {
    return 'Unknown User';
  }
  return user.name || user.email || 'Unknown User';
}
```

## Slack Commands

When Sentrypede posts to Slack, team members can:

- 🔍 **View Details**: Click to see full error information
- ✅ **Mark Resolved**: Manually mark an issue as resolved
- 🔄 **Retry Fix**: Attempt to generate a fix again
- 👤 **Assign**: Assign the issue to a team member

## Security

- All credentials are stored as environment variables
- Supports OAuth 2.0 for Sentry authentication
- Uses secure token authentication for all services
- No sensitive data is logged or stored

## CI/CD

The project includes GitHub Actions workflows for:

- **Continuous Integration**: Runs on every push and PR
  - Linting and type checking
  - Unit tests across Node.js versions
  - Security vulnerability scanning
  - Docker image building

- **Release Process**: Automated releases on tags
  - Semantic versioning
  - Docker image publishing
  - GitHub release creation

## Docker Support

Build and run with Docker:

```bash
# Build the image
docker build -t sentrypede .

# Run the container
docker run --env-file .env sentrypede
```

## Troubleshooting

### Common Issues

1. **Sentry Authentication Failed**
   - Ensure you're using an Internal Integration token, not an org auth token
   - Verify the token has the required scopes

2. **Slack Not Responding**
   - Check that socket mode is enabled
   - Verify all Slack tokens are correct

3. **GitHub PR Creation Failed**
   - Ensure the PAT has `repo` scope
   - Check branch protection rules

4. **Gemini Analysis Failed**
   - Verify API key is valid
   - Check rate limits (60/min, 1500/day free tier)

### Debug Mode

Enable debug logging:
```bash
LOG_LEVEL=debug npm start
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [Slack Bolt](https://slack.dev/bolt-js)
- Powered by [Google Gemini AI](https://ai.google.dev)
- Integrates with [Sentry](https://sentry.io) and [GitHub](https://github.com)

---

Made with ❤️ by the Sentrypede team 