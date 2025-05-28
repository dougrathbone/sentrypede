import dotenv from 'dotenv';
import { logger } from '../utils/logger';

// Load environment variables
dotenv.config();

export interface SentryConfig {
  authToken: string;
  organizationSlug: string;
  projectSlugs: string[];
  environments: string[];
  pollIntervalMs: number;
  oauth?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scope: string[];
  };
}

export interface SlackConfig {
  botToken: string;
  appToken: string;
  channelId: string;
  signingSecret: string;
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
}

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  defaultBranch: string;
}

export interface AppConfig {
  nodeEnv: string;
  logLevel: string;
  port: number;
  sentry: SentryConfig;
  slack: SlackConfig;
  gemini: GeminiConfig;
  github: GitHubConfig;
}

function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

function getOptionalEnvVar(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

function getArrayEnvVar(name: string, defaultValue: string[] = []): string[] {
  const value = process.env[name];
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (value === '') {
    return [];
  }
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function getNumberEnvVar(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    logger.warn(`Invalid number for ${name}: ${value}, using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

export function loadConfig(): AppConfig {
  try {
    const config: AppConfig = {
      nodeEnv: getOptionalEnvVar('NODE_ENV', 'development'),
      logLevel: getOptionalEnvVar('LOG_LEVEL', 'info'),
      port: getNumberEnvVar('PORT', 3000),
      
      sentry: {
        authToken: getRequiredEnvVar('SENTRY_AUTH_TOKEN'),
        organizationSlug: getRequiredEnvVar('SENTRY_ORG_SLUG'),
        projectSlugs: getArrayEnvVar('SENTRY_PROJECT_SLUGS', []),
        environments: getArrayEnvVar('SENTRY_ENVIRONMENTS', ['production']),
        pollIntervalMs: getNumberEnvVar('SENTRY_POLL_INTERVAL_MS', 60000), // 1 minute default
        ...(process.env.SENTRY_OAUTH_CLIENT_ID && {
          oauth: {
            clientId: getRequiredEnvVar('SENTRY_OAUTH_CLIENT_ID'),
            clientSecret: getRequiredEnvVar('SENTRY_OAUTH_CLIENT_SECRET'),
            redirectUri: getOptionalEnvVar('SENTRY_OAUTH_REDIRECT_URI', 'http://localhost:3000/oauth/callback'),
            scope: getArrayEnvVar('SENTRY_OAUTH_SCOPE', ['project:read', 'org:read', 'event:read']),
          },
        }),
      },
      
      slack: {
        botToken: getRequiredEnvVar('SLACK_BOT_TOKEN'),
        appToken: getRequiredEnvVar('SLACK_APP_TOKEN'),
        channelId: getRequiredEnvVar('SLACK_CHANNEL_ID'),
        signingSecret: getRequiredEnvVar('SLACK_SIGNING_SECRET'),
      },
      
      gemini: {
        apiKey: getRequiredEnvVar('GEMINI_API_KEY'),
        model: getOptionalEnvVar('GEMINI_MODEL', 'gemini-pro'),
        maxTokens: getNumberEnvVar('GEMINI_MAX_TOKENS', 4096),
      },
      
      github: {
        token: getRequiredEnvVar('GITHUB_TOKEN'),
        owner: getRequiredEnvVar('GITHUB_OWNER'),
        repo: getRequiredEnvVar('GITHUB_REPO'),
        defaultBranch: getOptionalEnvVar('GITHUB_DEFAULT_BRANCH', 'main'),
      },
    };

    // Validate configuration
    validateConfig(config);
    
    logger.info('Configuration loaded successfully', {
      nodeEnv: config.nodeEnv,
      logLevel: config.logLevel,
      sentryProjects: config.sentry.projectSlugs.length,
      sentryEnvironments: config.sentry.environments.length,
    });

    return config;
  } catch (error) {
    logger.error('Failed to load configuration', { error });
    throw error;
  }
}

function validateConfig(config: AppConfig): void {
  // Validate Sentry configuration
  if (config.sentry.projectSlugs.length === 0) {
    throw new Error('At least one Sentry project slug must be specified');
  }
  
  if (config.sentry.pollIntervalMs < 10000) {
    throw new Error('Sentry poll interval must be at least 10 seconds');
  }

  // Validate Slack configuration
  if (!config.slack.botToken.startsWith('xoxb-')) {
    throw new Error('Invalid Slack bot token format');
  }
  
  if (!config.slack.appToken.startsWith('xapp-')) {
    throw new Error('Invalid Slack app token format');
  }

  // Validate GitHub configuration
  if (!config.github.token.startsWith('ghp_') && !config.github.token.startsWith('github_pat_')) {
    logger.warn('GitHub token format may be invalid');
  }
} 