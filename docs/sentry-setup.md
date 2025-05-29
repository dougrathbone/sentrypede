# Sentry Setup Guide for Sentrypede

## Overview

Sentrypede requires proper Sentry authentication to monitor and process issues. This guide will help you set up the correct authentication method.

## Authentication Types

Sentry provides three types of authentication tokens:

1. **Organization Auth Tokens** (prefix: `sntrys_`) - Limited permissions, designed for CI/CD
2. **Internal Integrations** - Full API access, customizable permissions
3. **User Auth Tokens** (prefix: `sntryu_`) - Tied to a user account

**For Sentrypede, you need an Internal Integration token for full API access.**

## Creating an Internal Integration

### Step 1: Navigate to Settings

1. Log in to your Sentry account at https://sentry.io
2. Go to **Settings** → **Developer Settings** → **Custom Integrations**
3. Click **Create New Integration** → **Internal Integration**

### Step 2: Configure the Integration

1. **Name**: Give it a descriptive name like "Sentrypede Bot"
2. **Webhook URL**: Leave empty (not needed)
3. **Redirect URL**: Leave empty (not needed)
4. **Verify Install**: Leave unchecked

### Step 3: Set Permissions

Configure the following permissions for Sentrypede:

| Resource | Permission Level | Purpose |
|----------|-----------------|---------|
| **Project** | Read | View project details |
| **Issue & Event** | Read | Fetch issues and events |
| **Issue & Event** | Write | Update issue status |
| **Organization** | Read | List organizations |
| **Team** | Read | View team information |
| **Member** | Read | View member information |

### Step 4: Save and Get Token

1. Click **Save Changes**
2. After saving, you'll see a **Token** field
3. Copy the token - it will look like: `sntryi_...` or a long string
4. **Important**: Save this token securely, it won't be shown again!

## Configuring Sentrypede

Update your `.env` file with the Internal Integration token:

```bash
# Replace your organization auth token with the internal integration token
SENTRY_AUTH_TOKEN=your_internal_integration_token_here
SENTRY_ORG_SLUG=your_organization_slug
SENTRY_PROJECT_SLUGS=project1,project2,project3
```

## Finding Your Project Slugs

To find the correct project slugs:

1. Go to **Settings** → **Projects**
2. Click on each project you want to monitor
3. The URL will show the project slug: `https://sentry.io/settings/{org-slug}/projects/{project-slug}/`
4. Use these exact slugs in `SENTRY_PROJECT_SLUGS`

## Verifying Your Setup

After configuration, run the verification script:

```bash
npm run build
node dist/verify-sentry-config.js
```

This will:
- List all accessible projects
- Verify your configuration
- Show any permission issues

## Troubleshooting

### 403 Forbidden Errors

If you see 403 errors:
1. Ensure you're using an Internal Integration token, not an Organization Auth Token
2. Check that all permissions are set correctly
3. Verify the organization and project slugs are correct

### Token Types Quick Reference

| Token Type | Prefix | Use Case | API Access |
|------------|--------|----------|------------|
| Organization Auth | `sntrys_` | CI/CD, Source Maps | Very Limited |
| Internal Integration | Various | Full API automation | Full (configurable) |
| User Auth | `sntryu_` | Personal scripts | Based on user permissions |

## Security Best Practices

1. **Never commit tokens** to version control
2. **Use separate tokens** for different environments
3. **Rotate tokens** regularly
4. **Monitor token usage** in Sentry's audit log
5. **Revoke unused tokens** promptly

## Next Steps

Once your Internal Integration is set up:

1. Run `npm start` to start Sentrypede
2. Monitor the logs for successful Sentry connections
3. Configure Slack integration (see `docs/slack-setup.md`)
4. Set up GitHub access (see `docs/github-setup.md`) 