import { SlackService, SlackThread } from './slack';
import { SlackConfig } from '../config';
import { SentryIssue } from './sentry';

// Mock Slack Bolt
jest.mock('@slack/bolt', () => ({
  App: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    stop: jest.fn(),
    event: jest.fn(),
    message: jest.fn(),
    error: jest.fn(),
  })),
  LogLevel: {
    DEBUG: 'debug',
    INFO: 'info',
  },
}));

// Mock Slack Web API
jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => ({
    chat: {
      postMessage: jest.fn(),
    },
  })),
}));

describe('SlackService', () => {
  let slackService: SlackService;
  let mockConfig: SlackConfig;
  let mockWebClient: any;
  let mockApp: any;

  beforeEach(() => {
    mockConfig = {
      botToken: 'xoxb-test-bot-token',
      appToken: 'xapp-test-app-token',
      channelId: 'C1234567890',
      signingSecret: 'test-signing-secret',
    };

    // Reset mocks
    jest.clearAllMocks();

    // Get mocked instances
    const { App } = require('@slack/bolt');
    const { WebClient } = require('@slack/web-api');

    mockApp = {
      start: jest.fn(),
      stop: jest.fn(),
      event: jest.fn(),
      message: jest.fn(),
      error: jest.fn(),
    };

    mockWebClient = {
      chat: {
        postMessage: jest.fn(),
      },
    };

    App.mockReturnValue(mockApp);
    WebClient.mockReturnValue(mockWebClient);

    slackService = new SlackService(mockConfig);
  });

  describe('constructor', () => {
    it('should initialize Slack app with correct configuration', () => {
      const { App } = require('@slack/bolt');
      
      expect(App).toHaveBeenCalledWith({
        token: 'xoxb-test-bot-token',
        appToken: 'xapp-test-app-token',
        signingSecret: 'test-signing-secret',
        socketMode: true,
        logLevel: 'info',
      });
    });
  });

  describe('start', () => {
    it('should start the Slack app successfully', async () => {
      mockApp.start.mockResolvedValue(undefined);

      await slackService.start();

      expect(mockApp.start).toHaveBeenCalled();
    });

    it('should handle start errors', async () => {
      const error = new Error('Failed to start');
      mockApp.start.mockRejectedValue(error);

      await expect(slackService.start()).rejects.toThrow('Failed to start');
    });
  });

  describe('stop', () => {
    it('should stop the Slack app successfully', async () => {
      mockApp.stop.mockResolvedValue(undefined);

      await slackService.stop();

      expect(mockApp.stop).toHaveBeenCalled();
    });

    it('should handle stop errors', async () => {
      const error = new Error('Failed to stop');
      mockApp.stop.mockRejectedValue(error);

      await expect(slackService.stop()).rejects.toThrow('Failed to stop');
    });
  });

  describe('postIssueNotification', () => {
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

    it('should post issue notification and return thread info', async () => {
      const mockResponse = {
        ok: true,
        ts: '1234567890.123456',
      };

      mockWebClient.chat.postMessage.mockResolvedValue(mockResponse);

      const result = await slackService.postIssueNotification(mockIssue);

      expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: 'C1234567890',
        text: '🚨 New Sentry Issue: Test Error',
        blocks: expect.any(Array),
      });

      expect(result).toEqual({
        issueId: '123',
        channelId: 'C1234567890',
        threadTs: '1234567890.123456',
        createdAt: expect.any(Date),
      });

      // Verify thread is stored
      const thread = slackService.getThread('123');
      expect(thread).toBeDefined();
      expect(thread?.threadTs).toBe('1234567890.123456');
    });

    it('should handle Slack API errors', async () => {
      const mockResponse = {
        ok: false,
        error: 'channel_not_found',
      };

      mockWebClient.chat.postMessage.mockResolvedValue(mockResponse);

      await expect(slackService.postIssueNotification(mockIssue)).rejects.toThrow(
        'Failed to post message: channel_not_found'
      );
    });

    it('should handle missing timestamp in response', async () => {
      const mockResponse = {
        ok: true,
        ts: undefined,
      };

      mockWebClient.chat.postMessage.mockResolvedValue(mockResponse);

      await expect(slackService.postIssueNotification(mockIssue)).rejects.toThrow(
        'Failed to post message: undefined'
      );
    });
  });

  describe('postThreadUpdate', () => {
    beforeEach(() => {
      // Setup a thread first
      const thread: SlackThread = {
        issueId: '123',
        channelId: 'C1234567890',
        threadTs: '1234567890.123456',
        createdAt: new Date(),
      };
      (slackService as any).threads.set('123', thread);
    });

    it('should post update to existing thread', async () => {
      const mockResponse = {
        ok: true,
        ts: '1234567890.123457',
      };

      mockWebClient.chat.postMessage.mockResolvedValue(mockResponse);

      await slackService.postThreadUpdate('123', 'Test update message');

      expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: 'C1234567890',
        thread_ts: '1234567890.123456',
        text: 'Test update message',
        blocks: undefined,
      });
    });

    it('should handle missing thread', async () => {
      await expect(slackService.postThreadUpdate('nonexistent', 'Test message')).rejects.toThrow(
        'No thread found for issue nonexistent'
      );
    });

    it('should handle Slack API errors', async () => {
      const mockResponse = {
        ok: false,
        error: 'thread_not_found',
      };

      mockWebClient.chat.postMessage.mockResolvedValue(mockResponse);

      await expect(slackService.postThreadUpdate('123', 'Test message')).rejects.toThrow(
        'Failed to post thread update: thread_not_found'
      );
    });
  });

  describe('postFixSuccess', () => {
    beforeEach(() => {
      // Setup a thread first
      const thread: SlackThread = {
        issueId: '123',
        channelId: 'C1234567890',
        threadTs: '1234567890.123456',
        createdAt: new Date(),
      };
      (slackService as any).threads.set('123', thread);
    });

    it('should post success message with PR link', async () => {
      const mockResponse = { ok: true, ts: '1234567890.123457' };
      mockWebClient.chat.postMessage.mockResolvedValue(mockResponse);

      const prUrl = 'https://github.com/owner/repo/pull/123';
      await slackService.postFixSuccess('123', prUrl);

      expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: 'C1234567890',
        thread_ts: '1234567890.123456',
        text: '✅ Sentrypede has created a potential fix!',
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining(prUrl),
            }),
          }),
          expect.objectContaining({
            type: 'actions',
            elements: expect.arrayContaining([
              expect.objectContaining({
                url: prUrl,
              }),
            ]),
          }),
        ]),
      });
    });
  });

  describe('postFixFailure', () => {
    beforeEach(() => {
      // Setup a thread first
      const thread: SlackThread = {
        issueId: '123',
        channelId: 'C1234567890',
        threadTs: '1234567890.123456',
        createdAt: new Date(),
      };
      (slackService as any).threads.set('123', thread);
    });

    it('should post failure message with reason and Sentry link', async () => {
      const mockResponse = { ok: true, ts: '1234567890.123457' };
      mockWebClient.chat.postMessage.mockResolvedValue(mockResponse);

      const reason = 'Unable to parse stack trace';
      const sentryUrl = 'https://sentry.io/issue/123';
      
      await slackService.postFixFailure('123', reason, sentryUrl);

      expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: 'C1234567890',
        thread_ts: '1234567890.123456',
        text: '❌ Sentrypede was unable to create a fix',
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining(reason),
            }),
          }),
          expect.objectContaining({
            type: 'actions',
            elements: expect.arrayContaining([
              expect.objectContaining({
                url: sentryUrl,
              }),
            ]),
          }),
        ]),
      });
    });
  });

  describe('postProcessingStarted', () => {
    beforeEach(() => {
      // Setup a thread first
      const thread: SlackThread = {
        issueId: '123',
        channelId: 'C1234567890',
        threadTs: '1234567890.123456',
        createdAt: new Date(),
      };
      (slackService as any).threads.set('123', thread);
    });

    it('should post processing started message', async () => {
      const mockResponse = { ok: true, ts: '1234567890.123457' };
      mockWebClient.chat.postMessage.mockResolvedValue(mockResponse);

      await slackService.postProcessingStarted('123');

      expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: 'C1234567890',
        thread_ts: '1234567890.123456',
        text: '🔄 Sentrypede is analyzing this issue...',
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('analyzing this issue'),
            }),
          }),
        ]),
      });
    });
  });

  describe('thread management', () => {
    it('should return undefined for non-existent thread', () => {
      const thread = slackService.getThread('nonexistent');
      expect(thread).toBeUndefined();
    });

    it('should return all threads', () => {
      const thread1: SlackThread = {
        issueId: '123',
        channelId: 'C1234567890',
        threadTs: '1234567890.123456',
        createdAt: new Date(),
      };

      const thread2: SlackThread = {
        issueId: '456',
        channelId: 'C1234567890',
        threadTs: '1234567890.123457',
        createdAt: new Date(),
      };

      (slackService as any).threads.set('123', thread1);
      (slackService as any).threads.set('456', thread2);

      const allThreads = slackService.getAllThreads();
      expect(allThreads).toHaveLength(2);
      expect(allThreads).toContain(thread1);
      expect(allThreads).toContain(thread2);
    });

    it('should clear all threads', () => {
      (slackService as any).threads.set('123', {});
      (slackService as any).threads.set('456', {});

      expect(slackService.getAllThreads()).toHaveLength(2);

      slackService.clearThreads();

      expect(slackService.getAllThreads()).toHaveLength(0);
    });
  });
}); 