import { SentryAgent } from './worker';
import { AppConfig } from '../config';
import { SentryService, SentryIssue } from '../services/sentry';
import { SlackService } from '../services/slack';
import { SentryServiceFactory } from '../services/sentry-factory';

// Mock node-cron
jest.mock('node-cron', () => ({
  schedule: jest.fn().mockReturnValue({
    start: jest.fn(),
    stop: jest.fn(),
    destroy: jest.fn(),
    nextDates: jest.fn().mockReturnValue([new Date()]),
  }),
}));

// Mock services
jest.mock('../services/sentry');
jest.mock('../services/slack');
jest.mock('../services/sentry-factory');

describe('SentryAgent', () => {
  let agent: SentryAgent;
  let mockConfig: AppConfig;
  let mockSentryService: jest.Mocked<SentryService>;
  let mockSlackService: jest.Mocked<SlackService>;

  beforeEach(() => {
    mockConfig = {
      nodeEnv: 'test',
      logLevel: 'info',
      port: 3000,
      sentry: {
        authToken: 'test-token',
        organizationSlug: 'test-org',
        projectSlugs: ['project1'],
        environments: ['production'],
        pollIntervalMs: 60000,
      },
      slack: {
        botToken: 'xoxb-test-token',
        appToken: 'xapp-test-token',
        channelId: 'C1234567890',
        signingSecret: 'test-secret',
      },
      gemini: {
        apiKey: 'test-gemini-key',
        model: 'gemini-pro',
        maxTokens: 4096,
      },
      github: {
        token: 'test-github-token',
        owner: 'test-owner',
        repo: 'test-repo',
        defaultBranch: 'main',
        enablePullRequests: true,
      },
    };

    // Reset mocks
    jest.clearAllMocks();

    // Mock service instances
    mockSentryService = {
      fetchRecentIssues: jest.fn(),
      shouldProcessIssue: jest.fn(),
      markAsProcessed: jest.fn(),
      getIssueDetails: jest.fn(),
      getLatestEvent: jest.fn(),
      extractStackTrace: jest.fn(),
      getProcessedCount: jest.fn(),
      clearProcessedCache: jest.fn(),
    } as any;

    mockSlackService = {
      start: jest.fn(),
      stop: jest.fn(),
      postIssueNotification: jest.fn(),
      postProcessingStarted: jest.fn(),
      postFixSuccess: jest.fn(),
      postFixFailure: jest.fn(),
      postThreadUpdate: jest.fn(),
      postMessage: jest.fn(),
      getThread: jest.fn(),
      getAllThreads: jest.fn(),
      clearThreads: jest.fn(),
    } as any;

    // Mock factory to return our mock service
    (SentryServiceFactory.create as jest.Mock).mockResolvedValue({
      service: mockSentryService,
      isAuthorized: () => true,
    });

    // Mock constructors
    (SlackService as jest.MockedClass<typeof SlackService>).mockImplementation(() => mockSlackService);

    agent = new SentryAgent(mockConfig);
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(SlackService).toHaveBeenCalledWith(mockConfig.slack);
      
      const stats = agent.getStats();
      expect(stats.isRunning).toBe(false);
      expect(stats.issuesProcessed).toBe(0);
      expect(stats.issuesFixed).toBe(0);
      expect(stats.issuesFailed).toBe(0);
    });
  });

  describe('start', () => {
    it('should start successfully', async () => {
      mockSlackService.start.mockResolvedValue(undefined);
      mockSentryService.fetchRecentIssues.mockResolvedValue([]);

      await agent.start();

      expect(SentryServiceFactory.create).toHaveBeenCalledWith(mockConfig.sentry);
      expect(mockSlackService.start).toHaveBeenCalled();
      
      const stats = agent.getStats();
      expect(stats.isRunning).toBe(true);
    });

    it('should handle start errors', async () => {
      const error = new Error('Failed to start Slack');
      mockSlackService.start.mockRejectedValue(error);

      await expect(agent.start()).rejects.toThrow('Failed to start Slack');
    });
  });

  describe('stop', () => {
    beforeEach(async () => {
      mockSlackService.start.mockResolvedValue(undefined);
      mockSentryService.fetchRecentIssues.mockResolvedValue([]);
      await agent.start();
    });

    it('should stop successfully', async () => {
      mockSlackService.stop.mockResolvedValue(undefined);

      await agent.stop();

      expect(mockSlackService.stop).toHaveBeenCalled();
      
      const stats = agent.getStats();
      expect(stats.isRunning).toBe(false);
    });

    it('should handle stop errors', async () => {
      const error = new Error('Failed to stop Slack');
      mockSlackService.stop.mockRejectedValue(error);

      await expect(agent.stop()).rejects.toThrow('Failed to stop Slack');
    });
  });

  describe('pollSentryIssues', () => {
    const mockIssue: SentryIssue = {
      id: '123',
      title: 'Test Error',
      culprit: 'test.js',
      permalink: 'https://sentry.io/issue/123',
      shortId: 'TEST-123',
      status: 'unresolved',
      level: 'error',
      count: '10',
      userCount: 5,
      firstSeen: '2024-01-01T00:00:00Z',
      lastSeen: '2024-01-01T01:00:00Z',
      project: { id: '1', name: 'Test Project', slug: 'test-project' },
      metadata: { type: 'TypeError', value: 'Cannot read property' },
      tags: [{ key: 'environment', value: 'production' }],
    };

    beforeEach(async () => {
      mockSlackService.start.mockResolvedValue(undefined);
      mockSlackService.postIssueNotification.mockResolvedValue({
        issueId: '123',
        channelId: 'C123',
        threadTs: '123.456',
        createdAt: new Date(),
        status: 'processing',
      });
      mockSlackService.postProcessingStarted.mockResolvedValue(undefined);
      mockSlackService.postFixSuccess.mockResolvedValue(undefined);
      mockSlackService.postFixFailure.mockResolvedValue(undefined);
    });

    it('should process new issues', async () => {
      mockSentryService.fetchRecentIssues.mockResolvedValue([mockIssue]);
      mockSentryService.shouldProcessIssue.mockReturnValue(true);

      // Start agent to trigger initial poll
      await agent.start();

      expect(mockSentryService.fetchRecentIssues).toHaveBeenCalled();
      expect(mockSentryService.shouldProcessIssue).toHaveBeenCalledWith(mockIssue);
      expect(mockSentryService.markAsProcessed).toHaveBeenCalledWith('123');
      expect(mockSlackService.postIssueNotification).toHaveBeenCalledWith(mockIssue);
      expect(mockSlackService.postProcessingStarted).toHaveBeenCalledWith('123');

      const stats = agent.getStats();
      expect(stats.issuesProcessed).toBe(1);
    });

    it('should skip already processed issues', async () => {
      mockSentryService.fetchRecentIssues.mockResolvedValue([mockIssue]);
      mockSentryService.shouldProcessIssue.mockReturnValue(false);

      await agent.start();

      expect(mockSentryService.shouldProcessIssue).toHaveBeenCalledWith(mockIssue);
      expect(mockSentryService.markAsProcessed).not.toHaveBeenCalled();
      expect(mockSlackService.postIssueNotification).not.toHaveBeenCalled();

      const stats = agent.getStats();
      expect(stats.issuesProcessed).toBe(0);
    });

    it('should handle fetch errors gracefully', async () => {
      const error = new Error('Sentry API error');
      mockSentryService.fetchRecentIssues.mockRejectedValue(error);

      // Should not throw, just log the error
      await agent.start();

      expect(mockSentryService.fetchRecentIssues).toHaveBeenCalled();
    });

    it('should handle processing errors gracefully', async () => {
      mockSentryService.fetchRecentIssues.mockResolvedValue([mockIssue]);
      mockSentryService.shouldProcessIssue.mockReturnValue(true);
      mockSlackService.postIssueNotification.mockRejectedValue(new Error('Slack error'));

      await agent.start();

      expect(mockSlackService.postFixFailure).toHaveBeenCalledWith(
        '123',
        'Internal processing error',
        'https://sentry.io/issue/123'
      );

      const stats = agent.getStats();
      expect(stats.issuesFailed).toBe(1);
    });
  });

  describe('getCronExpression', () => {
    it('should generate correct cron expression for different intervals', () => {
      // Test with 1 minute interval
      const config1 = { ...mockConfig };
      config1.sentry.pollIntervalMs = 60000; // 1 minute
      const agent1 = new SentryAgent(config1);
      
      // Access private method for testing
      const getCronExpression = (agent1 as any).getCronExpression.bind(agent1);
      expect(getCronExpression()).toBe('* * * * *');

      // Test with 5 minute interval
      const config5 = { ...mockConfig };
      config5.sentry.pollIntervalMs = 300000; // 5 minutes
      const agent5 = new SentryAgent(config5);
      const getCronExpression5 = (agent5 as any).getCronExpression.bind(agent5);
      expect(getCronExpression5()).toBe('*/5 * * * *');

      // Test with 2 hour interval
      const config2h = { ...mockConfig };
      config2h.sentry.pollIntervalMs = 7200000; // 2 hours
      const agent2h = new SentryAgent(config2h);
      const getCronExpression2h = (agent2h as any).getCronExpression.bind(agent2h);
      expect(getCronExpression2h()).toBe('0 */2 * * *');
    });

    it('should handle very short intervals', () => {
      const config = { ...mockConfig };
      config.sentry.pollIntervalMs = 30000; // 30 seconds
      const agent = new SentryAgent(config);
      
      const getCronExpression = (agent as any).getCronExpression.bind(agent);
      expect(getCronExpression()).toBe('* * * * *'); // Falls back to every minute
    });
  });

  describe('getStats', () => {
    it('should return current statistics', () => {
      const stats = agent.getStats();

      expect(stats).toMatchObject({
        startTime: expect.any(Date),
        issuesProcessed: 0,
        issuesFixed: 0,
        issuesFailed: 0,
        isRunning: false,
      });
    });

    it('should update statistics after processing', async () => {
      const mockIssue: SentryIssue = {
        id: '123',
        title: 'Test Error',
        culprit: 'test.js',
        permalink: 'https://sentry.io/issue/123',
        shortId: 'TEST-123',
        status: 'unresolved',
        level: 'error',
        count: '10',
        userCount: 5,
        firstSeen: '2024-01-01T00:00:00Z',
        lastSeen: '2024-01-01T01:00:00Z',
        project: { id: '1', name: 'Test Project', slug: 'test-project' },
        metadata: { type: 'TypeError', value: 'Cannot read property' },
        tags: [{ key: 'environment', value: 'production' }],
      };

      mockSlackService.start.mockResolvedValue(undefined);
      mockSentryService.fetchRecentIssues.mockResolvedValue([mockIssue]);
      mockSentryService.shouldProcessIssue.mockReturnValue(true);
      mockSlackService.postIssueNotification.mockResolvedValue({
        issueId: '123',
        channelId: 'C123',
        threadTs: '123.456',
        createdAt: new Date(),
        status: 'processing',
      });
      mockSlackService.postProcessingStarted.mockResolvedValue(undefined);
      mockSlackService.postFixSuccess.mockResolvedValue(undefined);

      await agent.start();

      const stats = agent.getStats();
      expect(stats.isRunning).toBe(true);
      expect(stats.issuesProcessed).toBe(1);
      expect(stats.lastPollTime).toBeInstanceOf(Date);
    });
  });
}); 