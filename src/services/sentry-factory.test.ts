import { SentryServiceFactory } from './sentry-factory';
import { SentryService } from './sentry';
import { SentryOAuthService } from './sentry-oauth';
import { SentryConfig } from '../config';

// Mock dependencies
jest.mock('./sentry');
jest.mock('./sentry-oauth');
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

const MockedSentryService = SentryService as jest.MockedClass<typeof SentryService>;
const MockedSentryOAuthService = SentryOAuthService as jest.MockedClass<typeof SentryOAuthService>;

describe('SentryServiceFactory', () => {
  let mockConfig: SentryConfig;

  beforeEach(() => {
    mockConfig = {
      authToken: 'test-token',
      organizationSlug: 'test-org',
      projectSlugs: ['test-project'],
      environments: ['production'],
      pollIntervalMs: 60000,
    };
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a regular Sentry service when OAuth is not configured', async () => {
      const result = await SentryServiceFactory.create(mockConfig);

      expect(result.service).toBeDefined();
      expect(result.oauthService).toBeUndefined();
      expect(result.getAuthorizationUrl).toBeUndefined();
      expect(result.isAuthorized).toBeDefined();
      expect(result.isAuthorized!()).toBe(true);
      expect(MockedSentryService).toHaveBeenCalledWith(mockConfig);
    });

    it('should create an OAuth-enabled service when OAuth is configured', async () => {
      const oauthConfig = {
        ...mockConfig,
        oauth: {
          clientId: 'test-client',
          clientSecret: 'test-secret',
          redirectUri: 'http://localhost:3000/oauth/callback',
          scope: ['project:read'],
        },
      };

      // Mock OAuth service methods
      const mockStart = jest.fn().mockResolvedValue(undefined);
      const mockGetAuthUrl = jest.fn().mockReturnValue('https://sentry.io/oauth/authorize');
      const mockGetCurrentToken = jest.fn().mockReturnValue(null);
      const mockOnAuthorization = jest.fn();

      MockedSentryOAuthService.prototype.start = mockStart;
      MockedSentryOAuthService.prototype.getAuthorizationUrl = mockGetAuthUrl;
      MockedSentryOAuthService.prototype.getCurrentToken = mockGetCurrentToken;
      MockedSentryOAuthService.prototype.onAuthorization = mockOnAuthorization;

      const result = await SentryServiceFactory.create(oauthConfig);

      expect(result.service).toBeDefined();
      expect(result.oauthService).toBeDefined();
      expect(result.getAuthorizationUrl).toBeDefined();
      expect(result.isAuthorized).toBeDefined();
      
      expect(MockedSentryOAuthService).toHaveBeenCalledWith(oauthConfig.oauth);
      expect(mockStart).toHaveBeenCalledWith(3000);
      expect(mockOnAuthorization).toHaveBeenCalled();
      
      expect(result.getAuthorizationUrl!()).toBe('https://sentry.io/oauth/authorize');
      expect(result.isAuthorized!()).toBe(false);
    });

    it('should throw error when accessing service before OAuth authorization', async () => {
      const oauthConfig = {
        ...mockConfig,
        oauth: {
          clientId: 'test-client',
          clientSecret: 'test-secret',
          redirectUri: 'http://localhost:3000/oauth/callback',
          scope: ['project:read'],
        },
      };

      MockedSentryOAuthService.prototype.start = jest.fn().mockResolvedValue(undefined);
      MockedSentryOAuthService.prototype.getCurrentToken = jest.fn().mockReturnValue(null);
      MockedSentryOAuthService.prototype.onAuthorization = jest.fn();

      const result = await SentryServiceFactory.create(oauthConfig);

      expect(() => result.service.fetchRecentIssues()).toThrow(
        'Sentry service not initialized. Please complete OAuth authorization first.'
      );
    });

    it('should create Sentry service after OAuth authorization', async () => {
      const oauthConfig = {
        ...mockConfig,
        oauth: {
          clientId: 'test-client',
          clientSecret: 'test-secret',
          redirectUri: 'http://localhost:3000/oauth/callback',
          scope: ['project:read'],
        },
      };

      let authorizationCallback: any;
      MockedSentryOAuthService.prototype.start = jest.fn().mockResolvedValue(undefined);
      MockedSentryOAuthService.prototype.getCurrentToken = jest.fn().mockReturnValue({
        accessToken: 'oauth-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(),
        tokenType: 'Bearer',
        scope: ['project:read'],
      });
      MockedSentryOAuthService.prototype.onAuthorization = jest.fn((callback) => {
        authorizationCallback = callback;
      });

      const result = await SentryServiceFactory.create(oauthConfig);

      // Simulate OAuth authorization
      authorizationCallback({
        accessToken: 'oauth-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(),
        tokenType: 'Bearer',
        scope: ['project:read'],
      });

      expect(MockedSentryService).toHaveBeenCalledWith({
        ...oauthConfig,
        authToken: 'oauth-token',
      });

      expect(result.isAuthorized!()).toBe(true);
    });
  });

  describe('OAuth token refresh handling', () => {
    it('should handle token refresh on 401 errors', async () => {
      const oauthConfig = {
        ...mockConfig,
        oauth: {
          clientId: 'test-client',
          clientSecret: 'test-secret',
          redirectUri: 'http://localhost:3000/oauth/callback',
          scope: ['project:read'],
        },
      };

      let authorizationCallback: any;
      const mockRefreshToken = jest.fn().mockResolvedValue({
        accessToken: 'new-oauth-token',
        refreshToken: 'new-refresh-token',
        expiresAt: new Date(),
        tokenType: 'Bearer',
        scope: ['project:read'],
      });

      MockedSentryOAuthService.prototype.start = jest.fn().mockResolvedValue(undefined);
      MockedSentryOAuthService.prototype.refreshAccessToken = mockRefreshToken;
      MockedSentryOAuthService.prototype.getCurrentToken = jest.fn().mockReturnValue({
        accessToken: 'oauth-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(),
        tokenType: 'Bearer',
        scope: ['project:read'],
      });
      MockedSentryOAuthService.prototype.onAuthorization = jest.fn((callback) => {
        authorizationCallback = callback;
      });

      const mockFetchRecentIssues = jest.fn()
        .mockRejectedValueOnce({ response: { status: 401 } })
        .mockResolvedValueOnce([]);

      MockedSentryService.prototype.fetchRecentIssues = mockFetchRecentIssues;
      MockedSentryService.prototype.getProcessedCount = jest.fn().mockReturnValue(0);

      const result = await SentryServiceFactory.create(oauthConfig);

      // Simulate OAuth authorization
      authorizationCallback({
        accessToken: 'oauth-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(),
        tokenType: 'Bearer',
        scope: ['project:read'],
      });

      // Try to fetch issues (should trigger token refresh)
      await result.service.fetchRecentIssues();

      expect(mockRefreshToken).toHaveBeenCalled();
      expect(MockedSentryService).toHaveBeenCalledTimes(2); // Initial + after refresh
    });
  });
}); 