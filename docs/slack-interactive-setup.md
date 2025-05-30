# Interactive Slack Experience Setup Guide

Welcome to Sentrypede's Interactive Slack Experience! This guide will help you set up interactive error notifications with buttons, dashboards, and enhanced team workflows.

## 🚀 Features Overview

### Interactive Components
- **Action Buttons**: Fix Now, Details, Escalate, Ignore
- **Real-time Dashboard**: Metrics, trends, and team activity
- **Smart Commands**: Enhanced @mention support
- **Priority System**: Automatic issue prioritization
- **Team Tracking**: Interaction history and assignments

### Workflow Enhancements
- One-click automated fix initiation
- Detailed error analysis with stack traces
- Escalation workflows with team notifications
- Issue filtering and management
- Success rate and performance tracking

## 📋 Prerequisites

### Slack App Requirements
1. **Bot Token Scopes**:
   ```
   chat:write
   chat:write.public
   commands
   app_mentions:read
   channels:read
   groups:read
   im:read
   mpim:read
   ```

2. **Event Subscriptions**:
   ```
   app_mention
   message.channels
   ```

3. **Interactive Components**:
   - Must be enabled in your Slack app settings
   - Request URL: `https://your-domain.com/slack/events`

### Environment Variables
```bash
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_CHANNEL_ID=C1234567890

# Sentrypede Configuration
SENTRY_AUTH_TOKEN=your-sentry-token
GITHUB_TOKEN=your-github-token
GEMINI_API_KEY=your-gemini-key
```

## 🔧 Installation Steps

### 1. Install Dependencies
```bash
npm install @slack/bolt @slack/web-api
```

### 2. Create Slack App
1. Go to [Slack API](https://api.slack.com/apps)
2. Click "Create New App" → "From scratch"
3. Name your app "Sentrypede" and select your workspace
4. Configure the app settings as described in Prerequisites

### 3. Configure Bot Permissions
Navigate to **OAuth & Permissions** and add these scopes:
```
Bot Token Scopes:
- chat:write
- chat:write.public  
- commands
- app_mentions:read
- channels:read
- groups:read
- im:read
- mpim:read
```

### 4. Enable Socket Mode
1. Go to **Socket Mode** in your app settings
2. Enable Socket Mode
3. Generate an App-Level Token with `connections:write` scope

### 5. Configure Event Subscriptions
1. Enable Events in **Event Subscriptions**
2. Add these bot events:
   - `app_mention`
   - `message.channels`

### 6. Enable Interactive Components
1. Go to **Interactivity & Shortcuts**
2. Turn on Interactivity
3. Set Request URL: `https://your-domain.com/slack/events`

### 7. Install App to Workspace
1. Go to **Install App**
2. Click "Install to Workspace"
3. Copy the Bot User OAuth Token

## 🛠️ Code Implementation

### Basic Setup
```typescript
import { InteractiveSlackService } from './services/slack-interactive';
import { SlackConfig } from './config';

const config: SlackConfig = {
  botToken: process.env.SLACK_BOT_TOKEN!,
  appToken: process.env.SLACK_APP_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  channelId: process.env.SLACK_CHANNEL_ID!,
};

const slackService = new InteractiveSlackService(config);

// Start the service
await slackService.start();
```

### Integration with Sentry
```typescript
import { SentryService } from './services/sentry';
import { InteractiveSlackService } from './services/slack-interactive';

const sentryService = new SentryService(sentryConfig);
const slackService = new InteractiveSlackService(slackConfig);

// Monitor for new issues
const issues = await sentryService.getLatestIssues();
for (const issue of issues) {
  const events = await sentryService.getIssueEvents(issue.id);
  await slackService.notifyNewIssue(issue, events[0]);
}
```

## 📊 Interactive Features

### Action Buttons
When Sentrypede posts an error notification, team members can interact with these buttons:

#### 🚀 Fix Now
- Immediately starts AI-powered analysis
- Assigns the issue to the clicking user
- Triggers automated fix generation
- Updates thread with progress

#### 🔍 Details
- Shows full error analysis
- Displays stack trace with context
- Shows affected user count and impact
- Provides breadcrumb trail

#### ⚠️ Escalate
- Marks issue as critical priority
- Notifies team via @channel
- Creates incident response options
- Triggers escalation workflow

#### 🙈 Ignore
- Removes from automated processing
- Logs decision for audit trail
- Provides option to unignore later
- Maintains issue visibility

### Dashboard Commands
Team members can interact with Sentrypede using these commands:

```slack
@Sentrypede dashboard    # Show real-time metrics
@Sentrypede status       # Current system status
@Sentrypede help         # Interactive help guide
```

### Dashboard Metrics
The interactive dashboard shows:
- **Total Issues**: Processed today
- **Success Rate**: Percentage of successful fixes
- **Average Fix Time**: Time from detection to resolution
- **Status Distribution**: New, analyzing, fixed, failed, ignored
- **Priority Breakdown**: Critical, high, medium, low
- **Top Error Types**: Most common error categories
- **Team Activity**: User interactions and contributions

## 🎯 Priority System

Sentrypede automatically calculates issue priority based on:

### Critical Priority 🚨
- Fatal errors
- > 100 affected users
- > 1000 error occurrences

### High Priority 🔴
- Error level issues
- > 50 affected users
- > 500 error occurrences

### Medium Priority 🟡
- > 10 affected users
- > 100 error occurrences

### Low Priority 🟢
- Everything else

## 👥 Team Workflows

### User Assignment
- Issues are automatically assigned when "Fix Now" is clicked
- Assignment is tracked in thread metadata
- Team members can see who's working on what

### Interaction History
- All button clicks are logged with timestamps
- User actions are tracked for analytics
- Audit trail for compliance and learning

### Escalation Process
1. User clicks "Escalate" button
2. Issue priority is upgraded to Critical
3. Team is notified via Slack
4. Additional action buttons appear:
   - "Assign Team"
   - "Create Incident"

## 📈 Analytics and Reporting

### Success Metrics
- **Fix Success Rate**: Percentage of issues successfully resolved
- **Average Resolution Time**: From detection to fix deployment
- **Team Productivity**: Issues handled per team member
- **Error Trends**: Most common error types and patterns

### Dashboard Refresh
- Real-time metrics updated on interaction
- Manual refresh button available
- Weekly report generation
- Historical trend analysis

## 🔒 Security Considerations

### Token Security
- Store tokens in environment variables
- Use proper scoping for bot permissions
- Regularly rotate tokens
- Monitor token usage

### Access Control
- Limit channel access to authorized users
- Use workspace-level permissions
- Monitor escalation actions
- Log all interactions for audit

## 🧪 Testing

### Test Interactive Components
```bash
# Run the demo to test functionality
npm run demo:interactive-slack

# Run tests
npm test src/services/slack-interactive.test.ts
```

### Manual Testing
1. Post a test error to Sentry
2. Verify Slack notification appears with buttons
3. Test each button interaction
4. Check dashboard functionality
5. Verify team member assignments

## 🚨 Troubleshooting

### Common Issues

#### Buttons Not Working
- Check Interactive Components are enabled
- Verify Request URL is correct
- Ensure Socket Mode is enabled
- Check bot permissions

#### No Notifications
- Verify channel ID is correct
- Check bot is added to channel
- Confirm Sentry integration is working
- Check environment variables

#### Dashboard Empty
- Ensure issues have been processed
- Check if metrics are calculating correctly
- Verify time zone settings
- Refresh dashboard manually

### Debug Mode
```bash
# Enable debug logging
NODE_ENV=development npm start

# Check Slack API responses
DEBUG=slack:* npm start
```

## 📚 Advanced Configuration

### Custom Priority Rules
```typescript
// Override priority calculation
const customPriorityCalculator = (issue: SentryIssue) => {
  if (issue.tags?.some(tag => tag.key === 'payment')) {
    return 'critical';
  }
  // ... custom logic
  return 'medium';
};
```

### Custom Dashboard Metrics
```typescript
// Add custom metrics to dashboard
const customMetrics = {
  paymentErrors: countPaymentErrors(),
  apiLatency: getAverageApiLatency(),
  // ... custom metrics
};
```

### Webhook Integration
```typescript
// Handle external webhooks
app.post('/webhook/sentry', async (req, res) => {
  const issue = req.body;
  await slackService.notifyNewIssue(issue);
  res.sendStatus(200);
});
```

## 🔄 Deployment

### Production Checklist
- [ ] Environment variables configured
- [ ] Slack app permissions verified
- [ ] Interactive components tested
- [ ] Dashboard functionality verified
- [ ] Team training completed
- [ ] Monitoring and alerting set up
- [ ] Backup and recovery plan in place

### Scaling Considerations
- Use Redis for storing interaction state
- Implement rate limiting for API calls
- Set up proper logging and monitoring
- Consider message queuing for high volume

## 📞 Support

### Getting Help
- Check the demo file: `src/demo-interactive-slack.ts`
- Review test cases: `src/services/slack-interactive.test.ts`
- Slack API documentation: https://api.slack.com/
- Sentrypede issues: Create GitHub issue

### Community
- Join our Slack workspace for support
- Contribute to the project on GitHub
- Share your custom configurations
- Help improve the documentation

## 🎉 What's Next?

Once you have the Interactive Slack Experience set up:

1. **Train Your Team**: Show them the new buttons and commands
2. **Customize Priorities**: Adjust rules for your specific needs
3. **Monitor Metrics**: Use the dashboard to track team performance
4. **Optimize Workflows**: Fine-tune escalation and assignment processes
5. **Scale Up**: Add more integrations and custom features

The Interactive Slack Experience transforms error handling from reactive notifications into proactive team collaboration. Your team will love the enhanced workflows and real-time insights!

---

*Happy debugging with Sentrypede! 🐛→🔧* 