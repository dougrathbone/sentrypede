# Slack Service Guide

## Overview

The Sentrypede Slack service provides a clean, intuitive API for posting notifications about Sentry issues. It focuses on simplicity and ease of use while providing all essential features.

## Key Features

### Simple API - Only 5 Core Methods

1. **`notifyNewIssue(issue, event?)`** - Post initial issue notification
2. **`updateStatus(issueId, status, details?)`** - Update progress with smart emoji
3. **`postAnalysis(issueId, analysis)`** - Share analysis findings  
4. **`notifySuccess(issueId, prUrl, summary?)`** - Celebrate successful fixes
5. **`notifyFailure(issueId, reason, suggestions?)`** - Explain failures with next steps

### Smart Defaults

- Automatic emoji selection based on status text
- Intelligent text truncation
- Clean formatting without configuration
- Graceful handling of missing data

### Clean Issue Display

Issue notifications include:
- Clear severity indicator in header
- Scannable summary with key metrics
- Optional stack trace preview
- Single "View in Sentry" button

## Complete API Reference

```typescript
class SlackService {
  // Core methods
  async notifyNewIssue(issue: SentryIssue, event?: SentryEvent): Promise<SlackThread>
  async updateStatus(issueId: string, status: string, details?: string): Promise<void>
  async postAnalysis(issueId: string, analysis: AnalysisData): Promise<void>
  async notifySuccess(issueId: string, prUrl: string, summary?: string): Promise<void>
  async notifyFailure(issueId: string, reason: string, suggestions?: string[]): Promise<void>
  
  // Utility methods
  async postMessage(text: string, blocks?: KnownBlock[]): Promise<void>
  getThread(issueId: string): SlackThread | undefined
  
  // Lifecycle
  async start(): Promise<void>
  async stop(): Promise<void>
}

interface AnalysisData {
  summary: string;      // What happened
  cause: string;        // Why it happened
  suggestion: string;   // How to fix it
  confidence: number;   // 0-1 confidence score
}
```

## Usage Example

```typescript
const slack = new SlackService(config.slack);
await slack.start();

// 1. Notify about issue
const thread = await slack.notifyNewIssue(sentryIssue);

// 2. Update progress
await slack.updateStatus(issue.id, 'Analyzing error...');

// 3. Share findings
await slack.postAnalysis(issue.id, {
  summary: 'Null reference in user list',
  cause: 'Missing data validation',
  suggestion: 'Add null check before mapping',
  confidence: 0.9,
});

// 4. Report outcome
await slack.notifySuccess(issue.id, prUrl, 'Fixed null reference');
// OR
await slack.notifyFailure(issue.id, 'Could not determine cause', [
  'Check error boundaries',
  'Enable source maps',
]);
```

## Status Updates

The `updateStatus` method automatically selects appropriate emojis:

```typescript
await slack.updateStatus(id, 'Analyzing...');     // 🔍
await slack.updateStatus(id, 'Fetching data...');  // 📥
await slack.updateStatus(id, 'Creating fix...');   // 🔨
await slack.updateStatus(id, 'Testing...');        // 🧪
await slack.updateStatus(id, 'Complete!');         // ✅
await slack.updateStatus(id, 'Failed');            // ❌
```

## Analysis Results

Post clear, structured analysis with confidence levels:

```typescript
await slack.postAnalysis(issueId, {
  summary: 'Array method called on undefined variable',
  cause: 'Props not validated before use',
  suggestion: 'Add PropTypes or TypeScript types',
  confidence: 0.85  // Shows as 🟢 85%
});
```

## Success Notifications

Celebrate fixes with optional summaries:

```typescript
// Simple
await slack.notifySuccess(issueId, prUrl);

// With summary
await slack.notifySuccess(issueId, prUrl, 'Added null safety checks');
```

## Failure Handling

Provide context and next steps:

```typescript
await slack.notifyFailure(
  issueId,
  'Unable to analyze minified code',
  [
    'Enable source maps in production',
    'Add error boundaries',
    'Check Sentry configuration'
  ]
);
```

## Bot Commands

The service responds to mentions:

- `@Sentrypede status` - Check current processing status
- `@Sentrypede help` - Show available commands

## Configuration

Uses standard Slack tokens:

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_CHANNEL_ID=C1234567890
SLACK_SIGNING_SECRET=your-signing-secret
```

## Demo

Run the demo to see all features:

```bash
npm run demo:slack
```

## Benefits

1. **Easy to Learn**: Only 5 methods to remember
2. **Clean Code**: Less verbose, more readable
3. **Smart Defaults**: Works great out of the box
4. **Powerful**: All essential features included
5. **Intuitive**: Natural method names and parameters 