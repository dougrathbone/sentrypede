# Slack Setup Guide for Sentrypede

## Overview

Sentrypede uses Slack to notify your team about Sentry issues and the status of automated fixes. This guide will help you set up a Slack app with the correct permissions and tokens.

## What You'll Need

From your Slack app registration page, you'll need:
- **Bot User OAuth Token** (starts with `xoxb-`)
- **App-Level Token** (starts with `xapp-`)
- **Signing Secret**
- **Channel ID** where notifications will be posted

## Step-by-Step Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App**
3. Choose **From scratch**
4. Name your app "Sentrypede" (or your preferred name)
5. Select your workspace
6. Click **Create App**

### 2. Configure OAuth & Permissions

1. In the left sidebar, click **OAuth & Permissions**
2. Scroll down to **Scopes** → **Bot Token Scopes**
3. Add these OAuth scopes:
   - `chat:write` - Send messages
   - `chat:write.public` - Send messages to public channels
   - `channels:read` - View basic channel info
   - `app_mentions:read` - View messages that mention @sentrypede
   - `im:read` - View direct messages
   - `im:write` - Send direct messages
   - `im:history` - View direct message history

4. Scroll up and click **Install to Workspace**
5. Authorize the app
6. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
   - This is your `SLACK_BOT_TOKEN`

### 3. Enable Socket Mode

Socket Mode allows your app to use a WebSocket connection instead of HTTP.

1. In the left sidebar, click **Socket Mode**
2. Toggle **Enable Socket Mode** to On
3. You'll be prompted to create an App-Level Token:
   - Token Name: "Sentrypede Socket Token" (or any name)
   - Add scope: `connections:write`
   - Click **Generate**
4. Copy the **App-Level Token** (starts with `xapp-`)
   - This is your `SLACK_APP_TOKEN`

### 4. Configure Event Subscriptions

1. In the left sidebar, click **Event Subscriptions**
2. Toggle **Enable Events** to On
3. Under **Subscribe to bot events**, add:
   - `app_mention` - When someone mentions your bot
   - `message.im` - Direct messages to your bot

### 5. Get Your Signing Secret

1. In the left sidebar, click **Basic Information**
2. Scroll down to **App Credentials**
3. Copy the **Signing Secret**
   - This is your `SLACK_SIGNING_SECRET`

### 6. Get the Channel ID

1. In Slack, right-click on the channel where you want notifications
2. Select **View channel details**
3. At the bottom of the popup, you'll see the Channel ID (starts with `C`)
   - This is your `SLACK_CHANNEL_ID`

### 7. Invite the Bot to Your Channel

1. In Slack, go to the channel where you want notifications
2. Type `/invite @Sentrypede` (or your bot's name)
3. Press Enter

## Configure Sentrypede

Update your `.env` file with the tokens:

```bash
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_APP_TOKEN=xapp-your-app-token-here
SLACK_CHANNEL_ID=C1234567890
SLACK_SIGNING_SECRET=your_signing_secret_here
```

## Testing Your Setup

1. Run Sentrypede: `npm start`
2. In Slack, mention your bot: `@Sentrypede hello`
3. The bot should respond with a greeting

## What the Tokens Do

- **Bot Token (`xoxb-`)**: Allows Sentrypede to send messages and interact with Slack
- **App Token (`xapp-`)**: Enables Socket Mode for real-time WebSocket connection
- **Signing Secret**: Verifies that requests are coming from Slack
- **Channel ID**: Specifies where to post Sentry issue notifications

## Troubleshooting

### "invalid_auth" Error

This means one of your tokens is incorrect:
1. Verify all tokens start with the correct prefix
2. Ensure you copied the complete token
3. Check that the bot is installed in your workspace

### Bot Doesn't Respond

1. Ensure the bot is invited to the channel
2. Check that Socket Mode is enabled
3. Verify event subscriptions are configured

### Can't Find Channel ID

- Public channels start with `C`
- Private channels start with `G`
- Direct messages start with `D`
- You can also use the Slack API tester to find channel IDs

## Security Best Practices

1. **Never commit tokens** to version control
2. **Rotate tokens** periodically
3. **Use environment variables** for all tokens
4. **Limit bot permissions** to only what's needed
5. **Monitor bot activity** in Slack's app management

## Next Steps

Once Slack is configured:
1. Test the integration with `npm start`
2. Configure GitHub access (see `docs/github-setup.md`)
3. Set up Google Gemini for AI-powered fixes 