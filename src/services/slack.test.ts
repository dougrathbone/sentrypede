import { SlackService } from './slack';
import { SlackConfig } from '../config';
import { SentryIssue } from './sentry';

// Mock Slack Bolt
jest.mock('@slack/bolt', () => ({
  App: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    event: jest.fn(),
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
      postMessage: jest.fn().mockResolvedValue({ ok: true, ts: '1234567890.123456' }),
    },
  })),
}));

// Mock logger
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('SlackService', () => {
  let service: SlackService;
  let mockConfig: SlackConfig;
  let mockClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockConfig = {
      botToken: 'xoxb-test-token',
      appToken: 'xapp-test-token',
      signingSecret: 'test-secret',
      channelId: 'C1234567890',
    };

    service = new SlackService(mockConfig);
    
    // Get the mocked client
    const { WebClient } = require('@slack/web-api');
    mockClient = WebClient.mock.results[0].value;
  });

  describe('notifyNewIssue', () => {
    it('should post a clean issue notification', async () => {
      const issue = createMockIssue();
      
      const thread = await service.notifyNewIssue(issue);

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: mockConfig.channelId,
          text: expect.stringContaining('New error in Test Project'),
          blocks: expect.arrayContaining([
            expect.objectContaining({ type: 'header' }),
            expect.objectContaining({ type: 'section' }),
          ]),
          unfurl_links: false,
        })
      );

      expect(thread).toEqual({
        issueId: issue.id,
        channelId: mockConfig.channelId,
        threadTs: '1234567890.123456',
        createdAt: expect.any(Date),
        status: 'processing',
      });
    });

    it('should handle missing tags gracefully', async () => {
      const issue = createMockIssue();
      issue.tags = [];

      await service.notifyNewIssue(issue);

      const call = mockClient.chat.postMessage.mock.calls[0][0];
      expect(call.blocks[1].text.text).toContain('unknown'); // environment
    });
  });

  describe('updateStatus', () => {
    it('should post status update with smart emoji', async () => {
      const issue = createMockIssue();
      await service.notifyNewIssue(issue);

      await service.updateStatus(issue.id, 'Analyzing the error...');

      expect(mockClient.chat.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          thread_ts: '1234567890.123456',
          text: expect.stringContaining('🔍 Analyzing the error...'),
        })
      );
    });

    it('should include details when provided', async () => {
      const issue = createMockIssue();
      await service.notifyNewIssue(issue);

      await service.updateStatus(issue.id, 'Fetching data', 'Retrieved 5 events');

      expect(mockClient.chat.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Retrieved 5 events'),
        })
      );
    });

    it('should handle missing thread gracefully', async () => {
      await service.updateStatus('unknown-id', 'Test');
      
      // Should log warning but not throw
      expect(mockClient.chat.postMessage).not.toHaveBeenCalled();
    });
  });

  describe('postAnalysis', () => {
    it('should post clean analysis results', async () => {
      const issue = createMockIssue();
      await service.notifyNewIssue(issue);

      await service.postAnalysis(issue.id, {
        summary: 'Null reference error',
        cause: 'Missing validation',
        suggestion: 'Add null check',
        confidence: 0.85,
      });

      expect(mockClient.chat.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          text: '🔍 Analysis Complete',
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('Null reference error'),
              }),
            }),
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('Add null check'),
              }),
            }),
          ]),
        })
      );
    });

    it('should show correct confidence emoji', async () => {
      const issue = createMockIssue();
      await service.notifyNewIssue(issue);

      // High confidence
      await service.postAnalysis(issue.id, {
        summary: 'Test',
        cause: 'Test',
        suggestion: 'Test',
        confidence: 0.9,
      });

      let call = mockClient.chat.postMessage.mock.calls[1][0];
      expect(call.blocks[0].text.text).toContain('🟢');

      // Low confidence
      await service.postAnalysis(issue.id, {
        summary: 'Test',
        cause: 'Test',
        suggestion: 'Test',
        confidence: 0.3,
      });

      call = mockClient.chat.postMessage.mock.calls[2][0];
      expect(call.blocks[0].text.text).toContain('🔴');
    });
  });

  describe('notifySuccess', () => {
    it('should post success with PR link', async () => {
      const issue = createMockIssue();
      await service.notifyNewIssue(issue);

      await service.notifySuccess(
        issue.id,
        'https://github.com/test/pr/123',
        'Fixed null reference'
      );

      expect(mockClient.chat.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          text: '✅ Fix created successfully!',
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('Fixed null reference'),
              }),
              accessory: expect.objectContaining({
                type: 'button',
                text: expect.objectContaining({
                  text: 'Review PR',
                }),
                url: 'https://github.com/test/pr/123',
              }),
            }),
          ]),
        })
      );
    });

    it('should update thread status', async () => {
      const issue = createMockIssue();
      await service.notifyNewIssue(issue);

      await service.notifySuccess(issue.id, 'https://github.com/test/pr/123');

      const thread = service.getThread(issue.id);
      expect(thread?.status).toBe('success');
    });
  });

  describe('notifyFailure', () => {
    it('should post failure with suggestions', async () => {
      const issue = createMockIssue();
      await service.notifyNewIssue(issue);

      await service.notifyFailure(
        issue.id,
        'Unable to analyze minified code',
        ['Enable source maps', 'Check error boundaries']
      );

      expect(mockClient.chat.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          text: '❌ Unable to create automated fix',
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('Enable source maps'),
              }),
            }),
            expect.objectContaining({
              type: 'actions',
              elements: expect.arrayContaining([
                expect.objectContaining({
                  text: expect.objectContaining({
                    text: 'View in Sentry',
                  }),
                }),
              ]),
            }),
          ]),
        })
      );
    });

    it('should work without suggestions', async () => {
      const issue = createMockIssue();
      await service.notifyNewIssue(issue);

      await service.notifyFailure(issue.id, 'Unknown error');

      const call = mockClient.chat.postMessage.mock.calls[1][0];
      expect(call.blocks[0].text.text).not.toContain('Next steps');
    });
  });

  describe('utility methods', () => {
    it('should format numbers correctly', async () => {
      const issue = createMockIssue();
      issue.count = '1234';
      issue.userCount = 5678;

      await service.notifyNewIssue(issue);

      const call = mockClient.chat.postMessage.mock.calls[0][0];
      const blockText = JSON.stringify(call.blocks);
      
      expect(blockText).toContain('1,234');
      expect(blockText).toContain('5,678');
    });

    it('should truncate long text', async () => {
      const issue = createMockIssue();
      issue.title = 'A'.repeat(200);

      await service.notifyNewIssue(issue);

      const call = mockClient.chat.postMessage.mock.calls[0][0];
      expect(call.text).toContain('...');
      expect(call.text.length).toBeLessThan(150);
    });

    it('should show relative time', async () => {
      const issue = createMockIssue();
      issue.firstSeen = new Date(Date.now() - 7200000).toISOString(); // 2 hours ago

      await service.notifyNewIssue(issue);

      const call = mockClient.chat.postMessage.mock.calls[0][0];
      const blockText = JSON.stringify(call.blocks);
      
      expect(blockText).toMatch(/[12]h ago/);
    });
  });

  describe('backward compatibility', () => {
    it('should support old method names', async () => {
      const issue = createMockIssue();
      
      // Old methods should still work
      await service.postIssueNotification(issue);
      await service.postProcessingStarted(issue.id);
      await service.postFixSuccess(issue.id, 'https://github.com/pr');
      
      expect(mockClient.chat.postMessage).toHaveBeenCalledTimes(3);
    });
  });

  describe('event handlers', () => {
    it('should handle status command', async () => {
      const { App } = require('@slack/bolt');
      const mockApp = App.mock.results[0].value;
      
      // Get the event handler
      const handler = mockApp.event.mock.calls.find(
        (call: any) => call[0] === 'app_mention'
      )[1];

      const mockSay = jest.fn();
      await handler({
        event: { text: '@Sentrypede status', ts: '123' },
        say: mockSay,
      });

      expect(mockSay).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Current Status'),
        })
      );
    });
  });
});

function createMockIssue(id = 'test-123'): SentryIssue {
  return {
    id,
    title: 'Test Error',
    culprit: 'app.js',
    permalink: 'https://sentry.io/test',
    shortId: 'TEST-123',
    status: 'unresolved',
    level: 'error',
    count: '100',
    userCount: 10,
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    project: {
      id: '1',
      name: 'Test Project',
      slug: 'test-project',
    },
    metadata: {
      type: 'Error',
      value: 'Test error',
    },
    tags: [
      { key: 'environment', value: 'production' },
    ],
  };
} 