import { GeminiService } from './gemini';
import { GeminiConfig } from '../config';
import { SentryIssue, SentryEvent } from './sentry';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Mock Google Generative AI
jest.mock('@google/generative-ai');

// Mock logger
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('GeminiService', () => {
  let service: GeminiService;
  let mockConfig: GeminiConfig;
  let mockModel: any;
  let mockGenAI: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfig = {
      apiKey: 'test-api-key',
      model: 'gemini-pro',
      maxTokens: 4096,
    };

    // Mock the model
    mockModel = {
      generateContent: jest.fn(),
    };

    // Mock the GoogleGenerativeAI instance
    mockGenAI = {
      getGenerativeModel: jest.fn().mockReturnValue(mockModel),
    };

    (GoogleGenerativeAI as jest.MockedClass<typeof GoogleGenerativeAI>).mockImplementation(() => mockGenAI);

    service = new GeminiService(mockConfig);
  });

  describe('testConnection', () => {
    it('should return true when connection is successful', async () => {
      mockModel.generateContent.mockResolvedValue({
        response: {
          text: () => 'Hello, Sentrypede!',
        },
      });

      const result = await service.testConnection();

      expect(result).toBe(true);
      expect(mockModel.generateContent).toHaveBeenCalledWith('Say "Hello, Sentrypede!"');
    });

    it('should return false when connection fails', async () => {
      mockModel.generateContent.mockRejectedValue(new Error('API error'));

      const result = await service.testConnection();

      expect(result).toBe(false);
    });
  });

  describe('analyzeAndFix', () => {
    const mockIssue: SentryIssue = {
      id: '123',
      title: 'TypeError: Cannot read property \'name\' of undefined',
      culprit: 'app.js in handleUser',
      permalink: 'https://sentry.io/issue/123',
      shortId: 'TEST-123',
      status: 'unresolved',
      level: 'error',
      count: '100',
      userCount: 50,
      firstSeen: '2024-01-01T00:00:00Z',
      lastSeen: '2024-01-01T01:00:00Z',
      project: { id: '1', name: 'Test Project', slug: 'test-project' },
      metadata: { type: 'TypeError', value: 'Cannot read property \'name\' of undefined' },
      tags: [],
    };

    const mockEvent: SentryEvent = {
      id: 'event-123',
      message: 'TypeError: Cannot read property \'name\' of undefined',
      platform: 'javascript',
      timestamp: '2024-01-01T01:00:00Z',
      tags: [],
      context: {},
      entries: [
        {
          type: 'exception',
          data: {
            values: [{
              type: 'TypeError',
              value: 'Cannot read property \'name\' of undefined',
              stacktrace: {
                frames: [
                  {
                    function: 'handleUser',
                    filename: 'app.js',
                    lineno: 42,
                    colno: 15,
                  },
                ],
              },
            }],
          },
        },
      ],
    };

    it('should analyze and generate fixes successfully', async () => {
      // Mock analysis response
      mockModel.generateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({
            summary: 'Null reference error in user handler',
            rootCause: 'User object is undefined',
            suggestedFix: 'Add null check before accessing user.name',
            confidence: 0.85,
            affectedFiles: ['app.js'],
            explanation: 'The user object may be undefined when accessed',
          }),
        },
      });

      // Mock fix generation
      mockModel.generateContent.mockResolvedValueOnce({
        response: {
          text: () => '```javascript\nfunction handleUser(user) {\n  if (!user || !user.name) {\n    return "Unknown user";\n  }\n  return user.name;\n}\n```',
        },
      });

      // Mock test generation
      mockModel.generateContent.mockResolvedValueOnce({
        response: {
          text: () => '```javascript\ntest("handles undefined user", () => {\n  expect(handleUser(undefined)).toBe("Unknown user");\n});\n```',
        },
      });

      const codeContext = {
        'app.js': 'function handleUser(user) {\n  return user.name;\n}',
      };

      const result = await service.analyzeAndFix(mockIssue, mockEvent, codeContext);

      expect(result.analysis.summary).toBe('Null reference error in user handler');
      expect(result.analysis.confidence).toBe(0.85);
      expect(result.fixes).toHaveLength(1);
      expect(result.fixes[0].filePath).toBe('app.js');
      // The fix detection logic identifies different types of changes
      expect(result.fixes[0].changes.length).toBeGreaterThan(0);
      expect(result.fixes[0].changes.some(change => 
        change.includes('Added') || change.includes('Modified')
      )).toBe(true);
      expect(result.testCode).toContain('handles undefined user');
      expect(result.pullRequestDescription).toContain('AI-Generated Fix');
    });

    it('should handle analysis failure gracefully', async () => {
      mockModel.generateContent.mockRejectedValue(new Error('API error'));

      await expect(service.analyzeAndFix(mockIssue, mockEvent)).rejects.toThrow('API error');
    });

    it('should work without event data', async () => {
      mockModel.generateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({
            summary: 'Error analysis',
            rootCause: 'Unknown',
            suggestedFix: 'Manual investigation needed',
            confidence: 0.3,
            affectedFiles: [],
            explanation: 'Limited information available',
          }),
        },
      });

      const result = await service.analyzeAndFix(mockIssue, null);

      expect(result.analysis.confidence).toBe(0.3);
      expect(result.fixes).toHaveLength(0);
    });

    it('should handle malformed analysis response', async () => {
      mockModel.generateContent.mockResolvedValueOnce({
        response: {
          text: () => 'This is not JSON',
        },
      });

      const result = await service.analyzeAndFix(mockIssue, mockEvent);

      expect(result.analysis.summary).toBe('Failed to analyze error');
      expect(result.analysis.confidence).toBe(0.1);
    });
  });

  describe('code fix generation', () => {
    it('should identify various types of changes', async () => {
      const mockIssue: SentryIssue = createMockIssue();
      const mockEvent: SentryEvent = createMockEvent();

      // Mock responses
      mockModel.generateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({
            summary: 'Multiple improvements needed',
            rootCause: 'Missing error handling',
            suggestedFix: 'Add comprehensive error handling',
            confidence: 0.9,
            affectedFiles: ['app.js'],
            explanation: 'Code needs better error handling',
          }),
        },
      });

      mockModel.generateContent.mockResolvedValueOnce({
        response: {
          text: () => `\`\`\`javascript
async function fetchData(id) {
  try {
    const response = await fetch(\`/api/data/\${id}\`);
    const data = await response?.json() ?? {};
    return data?.result || null;
  } catch (error) {
    console.error('Failed to fetch data:', error);
    return null;
  }
}
\`\`\``,
        },
      });

      const codeContext = {
        'app.js': 'async function fetchData(id) {\n  const response = await fetch(`/api/data/${id}`);\n  return response.json();\n}',
      };

      const result = await service.analyzeAndFix(mockIssue, mockEvent, codeContext);

      expect(result.fixes[0].changes).toContain('Added try-catch error handling');
      expect(result.fixes[0].changes).toContain('Added optional chaining');
      expect(result.fixes[0].changes).toContain('Added nullish coalescing');
    });

    it('should skip files without code context', async () => {
      const mockIssue: SentryIssue = createMockIssue();

      mockModel.generateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({
            summary: 'Error in multiple files',
            rootCause: 'Missing validation',
            suggestedFix: 'Add validation',
            confidence: 0.7,
            affectedFiles: ['file1.js', 'file2.js', 'file3.js'],
            explanation: 'Multiple files affected',
          }),
        },
      });

      // Only provide context for one file
      const codeContext = {
        'file1.js': 'function test() { return true; }',
      };

      // Mock fix for file1.js
      mockModel.generateContent.mockResolvedValueOnce({
        response: {
          text: () => '```javascript\nfunction test() { return false; }\n```',
        },
      });

      const result = await service.analyzeAndFix(mockIssue, null, codeContext);

      expect(result.fixes).toHaveLength(1);
      expect(result.fixes[0].filePath).toBe('file1.js');
    });
  });

  describe('pull request description', () => {
    it('should generate comprehensive PR description', async () => {
      const mockIssue: SentryIssue = createMockIssue();

      mockModel.generateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({
            summary: 'Database connection error',
            rootCause: 'Connection timeout not handled',
            suggestedFix: 'Add timeout handling',
            confidence: 0.95,
            affectedFiles: ['db.js'],
            explanation: 'The database connection can timeout and needs proper handling',
          }),
        },
      });

      mockModel.generateContent.mockResolvedValueOnce({
        response: {
          text: () => '```javascript\nfunction connect() {\n  // Fixed code\n}\n```',
        },
      });

      const codeContext = {
        'db.js': 'function connect() {\n  // Original code\n}',
      };

      const result = await service.analyzeAndFix(mockIssue, null, codeContext);

      expect(result.pullRequestDescription).toContain('AI-Generated Fix');
      expect(result.pullRequestDescription).toContain(mockIssue.id);
      expect(result.pullRequestDescription).toContain('95%');
      expect(result.pullRequestDescription).toContain('db.js');
      expect(result.pullRequestDescription).toContain('Database connection error');
    });
  });

  describe('edge cases', () => {
    it('should handle empty affected files', async () => {
      const mockIssue: SentryIssue = createMockIssue();

      mockModel.generateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({
            summary: 'General error',
            rootCause: 'Unknown',
            suggestedFix: 'Investigation needed',
            confidence: 0.2,
            affectedFiles: [],
            explanation: 'Cannot determine affected files',
          }),
        },
      });

      const result = await service.analyzeAndFix(mockIssue, null);

      expect(result.fixes).toHaveLength(0);
      expect(result.testCode).toBeUndefined();
    });

    it('should handle code that does not need changes', async () => {
      const mockIssue: SentryIssue = createMockIssue();

      mockModel.generateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({
            summary: 'False positive',
            rootCause: 'No issue found',
            suggestedFix: 'No changes needed',
            confidence: 0.1,
            affectedFiles: ['app.js'],
            explanation: 'Code appears correct',
          }),
        },
      });

      // Return same code
      mockModel.generateContent.mockResolvedValueOnce({
        response: {
          text: () => '```javascript\nfunction test() { return true; }\n```',
        },
      });

      const codeContext = {
        'app.js': 'function test() { return true; }',
      };

      const result = await service.analyzeAndFix(mockIssue, null, codeContext);

      expect(result.fixes).toHaveLength(0);
    });
  });
});

function createMockIssue(): SentryIssue {
  return {
    id: 'test-123',
    title: 'Test Error',
    culprit: 'test.js',
    permalink: 'https://sentry.io/test',
    shortId: 'TEST-123',
    status: 'unresolved',
    level: 'error',
    count: '10',
    userCount: 5,
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
    tags: [],
  };
}

function createMockEvent(): SentryEvent {
  return {
    id: 'event-123',
    message: 'Test error',
    platform: 'javascript',
    timestamp: new Date().toISOString(),
    tags: [],
    context: {},
    entries: [
      {
        type: 'exception',
        data: {
          values: [{
            type: 'Error',
            value: 'Test error',
            stacktrace: {
              frames: [{
                function: 'testFunction',
                filename: 'test.js',
                lineno: 10,
                colno: 5,
              }],
            },
          }],
        },
      },
      {
        type: 'breadcrumbs',
        data: {
          values: [
            {
              category: 'navigation',
              message: 'User clicked button',
            },
          ],
        },
      },
    ],
  };
} 