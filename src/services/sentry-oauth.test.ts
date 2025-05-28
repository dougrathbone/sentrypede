import { SentryOAuthService, SentryOAuthConfig, SentryOAuthToken } from './sentry-oauth';
import axios from 'axios';
import http from 'http';

// Mock dependencies
jest.mock('axios');
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SentryOAuthService', () => {
  let service: SentryOAuthService;
  let config: SentryOAuthConfig;
  let server: http.Server | undefined;

  beforeEach(() => {
    config = {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:3000/oauth/callback',
      scope: ['project:read', 'org:read'],
    };
    service = new SentryOAuthService(config);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await service.stop();
    if (server) {
      server.close();
    }
  });

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      expect(service).toBeDefined();
      expect(service.getCurrentToken()).toBeNull();
    });
  });

  describe('start', () => {
    it('should start the OAuth server', async () => {
      await service.start(3001);
      // Server should be running
      const response = await fetch('http://localhost:3001/health');
      const data = await response.json();
      expect(data.status).toBe('ok');
      expect(data.hasToken).toBe(false);
    });
  });

  describe('getAuthorizationUrl', () => {
    it('should generate a valid authorization URL', () => {
      const url = service.getAuthorizationUrl();
      const urlObj = new URL(url);
      
      expect(urlObj.hostname).toBe('sentry.io');
      expect(urlObj.pathname).toBe('/oauth/authorize/');
      expect(urlObj.searchParams.get('client_id')).toBe(config.clientId);
      expect(urlObj.searchParams.get('redirect_uri')).toBe(config.redirectUri);
      expect(urlObj.searchParams.get('response_type')).toBe('code');
      expect(urlObj.searchParams.get('scope')).toBe('project:read org:read');
      expect(urlObj.searchParams.get('state')).toBeTruthy();
    });

    it('should generate unique state parameters', () => {
      const url1 = service.getAuthorizationUrl();
      const url2 = service.getAuthorizationUrl();
      
      const state1 = new URL(url1).searchParams.get('state');
      const state2 = new URL(url2).searchParams.get('state');
      
      expect(state1).not.toBe(state2);
    });

    it('should include metadata when provided', () => {
      const metadata = { userId: '123', source: 'test' };
      const url = service.getAuthorizationUrl(metadata);
      
      expect(url).toBeTruthy();
      // Metadata is stored internally, not in URL
    });
  });

  describe('exchangeCodeForToken', () => {
    const mockCode = 'test-auth-code';
    const mockTokenResponse = {
      data: {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'project:read org:read',
      },
    };

    beforeEach(() => {
      // Generate a valid state first
      const url = service.getAuthorizationUrl();
      const urlObj = new URL(url);
      const state = urlObj.searchParams.get('state');
      if (state) {
        Object.assign(mockTokenResponse.data, { state });
      }
    });

    it('should exchange code for token successfully', async () => {
      mockedAxios.post.mockResolvedValueOnce(mockTokenResponse);
      
      // Get a valid state
      const url = service.getAuthorizationUrl();
      const state = new URL(url).searchParams.get('state')!;
      
      const token = await service.exchangeCodeForToken(mockCode, state);
      
      expect(token.accessToken).toBe('test-access-token');
      expect(token.refreshToken).toBe('test-refresh-token');
      expect(token.tokenType).toBe('Bearer');
      expect(token.scope).toEqual(['project:read', 'org:read']);
      expect(token.expiresAt).toBeInstanceOf(Date);
      
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://sentry.io/oauth/token/',
        expect.objectContaining({
          grant_type: 'authorization_code',
          code: mockCode,
          redirect_uri: config.redirectUri,
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }),
        expect.any(Object)
      );
    });

    it('should throw error for invalid state', async () => {
      await expect(
        service.exchangeCodeForToken(mockCode, 'invalid-state')
      ).rejects.toThrow('Invalid or expired state parameter');
    });

    it('should handle API errors', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('API Error'));
      
      const url = service.getAuthorizationUrl();
      const state = new URL(url).searchParams.get('state')!;
      
      await expect(
        service.exchangeCodeForToken(mockCode, state)
      ).rejects.toThrow('API Error');
    });

    it('should set current token after successful exchange', async () => {
      mockedAxios.post.mockResolvedValueOnce(mockTokenResponse);
      
      const url = service.getAuthorizationUrl();
      const state = new URL(url).searchParams.get('state')!;
      
      await service.exchangeCodeForToken(mockCode, state);
      
      const currentToken = service.getCurrentToken();
      expect(currentToken).not.toBeNull();
      expect(currentToken?.accessToken).toBe('test-access-token');
    });
  });

  describe('refreshAccessToken', () => {
    const mockToken: SentryOAuthToken = {
      accessToken: 'old-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: new Date(Date.now() + 3600000),
      tokenType: 'Bearer',
      scope: ['project:read'],
    };

    const mockRefreshResponse = {
      data: {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'project:read',
      },
    };

    it('should refresh token successfully', async () => {
      // Set up initial token
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          ...mockToken,
          access_token: mockToken.accessToken,
          refresh_token: mockToken.refreshToken,
          expires_in: 3600,
          scope: mockToken.scope.join(' '),
        },
      });
      
      const url = service.getAuthorizationUrl();
      const state = new URL(url).searchParams.get('state')!;
      await service.exchangeCodeForToken('code', state);
      
      // Now refresh
      mockedAxios.post.mockResolvedValueOnce(mockRefreshResponse);
      const newToken = await service.refreshAccessToken();
      
      expect(newToken.accessToken).toBe('new-access-token');
      expect(newToken.refreshToken).toBe('new-refresh-token');
      
      expect(mockedAxios.post).toHaveBeenLastCalledWith(
        'https://sentry.io/oauth/token/',
        expect.objectContaining({
          grant_type: 'refresh_token',
          refresh_token: expect.any(String),
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }),
        expect.any(Object)
      );
    });

    it('should throw error if no current token', async () => {
      await expect(service.refreshAccessToken()).rejects.toThrow(
        'No current token to refresh'
      );
    });

    it('should handle refresh errors', async () => {
      // Set up initial token
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          ...mockToken,
          access_token: mockToken.accessToken,
          refresh_token: mockToken.refreshToken,
          expires_in: 3600,
          scope: mockToken.scope.join(' '),
        },
      });
      
      const url = service.getAuthorizationUrl();
      const state = new URL(url).searchParams.get('state')!;
      await service.exchangeCodeForToken('code', state);
      
      // Mock refresh failure
      mockedAxios.post.mockRejectedValueOnce(new Error('Refresh failed'));
      
      await expect(service.refreshAccessToken()).rejects.toThrow('Refresh failed');
    });
  });

  describe('revokeToken', () => {
    it('should revoke token successfully', async () => {
      // Set up initial token
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          access_token: 'test-token',
          refresh_token: 'test-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'project:read',
        },
      });
      
      const url = service.getAuthorizationUrl();
      const state = new URL(url).searchParams.get('state')!;
      await service.exchangeCodeForToken('code', state);
      
      // Mock revoke success
      mockedAxios.post.mockResolvedValueOnce({ data: {} });
      
      await service.revokeToken();
      
      expect(service.getCurrentToken()).toBeNull();
      expect(mockedAxios.post).toHaveBeenLastCalledWith(
        'https://sentry.io/oauth/revoke/',
        expect.objectContaining({
          token: 'test-token',
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }),
        expect.any(Object)
      );
    });

    it('should handle revoke when no token exists', async () => {
      await expect(service.revokeToken()).resolves.not.toThrow();
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should handle revoke errors', async () => {
      // Set up initial token
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          access_token: 'test-token',
          refresh_token: 'test-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'project:read',
        },
      });
      
      const url = service.getAuthorizationUrl();
      const state = new URL(url).searchParams.get('state')!;
      await service.exchangeCodeForToken('code', state);
      
      // Mock revoke failure
      mockedAxios.post.mockRejectedValueOnce(new Error('Revoke failed'));
      
      await expect(service.revokeToken()).rejects.toThrow('Revoke failed');
    });
  });

  describe('onAuthorization', () => {
    it('should set authorization callback', () => {
      const callback = jest.fn();
      service.onAuthorization(callback);
      
      // The callback is stored internally and will be called when OAuth flow completes
      // We can't test the actual invocation without going through the full OAuth flow
      expect(() => service.onAuthorization(callback)).not.toThrow();
    });
  });

  describe('OAuth callback endpoint', () => {
    beforeEach(async () => {
      await service.start(3003);
    });

    it('should handle successful callback', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          access_token: 'test-token',
          refresh_token: 'test-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'project:read',
        },
      });
      
      const url = service.getAuthorizationUrl();
      const state = new URL(url).searchParams.get('state')!;
      
      const response = await fetch(
        `http://localhost:3003/oauth/callback?code=test-code&state=${state}`
      );
      
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('Authorization Successful!');
    });

    it('should handle error callback', async () => {
      const response = await fetch(
        'http://localhost:3003/oauth/callback?error=access_denied&error_description=User%20denied%20access'
      );
      
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain('Authorization failed: User denied access');
    });

    it('should handle missing parameters', async () => {
      const response = await fetch('http://localhost:3003/oauth/callback');
      
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain('Missing code or state parameter');
    });

    it('should handle invalid state', async () => {
      const response = await fetch(
        'http://localhost:3003/oauth/callback?code=test-code&state=invalid-state'
      );
      
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).toContain('Failed to complete authorization');
    });
  });

  describe('automatic token refresh', () => {
    jest.useFakeTimers();

    it('should schedule token refresh before expiration', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          access_token: 'test-token',
          refresh_token: 'test-refresh',
          expires_in: 3600, // 1 hour
          token_type: 'Bearer',
          scope: 'project:read',
        },
      });
      
      const url = service.getAuthorizationUrl();
      const state = new URL(url).searchParams.get('state')!;
      await service.exchangeCodeForToken('code', state);
      
      // Mock refresh response
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          access_token: 'refreshed-token',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'project:read',
        },
      });
      
      // Fast forward to 5 minutes before expiration
      jest.advanceTimersByTime(55 * 60 * 1000);
      
      // Allow async operations to complete
      await Promise.resolve();
      
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });

    afterEach(() => {
      jest.useRealTimers();
    });
  });
}); 