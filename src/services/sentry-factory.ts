import { SentryService } from './sentry';
import { SentryOAuthService, SentryOAuthToken } from './sentry-oauth';
import { SentryConfig } from '../config';
import { logger } from '../utils/logger';

/**
 * Factory to create Sentry service with optional OAuth support
 */
export class SentryServiceFactory {
  /**
   * Create a Sentry service instance with OAuth support if configured
   */
  static async create(config: SentryConfig): Promise<{
    service: SentryService;
    oauthService?: SentryOAuthService;
    getAuthorizationUrl?: () => string;
    isAuthorized?: () => boolean;
  }> {
    if (config.oauth) {
      // Create OAuth service
      const oauthService = new SentryOAuthService(config.oauth);
      await oauthService.start(3000);

      // Create a modified config that will use OAuth token
      const modifiedConfig = { ...config };
      let sentryService: SentryService | null = null;

      // Set up authorization callback
      oauthService.onAuthorization((token: SentryOAuthToken) => {
        logger.info('OAuth authorization successful, creating Sentry service', {
          scope: token.scope,
          expiresAt: token.expiresAt,
        });

        // Create the Sentry service with the OAuth token
        modifiedConfig.authToken = token.accessToken;
        sentryService = new SentryService(modifiedConfig);
        
        // Patch the service to handle token refresh
        patchServiceForOAuth(sentryService, oauthService);
      });

      return {
        service: new Proxy({} as SentryService, {
          get(_target, prop) {
            if (!sentryService) {
              throw new Error('Sentry service not initialized. Please complete OAuth authorization first.');
            }
            return (sentryService as any)[prop];
          },
        }),
        oauthService,
        getAuthorizationUrl: () => oauthService.getAuthorizationUrl(),
        isAuthorized: () => !!oauthService.getCurrentToken(),
      };
    } else {
      // Create regular Sentry service with auth token
      const service = new SentryService(config);
      return {
        service,
        isAuthorized: () => true,
      };
    }
  }
}

/**
 * Patch a Sentry service instance to handle OAuth token refresh
 */
function patchServiceForOAuth(
  service: SentryService,
  oauthService: SentryOAuthService
): void {
  // We need to intercept the axios client used by the service
  // Since we can't access private properties, we'll need to monkey-patch the methods
  const originalFetchRecentIssues = service.fetchRecentIssues.bind(service);
  const originalGetIssueDetails = service.getIssueDetails.bind(service);
  const originalGetLatestEvent = service.getLatestEvent.bind(service);

  // Helper to handle token refresh on 401
  const handleAuthError = async (error: any, retryFn: () => Promise<any>): Promise<any> => {
    if (error.response?.status === 401) {
      try {
        const newToken = await oauthService.refreshAccessToken();
        if (newToken) {
          // Create a new service instance with the refreshed token
          const newConfig = { ...(service as any).config, authToken: newToken.accessToken };
          const newService = new SentryService(newConfig);
          
          // Copy over the processed issues state
          const processedCount = service.getProcessedCount();
          for (let i = 0; i < processedCount; i++) {
            // This is a limitation - we can't access the actual processed IDs
            // In a real implementation, we'd need to expose this functionality
          }
          
          // Replace the methods on the original service object
          Object.setPrototypeOf(service, Object.getPrototypeOf(newService));
          Object.assign(service, newService);
          
          // Retry the original request
          return retryFn();
        }
      } catch (refreshError) {
        logger.error('Failed to refresh OAuth token', { error: refreshError });
      }
    }
    throw error;
  };

  // Wrap methods to handle token refresh
  service.fetchRecentIssues = async function(): Promise<any> {
    try {
      return await originalFetchRecentIssues();
    } catch (error) {
      return handleAuthError(error, () => service.fetchRecentIssues());
    }
  };

  service.getIssueDetails = async function(issueId: string): Promise<any> {
    try {
      return await originalGetIssueDetails(issueId);
    } catch (error) {
      return handleAuthError(error, () => service.getIssueDetails(issueId));
    }
  };

  service.getLatestEvent = async function(issueId: string): Promise<any> {
    try {
      return await originalGetLatestEvent(issueId);
    } catch (error) {
      return handleAuthError(error, () => service.getLatestEvent(issueId));
    }
  };
}

/**
 * Enhanced Sentry service interface with OAuth support
 */
export interface SentryServiceWithOAuth {
  service: SentryService;
  oauthService?: SentryOAuthService;
  getAuthorizationUrl?: () => string;
  isAuthorized?: () => boolean;
  start?: () => Promise<void>;
  stop?: () => Promise<void>;
} 