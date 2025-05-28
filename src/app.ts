import { logger } from './utils/logger';
import { loadConfig } from './config';
import { SentryAgent } from './agent/worker';

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  try {
    const config = loadConfig();
    
    logger.info('Starting Sentrypede application...', {
      nodeEnv: config.nodeEnv,
      logLevel: config.logLevel,
    });

    // Create and start the agent
    const agent = new SentryAgent(config);
    await agent.start();

    // Log initial stats
    const stats = agent.getStats();
    logger.info('Sentrypede agent is running', {
      startTime: stats.startTime,
      isRunning: stats.isRunning,
    });

    // Keep the process alive
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down...');
      await agent.stop();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down...');
      await agent.stop();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start Sentrypede application', { error });
    process.exit(1);
  }
}

// Start the application
if (require.main === module) {
  main().catch((error) => {
    logger.error('Unhandled error in main', { error });
    process.exit(1);
  });
} 