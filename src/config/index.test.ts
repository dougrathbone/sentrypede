import { loadConfig } from './index';

// Mock environment variables
const mockEnv = {
  SENTRY_AUTH_TOKEN: 'test-sentry-token',
  SENTRY_ORG_SLUG: 'test-org',
  SENTRY_PROJECT_SLUGS: 'project1,project2',
  SENTRY_ENVIRONMENTS: 'production,staging',
  SLACK_BOT_TOKEN: 'xoxb-test-bot-token',
  SLACK_APP_TOKEN: 'xapp-test-app-token',
  SLACK_CHANNEL_ID: 'C1234567890',
  SLACK_SIGNING_SECRET: 'test-signing-secret',
  GEMINI_API_KEY: 'test-gemini-key',
  GITHUB_TOKEN: 'ghp_test-github-token',
  GITHUB_OWNER: 'test-owner',
  GITHUB_REPO: 'test-repo',
};

describe('Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...mockEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should load configuration with all required environment variables', () => {
      const config = loadConfig();

      expect(config).toMatchObject({
        nodeEnv: 'development',
        logLevel: 'info',
        port: 3000,
        sentry: {
          authToken: 'test-sentry-token',
          organizationSlug: 'test-org',
          projectSlugs: ['project1', 'project2'],
          environments: ['production', 'staging'],
          pollIntervalMs: 60000,
        },
        slack: {
          botToken: 'xoxb-test-bot-token',
          appToken: 'xapp-test-app-token',
          channelId: 'C1234567890',
          signingSecret: 'test-signing-secret',
        },
        gemini: {
          apiKey: 'test-gemini-key',
          model: 'gemini-pro',
          maxTokens: 4096,
        },
        github: {
          token: 'ghp_test-github-token',
          owner: 'test-owner',
          repo: 'test-repo',
          defaultBranch: 'master',
        },
      });
    });

    it('should use default values for optional environment variables', () => {
      delete process.env.NODE_ENV;
      delete process.env.LOG_LEVEL;
      delete process.env.PORT;
      delete process.env.SENTRY_ENVIRONMENTS;
      delete process.env.SENTRY_POLL_INTERVAL_MS;
      delete process.env.GEMINI_MODEL;
      delete process.env.GEMINI_MAX_TOKENS;
      delete process.env.GITHUB_DEFAULT_BRANCH;

      const config = loadConfig();

      expect(config.nodeEnv).toBe('development');
      expect(config.logLevel).toBe('info');
      expect(config.port).toBe(3000);
      expect(config.sentry.environments).toEqual(['production']);
      expect(config.sentry.pollIntervalMs).toBe(60000);
      expect(config.gemini.model).toBe('gemini-pro');
      expect(config.gemini.maxTokens).toBe(4096);
      expect(config.github.defaultBranch).toBe('master');
    });

    it('should throw error for missing required environment variables', () => {
      delete process.env.SENTRY_AUTH_TOKEN;

      expect(() => loadConfig()).toThrow('Required environment variable SENTRY_AUTH_TOKEN is not set');
    });

    it('should parse array environment variables correctly', () => {
      process.env.SENTRY_PROJECT_SLUGS = 'project1, project2 , project3';
      process.env.SENTRY_ENVIRONMENTS = 'prod,staging,dev';

      const config = loadConfig();

      expect(config.sentry.projectSlugs).toEqual(['project1', 'project2', 'project3']);
      expect(config.sentry.environments).toEqual(['prod', 'staging', 'dev']);
    });

    it('should parse number environment variables correctly', () => {
      process.env.PORT = '8080';
      process.env.SENTRY_POLL_INTERVAL_MS = '30000';
      process.env.GEMINI_MAX_TOKENS = '2048';

      const config = loadConfig();

      expect(config.port).toBe(8080);
      expect(config.sentry.pollIntervalMs).toBe(30000);
      expect(config.gemini.maxTokens).toBe(2048);
    });

    it('should use default values for invalid number environment variables', () => {
      process.env.PORT = 'invalid';
      process.env.SENTRY_POLL_INTERVAL_MS = 'not-a-number';

      const config = loadConfig();

      expect(config.port).toBe(3000);
      expect(config.sentry.pollIntervalMs).toBe(60000);
    });

    it('should validate Sentry configuration', () => {
      process.env.SENTRY_PROJECT_SLUGS = '';

      expect(() => loadConfig()).toThrow('At least one Sentry project slug must be specified');
    });

    it('should validate minimum poll interval', () => {
      process.env.SENTRY_POLL_INTERVAL_MS = '5000';

      expect(() => loadConfig()).toThrow('Sentry poll interval must be at least 10 seconds');
    });

    it('should validate Slack token formats', () => {
      process.env.SLACK_BOT_TOKEN = 'invalid-bot-token';

      expect(() => loadConfig()).toThrow('Invalid Slack bot token format');
    });

    it('should validate Slack app token format', () => {
      process.env.SLACK_APP_TOKEN = 'invalid-app-token';

      expect(() => loadConfig()).toThrow('Invalid Slack app token format');
    });

    it('should handle empty array environment variables', () => {
      process.env.SENTRY_PROJECT_SLUGS = 'project1';
      process.env.SENTRY_ENVIRONMENTS = '';

      const config = loadConfig();

      expect(config.sentry.projectSlugs).toEqual(['project1']);
      expect(config.sentry.environments).toEqual([]);
    });
  });
}); 