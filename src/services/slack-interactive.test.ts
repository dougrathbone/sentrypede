import { InteractiveSlackService } from './slack-interactive';
import { SlackConfig } from '../config';
import { SentryIssue } from './sentry';

// Mock Slack Bolt
jest.mock('@slack/bolt', () => ({
  App: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    action: jest.fn(),
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

describe('InteractiveSlackService', () => {
  let service: InteractiveSlackService;
  let mockConfig: SlackConfig;
  let mockClient: any;
  let mockApp: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockConfig = {
      botToken: 'xoxb-test-token',
      appToken: 'xapp-test-token',
      signingSecret: 'test-secret',
      channelId: 'C1234567890',
    };

    service = new InteractiveSlackService(mockConfig);
    
    // Get the mocked client and app
    const { WebClient } = require('@slack/web-api');
    const { App } = require('@slack/bolt');
    mockClient = WebClient.mock.results[0].value;
    mockApp = App.mock.results[0].value;
  });

  describe('notifyNewIssue', () => {
    it('should post interactive issue notification with priority and action buttons', async () => {
      const issue = createMockIssue();
      
      const thread = await service.notifyNewIssue(issue);

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: mockConfig.channelId,
          text: expect.stringContaining('🟡 New error in Test Project'),
          blocks: expect.arrayContaining([
            expect.objectContaining({ type: 'header' }),
            expect.objectContaining({ type: 'section' }),
            expect.objectContaining({ 
              type: 'actions',
              block_id: `issue_actions_${issue.id}`,
              elements: expect.arrayContaining([
                expect.objectContaining({
                  action_id: 'fix_now',
                  text: { type: 'plain_text', text: '🚀 Fix Now' },
                }),
                expect.objectContaining({
                  action_id: 'show_details',
                  text: { type: 'plain_text', text: '🔍 Details' },
                }),
                expect.objectContaining({
                  action_id: 'escalate',
                  text: { type: 'plain_text', text: '⚠️ Escalate' },
                }),
                expect.objectContaining({
                  action_id: 'ignore',
                  text: { type: 'plain_text', text: '🙈 Ignore' },
                }),
              ]),
            }),
          ]),
          unfurl_links: false,
        })
      );

      expect(thread).toEqual({
        issueId: issue.id,
        channelId: mockConfig.channelId,
        threadTs: '1234567890.123456',
        createdAt: expect.any(Date),
        status: 'new',
        priority: 'medium',
        interactionHistory: [],
      });
    });

    it('should calculate priority correctly based on issue severity', async () => {
      // Critical priority
      const criticalIssue = createMockIssue();
      criticalIssue.level = 'fatal';
      criticalIssue.userCount = 150;

      await service.notifyNewIssue(criticalIssue);
      const criticalThread = service.getThread(criticalIssue.id);
      expect(criticalThread?.priority).toBe('critical');

      // High priority
      const highIssue = createMockIssue('high-test');
      highIssue.level = 'error';
      highIssue.userCount = 75;
      highIssue.count = '600';

      await service.notifyNewIssue(highIssue);
      const highThread = service.getThread(highIssue.id);
      expect(highThread?.priority).toBe('high');

      // Low priority
      const lowIssue = createMockIssue('low-test');
      lowIssue.level = 'warning';
      lowIssue.userCount = 2;
      lowIssue.count = '5';

      await service.notifyNewIssue(lowIssue);
      const lowThread = service.getThread(lowIssue.id);
      expect(lowThread?.priority).toBe('low');
    });
  });

  describe('interactive actions', () => {
    beforeEach(async () => {
      // Create an issue to work with
      const issue = createMockIssue();
      await service.notifyNewIssue(issue);
    });

    it('should setup action handlers', () => {
      expect(mockApp.action).toHaveBeenCalledWith('fix_now', expect.any(Function));
      expect(mockApp.action).toHaveBeenCalledWith('show_details', expect.any(Function));
      expect(mockApp.action).toHaveBeenCalledWith('escalate', expect.any(Function));
      expect(mockApp.action).toHaveBeenCalledWith('ignore', expect.any(Function));
      expect(mockApp.action).toHaveBeenCalledWith('show_dashboard', expect.any(Function));
    });

    it('should handle fix_now action', async () => {
      const fixNowHandler = mockApp.action.mock.calls.find(
        (call: any) => call[0] === 'fix_now'
      )[1];

      const mockAck = jest.fn();
      const mockBody = {
        actions: [{ value: 'test-123' }],
        user: { id: 'U123456' },
        channel: { id: 'C1234567890' },
        message: { ts: '1234567890.123456' },
      };

      await fixNowHandler({
        ack: mockAck,
        body: mockBody,
        client: mockClient,
        logger: { info: jest.fn() },
      });

      expect(mockAck).toHaveBeenCalled();
      
      const thread = service.getThread('test-123');
      expect(thread?.status).toBe('analyzing');
      expect(thread?.assignedTo).toBe('U123456');
      expect(thread?.interactionHistory).toHaveLength(1);
      expect(thread?.interactionHistory[0].action).toBe('fix_now');
    });

    it('should handle escalate action', async () => {
      const escalateHandler = mockApp.action.mock.calls.find(
        (call: any) => call[0] === 'escalate'
      )[1];

      const mockAck = jest.fn();
      const mockBody = {
        actions: [{ value: 'test-123' }],
        user: { id: 'U123456' },
        channel: { id: 'C1234567890' },
        message: { ts: '1234567890.123456' },
      };

      await escalateHandler({
        ack: mockAck,
        body: mockBody,
        client: mockClient,
      });

      expect(mockAck).toHaveBeenCalled();
      
      const thread = service.getThread('test-123');
      expect(thread?.status).toBe('escalated');
      expect(thread?.priority).toBe('critical');
      expect(thread?.interactionHistory).toHaveLength(1);
      expect(thread?.interactionHistory[0].action).toBe('escalate');

      // Should post escalation message
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '⚠️ Issue escalated by <@U123456>',
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('Issue Escalated'),
              }),
            }),
          ]),
        })
      );
    });

    it('should handle ignore action', async () => {
      const ignoreHandler = mockApp.action.mock.calls.find(
        (call: any) => call[0] === 'ignore'
      )[1];

      const mockAck = jest.fn();
      const mockBody = {
        actions: [{ value: 'test-123' }],
        user: { id: 'U123456' },
        channel: { id: 'C1234567890' },
        message: { ts: '1234567890.123456' },
      };

      await ignoreHandler({
        ack: mockAck,
        body: mockBody,
        client: mockClient,
      });

      expect(mockAck).toHaveBeenCalled();
      
      const thread = service.getThread('test-123');
      expect(thread?.status).toBe('ignored');
      expect(thread?.interactionHistory).toHaveLength(1);
      expect(thread?.interactionHistory[0].action).toBe('ignore');
    });

    it('should handle show_details action', async () => {
      const detailsHandler = mockApp.action.mock.calls.find(
        (call: any) => call[0] === 'show_details'
      )[1];

      const mockAck = jest.fn();
      const mockBody = {
        actions: [{ value: 'test-123' }],
        user: { id: 'U123456' },
        channel: { id: 'C1234567890' },
        message: { ts: '1234567890.123456' },
      };

      await detailsHandler({
        ack: mockAck,
        body: mockBody,
        client: mockClient,
      });

      expect(mockAck).toHaveBeenCalled();
      
      const thread = service.getThread('test-123');
      expect(thread?.interactionHistory).toHaveLength(1);
      expect(thread?.interactionHistory[0].action).toBe('show_details');

      // Should post detailed analysis
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '🔍 Detailed Issue Analysis',
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: 'header',
              text: { type: 'plain_text', text: '🔍 Detailed Issue Analysis' },
            }),
          ]),
        })
      );
    });

    it('should handle missing data gracefully in actions', async () => {
      const fixNowHandler = mockApp.action.mock.calls.find(
        (call: any) => call[0] === 'fix_now'
      )[1];

      const mockAck = jest.fn();
      const mockBody = {
        actions: [{ value: undefined }],
        user: { id: 'U123456' },
        channel: undefined,
        message: { ts: '1234567890.123456' },
      };

      await fixNowHandler({
        ack: mockAck,
        body: mockBody,
        client: mockClient,
        logger: { info: jest.fn(), error: jest.fn() },
      });

      expect(mockAck).toHaveBeenCalled();
      // Should not proceed with the action due to missing data
      const thread = service.getThread('test-123');
      expect(thread?.status).toBe('new'); // Should remain unchanged
    });
  });

  describe('dashboard functionality', () => {
    beforeEach(async () => {
      // Create some test issues with different statuses
      const issue1 = createMockIssue('issue-1');
      const issue2 = createMockIssue('issue-2');
      const issue3 = createMockIssue('issue-3');

      await service.notifyNewIssue(issue1);
      await service.notifyNewIssue(issue2);
      await service.notifyNewIssue(issue3);

      // Simulate some status changes
      await service.notifySuccess('issue-1', 'https://github.com/test/pr/1');
      await service.notifyFailure('issue-2', 'Unable to parse minified code');
    });

    it('should show dashboard with metrics', async () => {
      await service.showDashboard('main', 'U123456', 'C1234567890');

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '📊 Sentrypede Dashboard',
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: 'header',
              text: { type: 'plain_text', text: '📊 Sentrypede Dashboard' },
            }),
            expect.objectContaining({
              type: 'section',
              fields: expect.arrayContaining([
                expect.objectContaining({
                  text: expect.stringContaining('Total Issues Today:'),
                }),
                expect.objectContaining({
                  text: expect.stringContaining('Successful Fixes:'),
                }),
                expect.objectContaining({
                  text: expect.stringContaining('Success Rate:'),
                }),
                expect.objectContaining({
                  text: expect.stringContaining('Average Fix Time:'),
                }),
              ]),
            }),
          ]),
        })
      );
    });

    it('should handle dashboard action', async () => {
      const dashboardHandler = mockApp.action.mock.calls.find(
        (call: any) => call[0] === 'show_dashboard'
      )[1];

      const mockAck = jest.fn();
      const mockBody = {
        actions: [{ value: 'main' }],
        user: { id: 'U123456' },
        channel: { id: 'C1234567890' },
      };

      await dashboardHandler({
        ack: mockAck,
        body: mockBody,
        client: mockClient,
      });

      expect(mockAck).toHaveBeenCalled();
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '📊 Sentrypede Dashboard',
        })
      );
    });

    it('should calculate metrics correctly', () => {
      const metrics = service.getMetrics();
      
      expect(metrics.totalIssues).toBe(3);
      expect(metrics.resolvedToday).toBe(1); // issue-1 was successful
      expect(typeof metrics.successRate).toBe('number');
      expect(typeof metrics.averageFixTime).toBe('number');
    });
  });

  describe('enhanced commands', () => {
    it('should handle app mentions with dashboard command', async () => {
      const mentionHandler = mockApp.event.mock.calls.find(
        (call: any) => call[0] === 'app_mention'
      )[1];

      const mockSay = jest.fn();
      await mentionHandler({
        event: { 
          text: '@Sentrypede dashboard please', 
          user: 'U123456',
          channel: 'C1234567890',
          ts: '123'
        },
        say: mockSay,
      });

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '📊 Sentrypede Dashboard',
        })
      );
    });

    it('should handle app mentions with status command', async () => {
      const mentionHandler = mockApp.event.mock.calls.find(
        (call: any) => call[0] === 'app_mention'
      )[1];

      const mockSay = jest.fn();
      await mentionHandler({
        event: { 
          text: '@Sentrypede status', 
          user: 'U123456',
          channel: 'C1234567890',
          ts: '123'
        },
        say: mockSay,
      });

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '📊 Current Status',
        })
      );
    });

    it('should handle app mentions with help command', async () => {
      const mentionHandler = mockApp.event.mock.calls.find(
        (call: any) => call[0] === 'app_mention'
      )[1];

      const mockSay = jest.fn();
      await mentionHandler({
        event: { 
          text: '@Sentrypede help', 
          user: 'U123456',
          channel: 'C1234567890',
          ts: '123'
        },
        say: mockSay,
      });

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '🤖 Sentrypede Help',
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('Interactive Features'),
              }),
            }),
          ]),
        })
      );
    });
  });

  describe('backward compatibility', () => {
    beforeEach(async () => {
      const issue = createMockIssue();
      await service.notifyNewIssue(issue);
    });

    it('should support notifySuccess method', async () => {
      await service.notifySuccess('test-123', 'https://github.com/test/pr/123', 'Fixed null reference');

      const thread = service.getThread('test-123');
      expect(thread?.status).toBe('success');
      expect(thread?.interactionHistory).toContainEqual(
        expect.objectContaining({
          action: 'success',
          userId: 'system',
          metadata: {
            prUrl: 'https://github.com/test/pr/123',
            summary: 'Fixed null reference',
          },
        })
      );

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '✅ Fix created successfully!',
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('Fixed null reference'),
              }),
            }),
          ]),
        })
      );
    });

    it('should support notifyFailure method with retry options', async () => {
      await service.notifyFailure('test-123', 'Unable to parse minified code', ['Enable source maps']);

      const thread = service.getThread('test-123');
      expect(thread?.status).toBe('failed');
      expect(thread?.interactionHistory).toContainEqual(
        expect.objectContaining({
          action: 'failed',
          userId: 'system',
        })
      );

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
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
                  text: { type: 'plain_text', text: '🚀 Retry Fix' },
                  action_id: 'retry_fix',
                }),
              ]),
            }),
          ]),
        })
      );
    });

    it('should support updateStatus method', async () => {
      await service.updateStatus('test-123', 'Analyzing code patterns');

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('🔍 Analyzing code patterns'),
        })
      );
    });
  });

  describe('detailed issue blocks', () => {
    it('should create detailed blocks with stack trace and breadcrumbs', async () => {
      const issue = createMockIssue();
      const event = createMockEvent();
      
      await service.notifyNewIssue(issue, event);
      
      // Test the details handler
      const detailsHandler = mockApp.action.mock.calls.find(
        (call: any) => call[0] === 'show_details'
      )[1];

      const mockAck = jest.fn();
      const mockBody = {
        actions: [{ value: 'test-123' }],
        user: { id: 'U123456' },
        channel: { id: 'C1234567890' },
        message: { ts: '1234567890.123456' },
      };

      await detailsHandler({
        ack: mockAck,
        body: mockBody,
        client: mockClient,
      });

      const detailedCall = mockClient.chat.postMessage.mock.calls.find(
        (call: any) => call[0].text === '🔍 Detailed Issue Analysis'
      );

      expect(detailedCall).toBeDefined();
      expect(detailedCall[0].blocks).toContainEqual(
        expect.objectContaining({
          text: expect.objectContaining({
            text: expect.stringContaining('Error Details'),
          }),
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
    count: '150',
    userCount: 25,
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
      { key: 'browser', value: 'Chrome' },
    ],
  };
}

function createMockEvent(): any {
  return {
    id: 'event-123',
    message: 'Test error message',
    platform: 'javascript',
    timestamp: new Date().toISOString(),
    level: 'error',
    type: 'error',
    entries: [
      {
        type: 'exception',
        data: {
          values: [
            {
              type: 'TypeError',
              value: 'Cannot read property of null',
              stacktrace: {
                frames: [
                  {
                    filename: 'app.js',
                    lineno: 42,
                    function: 'handleClick',
                  },
                  {
                    filename: 'utils.js',
                    lineno: 15,
                    function: 'processData',
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  };
} 