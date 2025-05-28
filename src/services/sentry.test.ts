import axios from 'axios';
import { SentryService, SentryIssue, SentryEvent } from './sentry';
import { SentryConfig } from '../config';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SentryService', () => {
  let sentryService: SentryService;
  let mockConfig: SentryConfig;

  beforeEach(() => {
    mockConfig = {
      authToken: 'test-token',
      organizationSlug: 'test-org',
      projectSlugs: ['project1', 'project2'],
      environments: ['production', 'staging'],
      pollIntervalMs: 60000,
    };

    // Reset mocks
    jest.clearAllMocks();
    
    // Mock axios.create
    const mockAxiosInstance = {
      get: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any);

    sentryService = new SentryService(mockConfig);
  });

  describe('constructor', () => {
    it('should create axios instance with correct configuration', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'https://sentry.io/api/0',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
    });
  });

  describe('fetchRecentIssues', () => {
    it('should fetch issues for all configured projects', async () => {
      const mockIssues1: SentryIssue[] = [
        {
          id: '1',
          title: 'Test Error 1',
          culprit: 'test.js',
          permalink: 'https://sentry.io/issue/1',
          shortId: 'TEST-1',
          status: 'unresolved',
          level: 'error',
          count: '10',
          userCount: 5,
          firstSeen: '2024-01-01T00:00:00Z',
          lastSeen: '2024-01-01T01:00:00Z',
          project: { id: '1', name: 'Project 1', slug: 'project1' },
          metadata: { type: 'TypeError', value: 'Cannot read property' },
          tags: [{ key: 'environment', value: 'production' }],
        },
      ];

      const mockIssues2: SentryIssue[] = [
        {
          id: '2',
          title: 'Test Error 2',
          culprit: 'test2.js',
          permalink: 'https://sentry.io/issue/2',
          shortId: 'TEST-2',
          status: 'unresolved',
          level: 'error',
          count: '5',
          userCount: 2,
          firstSeen: '2024-01-01T00:00:00Z',
          lastSeen: '2024-01-01T01:00:00Z',
          project: { id: '2', name: 'Project 2', slug: 'project2' },
          metadata: { type: 'ReferenceError', value: 'Variable not defined' },
          tags: [{ key: 'environment', value: 'staging' }],
        },
      ];

      const mockAxiosInstance = (sentryService as any).client;
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: mockIssues1 })
        .mockResolvedValueOnce({ data: mockIssues2 });

      const result = await sentryService.fetchRecentIssues();

      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/projects/test-org/project1/issues/',
        expect.objectContaining({
          params: expect.objectContaining({
            statsPeriod: '1h',
            sort: 'date',
            limit: 25,
          }),
        })
      );
      expect(result).toEqual([...mockIssues1, ...mockIssues2]);
    });

    it('should handle API errors gracefully', async () => {
      const mockAxiosInstance = (sentryService as any).client;
      mockAxiosInstance.get.mockRejectedValue(new Error('API Error'));

      await expect(sentryService.fetchRecentIssues()).rejects.toThrow('API Error');
    });
  });

  describe('getIssueDetails', () => {
    it('should fetch issue details by ID', async () => {
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

      const mockAxiosInstance = (sentryService as any).client;
      mockAxiosInstance.get.mockResolvedValue({ data: mockIssue });

      const result = await sentryService.getIssueDetails('123');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/issues/123/');
      expect(result).toEqual(mockIssue);
    });
  });

  describe('getLatestEvent', () => {
    it('should fetch latest event for an issue', async () => {
      const mockEvent: SentryEvent = {
        id: 'event-123',
        message: 'Test error message',
        platform: 'javascript',
        timestamp: '2024-01-01T00:00:00Z',
        tags: [{ key: 'environment', value: 'production' }],
        entries: [
          {
            type: 'exception',
            data: {
              values: [
                {
                  stacktrace: {
                    frames: [
                      {
                        filename: '/path/to/file.js',
                        function: 'testFunction',
                        lineno: 10,
                        colno: 5,
                        context_line: 'const x = undefined.property;',
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
        context: {},
      };

      const mockAxiosInstance = (sentryService as any).client;
      mockAxiosInstance.get.mockResolvedValue({ data: mockEvent });

      const result = await sentryService.getLatestEvent('123');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/issues/123/events/latest/');
      expect(result).toEqual(mockEvent);
    });
  });

  describe('extractStackTrace', () => {
    it('should extract stack trace from event', () => {
      const mockEvent: SentryEvent = {
        id: 'event-123',
        message: 'Test error',
        platform: 'javascript',
        timestamp: '2024-01-01T00:00:00Z',
        tags: [],
        entries: [
          {
            type: 'exception',
            data: {
              values: [
                {
                  stacktrace: {
                    frames: [
                      {
                        filename: '/path/to/file.js',
                        function: 'testFunction',
                        lineno: 10,
                        colno: 5,
                        context_line: 'const x = undefined.property;',
                      },
                      {
                        filename: '/path/to/another.js',
                        function: 'anotherFunction',
                        lineno: 20,
                        colno: 10,
                        context_line: 'testFunction();',
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
        context: {},
      };

      const result = sentryService.extractStackTrace(mockEvent);

      expect(result).toContain('at anotherFunction (another.js:20:10)');
      expect(result).toContain('at testFunction (file.js:10:5)');
      expect(result).toContain('testFunction();');
      expect(result).toContain('const x = undefined.property;');
    });

    it('should return null for events without stack trace', () => {
      const mockEvent: SentryEvent = {
        id: 'event-123',
        message: 'Test error',
        platform: 'javascript',
        timestamp: '2024-01-01T00:00:00Z',
        tags: [],
        entries: [],
        context: {},
      };

      const result = sentryService.extractStackTrace(mockEvent);

      expect(result).toBeNull();
    });
  });

  describe('shouldProcessIssue', () => {
    const createMockIssue = (overrides: Partial<SentryIssue> = {}): SentryIssue => ({
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
      ...overrides,
    });

    it('should process unresolved error-level issues in configured environments', () => {
      const issue = createMockIssue();
      const result = sentryService.shouldProcessIssue(issue);
      expect(result).toBe(true);
    });

    it('should not process already processed issues', () => {
      const issue = createMockIssue();
      sentryService.markAsProcessed(issue.id);
      
      const result = sentryService.shouldProcessIssue(issue);
      expect(result).toBe(false);
    });

    it('should not process resolved issues', () => {
      const issue = createMockIssue({ status: 'resolved' });
      const result = sentryService.shouldProcessIssue(issue);
      expect(result).toBe(false);
    });

    it('should not process non-error level issues', () => {
      const issue = createMockIssue({ level: 'warning' });
      const result = sentryService.shouldProcessIssue(issue);
      expect(result).toBe(false);
    });

    it('should process fatal level issues', () => {
      const issue = createMockIssue({ level: 'fatal' });
      const result = sentryService.shouldProcessIssue(issue);
      expect(result).toBe(true);
    });

    it('should not process issues from unconfigured environments', () => {
      const issue = createMockIssue({
        tags: [{ key: 'environment', value: 'development' }],
      });
      const result = sentryService.shouldProcessIssue(issue);
      expect(result).toBe(false);
    });
  });

  describe('markAsProcessed', () => {
    it('should mark issue as processed', () => {
      const issueId = '123';
      
      expect(sentryService.getProcessedCount()).toBe(0);
      
      sentryService.markAsProcessed(issueId);
      
      expect(sentryService.getProcessedCount()).toBe(1);
      
      const issue = {
        id: issueId,
      } as SentryIssue;
      
      expect(sentryService.shouldProcessIssue(issue)).toBe(false);
    });
  });

  describe('clearProcessedCache', () => {
    it('should clear processed issues cache', () => {
      sentryService.markAsProcessed('123');
      sentryService.markAsProcessed('456');
      
      expect(sentryService.getProcessedCount()).toBe(2);
      
      sentryService.clearProcessedCache();
      
      expect(sentryService.getProcessedCount()).toBe(0);
    });
  });
}); 