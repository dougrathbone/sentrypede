import {
  SlackMessageBuilderService, 
  truncateText, // Keep truncateText if it's still exported and used by tests directly
} from './slack-message.builder'; // Updated path
import { SentryIssue, SentryEvent } from './sentry';
import { TemplateService } from './template.service';

// Mock TemplateService
jest.mock('./template.service');

const mockSentryIssue: SentryIssue = {
  id: '123',
  title: 'TypeError: Cannot read property \'foo\' of undefined',
  shortId: 'FRONTEND-123',
  status: 'unresolved',
  culprit: 'src/app.js in functionX',
  permalink: 'https://sentry.io/issues/123',
  level: 'error',
  project: { id: '1', name: 'Frontend', slug: 'frontend' },
  count: '1500',
  userCount: 120,
  firstSeen: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  lastSeen: new Date().toISOString(),
  metadata: {
    type: 'TypeError',
    value: 'Cannot read property \'foo\' of undefined. This happened because bar was not properly initialized.',
  },
  tags: [
    { key: 'environment', value: 'production' },
    { key: 'browser', value: 'Chrome 100' },
  ],
};

const mockSentryEvent: SentryEvent = {
  id: 'evt123',
  message: 'Mock event for TypeError',
  platform: 'javascript',
  entries: [
    {
      type: 'exception',
      data: {
        values: [
          {
            stacktrace: {
              frames: [
                { filename: 'node_modules/lib.js', lineno: 10, function: 'internalFunc' },
                { filename: 'src/app.js', lineno: 42, function: 'functionX' },
              ],
            },
          },
        ],
      },
    },
  ],
  tags: [],
  timestamp: new Date(Date.now()).toISOString(),
  context: {},
};

const mockAnalysis = {
  summary: 'Null pointer exception due to uninitialized variable.',
  cause: 'Variable \'bar\' was not initialized before use in functionX.',
  suggestion: 'Initialize \'bar\' with a default value or ensure it is passed correctly.',
  confidence: 0.85,
};

describe('SlackMessageBuilderService', () => {
  let messageBuilder: SlackMessageBuilderService;
  let mockTemplateService: jest.Mocked<TemplateService>;

  beforeEach(() => {
    // Create a new instance of the mocked TemplateService for each test
    // The mockImplementation will be set on TemplateService.prototype.render
    // by jest.mock('./template.service') if setup correctly
    mockTemplateService = new TemplateService() as jest.Mocked<TemplateService>; 
    
    // Configure the mock render method for TemplateService instance used by builder
    // This requires TemplateService constructor to be simple or also mocked if it does file IO.
    // For simplicity, we assume TemplateService is already mocked via jest.mock()
    // and its render method can be spied on or specifically mocked here.
    (TemplateService as jest.MockedClass<typeof TemplateService>).mockImplementation(() => mockTemplateService);

    messageBuilder = new SlackMessageBuilderService();
    
    // Default mock for render to return the template name and stringified data
    // Individual tests can override this for specific template names.
    mockTemplateService.render.mockImplementation((templateName: string, data?: any) => {
      if (templateName === 'initial-issue-blocks-header') return `HEADER: ${data.severityEmoji} ${data.level_uppercase}: ${data.metadata.type}`;
      if (templateName === 'initial-issue-blocks-summary-section') return `SUMMARY_SECTION: ${data.title} - ${data.summaryLines}`;
      if (templateName === 'initial-issue-blocks-culprit-section') return `CULPRIT_SECTION: ${data.culprit}`;
      if (templateName === 'initial-issue-blocks-metadata-section') return `METADATA_SECTION: ${data.metadata.value}`;
      if (templateName === 'initial-issue-blocks-stackframe-context') return `STACKFRAME: ${data.filename}:${data.lineno} in ${data.functionName}`;
      if (templateName === 'initial-issue-fallback') return `FALLBACK: ${data.level} in ${data.project.name}: ${data.title}`;
      if (templateName === 'analysis-report-main-section') return `ANALYSIS: ${data.summary} - ${data.confidencePercentage}%`;
      if (templateName === 'analysis-report-suggestion-section') return `SUGGESTION: ${data.suggestion}`;
      if (templateName === 'analysis-report-fallback') return 'ANALYSIS_FALLBACK';
      if (templateName === 'success-main-section') return `SUCCESS: ${data.prUrl}${data.summaryOptional}`;
      if (templateName === 'success-fallback') return 'SUCCESS_FALLBACK';
      if (templateName === 'failure-main-section') return `FAILURE: ${data.reason}${data.nextStepsOptional}`;
      if (templateName === 'failure-fallback') return 'FAILURE_FALLBACK';
      if (templateName === 'status-update') return `STATUS: ${data.emoji} ${data.status}${data.detailsOptional}`;
      if (templateName === 'agent-status') return `AGENT_STATUS: Active: ${data.active}`;
      if (templateName === 'agent-help') return 'AGENT_HELP';
      if (templateName === 'agent-default-reply') return 'AGENT_DEFAULT_REPLY';
      return `[${templateName} with ${JSON.stringify(data)}]`;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Initial Issue Message', () => {
    it('should create initial issue blocks correctly', () => {
      const blocks = messageBuilder.createInitialIssueBlocks(mockSentryIssue, mockSentryEvent);
      expect(blocks).toBeInstanceOf(Array);
      expect(blocks.length).toBeGreaterThan(3); // Header, Summary, Culprit, Metadata, Stack, Divider, Actions
      expect(blocks[0].type).toBe('header');
      expect((blocks[0] as any).text.text).toContain('TypeError');
      expect((blocks[1] as any).text.text).toContain(truncateText(mockSentryIssue.title, 150));
      expect(JSON.stringify(blocks)).toContain('src/app.js:42');
    });

    it('should generate correct fallback text for initial issue', () => {
      const text = messageBuilder.getInitialIssueFallbackText(mockSentryIssue);
      expect(text).toBe(`FALLBACK: error in Frontend: ${truncateText(mockSentryIssue.title, 100)}`);
    });
  });

  describe('Analysis Report Message', () => {
    it('should create analysis report blocks correctly', () => {
      const blocks = messageBuilder.createAnalysisReportBlocks(mockAnalysis);
      expect(blocks).toBeInstanceOf(Array);
      expect(blocks.length).toBe(2);
      expect((blocks[0]as any).text.text).toContain(mockAnalysis.summary);
      expect((blocks[0]as any).text.text).toContain('85%');
      expect((blocks[1]as any).text.text).toContain(mockAnalysis.suggestion);
    });

    it('should generate correct fallback text for analysis report', () => {
      const text = messageBuilder.getAnalysisReportFallbackText();
      expect(text).toBe('ANALYSIS_FALLBACK');
    });
  });

  describe('Success Message', () => {
    it('should create success blocks with PR URL and summary', () => {
      const blocks = messageBuilder.createSuccessBlocks('https://github.com/pr/1', 'Fixed the null pointer.');
      expect(blocks[0].type).toBe('section');
      expect((blocks[0]as any).text.text).toContain('https://github.com/pr/1');
      expect((blocks[0]as any).text.text).toContain('Fixed the null pointer.');
    });

    it('should generate correct fallback text for success', () => {
      const text = messageBuilder.getSuccessFallbackText();
      expect(text).toBe('SUCCESS_FALLBACK');
    });
  });

  describe('Failure Message', () => {
    it('should create failure blocks with reason, permalink, and suggestions', () => {
      const blocks = messageBuilder.createFailureBlocks('AI could not determine fix', mockSentryIssue.permalink, ['Check logs', 'Retry']);
      expect(blocks.length).toBe(2);
      expect((blocks[0]as any).text.text).toContain('AI could not determine fix');
      expect((blocks[0]as any).text.text).toContain('Check logs');
    });

    it('should generate correct fallback text for failure', () => {
      const text = messageBuilder.getFailureFallbackText();
      expect(text).toBe('FAILURE_FALLBACK');
    });
  });

  describe('Status Message Text', () => {
    it('should create status message text with details', () => {
      const text = messageBuilder.createStatusMessageText('Analyzing issue', 'Fetching details...');
      expect(text).toBe('STATUS: 🔍 Analyzing issue\nFetching details...');
    });

    it('should create status message text without details', () => {
      const text = messageBuilder.createStatusMessageText('Tests complete');
      expect(text).toBe('STATUS: 🧪 Tests complete');
    });
  });

  describe('Agent Interaction Messages', () => {
    it('should create agent status message', () => {
      const msg = messageBuilder.createAgentStatusMessage({ active: 2, fixed: 5, failed: 1 });
      expect(msg.text).toContain('AGENT_STATUS: Active: 2');
    });

    it('should create help message', () => {
      const msg = messageBuilder.createHelpMessage();
      expect(msg.text).toBe('AGENT_HELP');
    });

    it('should create default reply', () => {
      const msg = messageBuilder.createDefaultReply();
      expect(msg.text).toBe('AGENT_DEFAULT_REPLY');
    });
  });
}); 