import express, { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../utils/logger';

export interface SentryOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string[];
}

export interface SentryOAuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  tokenType: string;
  scope: string[];
}

export interface OAuthState {
  state: string;
  createdAt: Date;
  metadata?: Record<string, any>;
}

export class SentryOAuthService {
  private config: SentryOAuthConfig;
  private app: express.Application;
  private server: any;
  private pendingStates: Map<string, OAuthState> = new Map();
  private currentToken: SentryOAuthToken | null = null;
  private tokenRefreshTimer: NodeJS.Timeout | null = null;
  private authorizationCallback: ((token: SentryOAuthToken) => void) | null = null;

  constructor(config: SentryOAuthConfig) {
    this.config = config;
    this.app = express();
    this.setupRoutes();
  }

  /**
   * Start the OAuth server
   */
  async start(port: number = 3000): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        logger.info(`OAuth server listening on port ${port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the OAuth server
   */
  async stop(): Promise<void> {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('OAuth server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Generate the authorization URL for Sentry OAuth
   */
  getAuthorizationUrl(metadata?: Record<string, any>): string {
    const state = this.generateState();
    const oauthState: OAuthState = {
      state,
      createdAt: new Date(),
      ...(metadata && { metadata }),
    };
    
    this.pendingStates.set(state, oauthState);
    
    // Clean up old states (older than 10 minutes)
    this.cleanupOldStates();

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scope.join(' '),
      state,
    });

    return `https://sentry.io/oauth/authorize/?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string, state: string): Promise<SentryOAuthToken> {
    // Validate state
    const pendingState = this.pendingStates.get(state);
    if (!pendingState) {
      throw new Error('Invalid or expired state parameter');
    }

    this.pendingStates.delete(state);

    try {
      const response = await axios.post(
        'https://sentry.io/oauth/token/',
        {
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.config.redirectUri,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const { access_token, refresh_token, expires_in, token_type, scope } = response.data;

      const token: SentryOAuthToken = {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: new Date(Date.now() + expires_in * 1000),
        tokenType: token_type,
        scope: scope.split(' '),
      };

      this.currentToken = token;
      this.scheduleTokenRefresh(token);

      logger.info('Successfully exchanged code for token', {
        scope: token.scope,
        expiresAt: token.expiresAt,
      });

      return token;
    } catch (error) {
      logger.error('Failed to exchange code for token', { error });
      throw error;
    }
  }

  /**
   * Refresh the access token
   */
  async refreshAccessToken(): Promise<SentryOAuthToken> {
    if (!this.currentToken) {
      throw new Error('No current token to refresh');
    }

    try {
      const response = await axios.post(
        'https://sentry.io/oauth/token/',
        {
          grant_type: 'refresh_token',
          refresh_token: this.currentToken.refreshToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const { access_token, refresh_token, expires_in, token_type, scope } = response.data;

      const token: SentryOAuthToken = {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: new Date(Date.now() + expires_in * 1000),
        tokenType: token_type,
        scope: scope.split(' '),
      };

      this.currentToken = token;
      this.scheduleTokenRefresh(token);

      logger.info('Successfully refreshed token', {
        expiresAt: token.expiresAt,
      });

      return token;
    } catch (error) {
      logger.error('Failed to refresh token', { error });
      throw error;
    }
  }

  /**
   * Get the current access token
   */
  getCurrentToken(): SentryOAuthToken | null {
    return this.currentToken;
  }

  /**
   * Set a callback to be called when authorization is complete
   */
  onAuthorization(callback: (token: SentryOAuthToken) => void): void {
    this.authorizationCallback = callback;
  }

  /**
   * Revoke the current token
   */
  async revokeToken(): Promise<void> {
    if (!this.currentToken) {
      return;
    }

    try {
      await axios.post(
        'https://sentry.io/oauth/revoke/',
        {
          token: this.currentToken.accessToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      this.currentToken = null;
      if (this.tokenRefreshTimer) {
        clearTimeout(this.tokenRefreshTimer);
        this.tokenRefreshTimer = null;
      }

      logger.info('Successfully revoked token');
    } catch (error) {
      logger.error('Failed to revoke token', { error });
      throw error;
    }
  }

  /**
   * Setup Express routes for OAuth callbacks
   */
  private setupRoutes(): void {
    this.app.get('/oauth/callback', async (req: Request, res: Response) => {
      const { code, state, error, error_description } = req.query;

      if (error) {
        logger.error('OAuth authorization error', { error, error_description });
        res.status(400).send(`Authorization failed: ${error_description || error}`);
        return;
      }

      if (!code || !state) {
        res.status(400).send('Missing code or state parameter');
        return;
      }

      try {
        const token = await this.exchangeCodeForToken(code as string, state as string);
        
        // Call the authorization callback if set
        if (this.authorizationCallback) {
          this.authorizationCallback(token);
        }

        res.send(`
          <html>
            <body>
              <h1>Authorization Successful!</h1>
              <p>You can now close this window and return to Sentrypede.</p>
              <script>
                setTimeout(() => window.close(), 3000);
              </script>
            </body>
          </html>
        `);
      } catch (error) {
        logger.error('Failed to handle OAuth callback', { error });
        res.status(500).send('Failed to complete authorization');
      }
    });

    // Health check endpoint
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', hasToken: !!this.currentToken });
    });
  }

  /**
   * Generate a secure random state parameter
   */
  private generateState(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Clean up old pending states
   */
  private cleanupOldStates(): void {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    
    for (const [state, oauthState] of this.pendingStates.entries()) {
      if (oauthState.createdAt < tenMinutesAgo) {
        this.pendingStates.delete(state);
      }
    }
  }

  /**
   * Schedule automatic token refresh
   */
  private scheduleTokenRefresh(token: SentryOAuthToken): void {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
    }

    // Refresh 5 minutes before expiration
    const refreshTime = token.expiresAt.getTime() - Date.now() - 5 * 60 * 1000;
    
    if (refreshTime > 0) {
      this.tokenRefreshTimer = setTimeout(async () => {
        try {
          await this.refreshAccessToken();
        } catch (error) {
          logger.error('Failed to automatically refresh token', { error });
        }
      }, refreshTime);
    }
  }
} 