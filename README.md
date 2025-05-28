# Sentrypede 🐛🤖

An automated Slack agent that monitors Sentry for new application errors, attempts to fix them using AI (Google Gemini), and creates pull requests for human review.

## Features

- **Automated Sentry Monitoring**: Continuously polls Sentry for new error issues
- **Intelligent Filtering**: Only processes relevant errors based on environment, severity, and status
- **Slack Integration**: Posts notifications and updates to designated Slack channels
- **AI-Powered Analysis**: Uses Google Gemini to analyze errors and generate fixes (coming soon)
- **GitHub Integration**: Creates branches and pull requests with proposed fixes (coming soon)
- **Comprehensive Testing**: Full unit test coverage with Jest
- **Production Ready**: Built with TypeScript, proper error handling, and logging

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Sentry API    │    │  Slack Bot API  │    │  GitHub API     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Sentrypede Agent                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Sentry    │  │    Slack    │  │   GitHub    │             │
│  │   Service   │  │   Service   │  │   Service   │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                           │                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Worker Agent                               │   │
│  │  • Issue polling & filtering                           │   │
│  │  • Slack notifications                                 │   │
│  │  • AI analysis & fix generation                        │   │
│  │  • GitHub PR creation                                  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Sentry account with API access
- Slack workspace with bot permissions
- GitHub account with repository access
- Google Cloud account with Gemini API access

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd sentrypede
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp env.example .env
   # Edit .env with your actual API keys and configuration
   ```

4. **Build the project**
   ```bash
   npm run build
   ```

5. **Run tests**
   ```bash
   npm test
   ```

6. **Start the agent**
   ```bash
   npm start
   ```

## Configuration

All configuration is managed through environment variables. See `env.example` for a complete list.

### Required Environment Variables

#### Sentry Configuration
- `SENTRY_AUTH_TOKEN`: Your Sentry API authentication token
- `SENTRY_ORG_SLUG`: Your Sentry organization slug
- `SENTRY_PROJECT_SLUGS`: Comma-separated list of project slugs to monitor

#### Slack Configuration
- `SLACK_BOT_TOKEN`: Your Slack bot token (starts with `xoxb-`)
- `SLACK_APP_TOKEN`: Your Slack app token (starts with `xapp-`)
- `SLACK_CHANNEL_ID`: The channel ID where notifications will be posted
- `SLACK_SIGNING_SECRET`: Your Slack app's signing secret

#### Google Gemini Configuration
- `GEMINI_API_KEY`: Your Google Gemini API key

#### GitHub Configuration
- `GITHUB_TOKEN`: Your GitHub personal access token
- `GITHUB_OWNER`: GitHub username or organization name
- `GITHUB_REPO`: Repository name where fixes will be submitted

### Optional Environment Variables

- `NODE_ENV`: Environment (development/production) - default: `development`
- `LOG_LEVEL`: Logging level (debug/info/warn/error) - default: `info`
- `PORT`: HTTP port for health checks - default: `3000`
- `SENTRY_ENVIRONMENTS`: Environments to monitor - default: `production`
- `SENTRY_POLL_INTERVAL_MS`: Polling interval in milliseconds - default: `60000`
- `GEMINI_MODEL`: Gemini model to use - default: `gemini-pro`
- `GEMINI_MAX_TOKENS`: Maximum tokens for Gemini responses - default: `4096`
- `GITHUB_DEFAULT_BRANCH`: Default branch name - default: `main`

## Development

### Project Structure

```
src/
├── agent/           # Main agent worker logic
├── config/          # Configuration management
├── services/        # External service integrations
│   ├── sentry.ts    # Sentry API client
│   ├── slack.ts     # Slack Bot integration
│   └── github.ts    # GitHub API client (coming soon)
├── utils/           # Utility functions
└── app.ts           # Application entry point
```

### Available Scripts

- `npm run dev`: Start in development mode with hot reload
- `npm run build`: Build TypeScript to JavaScript
- `npm start`: Start the production build
- `npm test`: Run all tests
- `npm run test:watch`: Run tests in watch mode
- `npm run test:coverage`: Run tests with coverage report
- `npm run lint`: Run ESLint
- `npm run lint:fix`: Fix ESLint issues automatically

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Local Development

1. **Set up test environment variables**
   ```bash
   cp env.example .env.test
   # Edit .env.test with test values
   ```

2. **Start in development mode**
   ```bash
   npm run dev
   ```

3. **Monitor logs**
   The application uses structured logging with Winston. In development mode, logs are formatted for readability.

## How It Works

### Current Implementation (Phase 1)

1. **Sentry Monitoring**: The agent polls Sentry API at configured intervals for new issues
2. **Issue Filtering**: Only processes unresolved error/fatal level issues from configured environments
3. **Slack Notifications**: Posts rich notifications to Slack with issue details and links
4. **Thread Management**: Updates the same Slack thread with progress and results
5. **Simulation**: Currently simulates the fix process with random success/failure

### Upcoming Features (Future Phases)

- **AI Analysis**: Use Google Gemini to analyze stack traces and generate code fixes
- **GitHub Integration**: Automatically create branches, apply fixes, and submit pull requests
- **Test Generation**: Generate unit tests to validate fixes
- **Advanced Filtering**: More sophisticated issue prioritization and filtering
- **Interactive Slack Commands**: Allow manual triggering and control via Slack

## API Integration Details

### Sentry API
- Uses Sentry's REST API v0
- Fetches issues with filtering by project, environment, and status
- Extracts stack traces and error context
- Implements rate limiting and error handling

### Slack Bot API
- Uses Slack Bolt framework for robust bot functionality
- Socket mode for real-time event handling
- Rich message formatting with blocks and interactive elements
- Thread-based conversation management

### GitHub API (Coming Soon)
- Repository cloning and branch management
- File modification and commit creation
- Pull request creation with detailed descriptions
- Integration with CI/CD workflows

## Monitoring and Observability

- **Structured Logging**: JSON-formatted logs with correlation IDs
- **Health Checks**: HTTP endpoint for monitoring agent status
- **Metrics**: Built-in statistics tracking (issues processed, success rate, etc.)
- **Error Handling**: Comprehensive error handling with graceful degradation

## Security Considerations

- **API Key Management**: All secrets managed via environment variables
- **Least Privilege**: API tokens configured with minimal required permissions
- **Input Validation**: Strict validation of all external API responses
- **Secure Defaults**: Safe configuration defaults and validation

## Deployment

### Docker (Recommended)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
CMD ["npm", "start"]
```

### AWS Lambda

The application is designed to work with AWS Lambda with minor modifications for the cron scheduling.

### Traditional Server

Can be deployed on any server with Node.js 18+ support. Recommended to use a process manager like PM2.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass (`npm test`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For questions, issues, or contributions, please:

1. Check the existing issues on GitHub
2. Create a new issue with detailed information
3. Join our Slack channel for discussions

---

**Sentrypede** - Making bug fixing as automated as possible! 🐛➡️🤖➡️✅ 