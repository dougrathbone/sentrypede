# Google Gemini AI Setup Guide

This guide will help you set up Google Gemini AI for Sentrypede to analyze errors and generate code fixes.

## Prerequisites

- Google Cloud account
- Google Cloud project with billing enabled

## Step 1: Enable the Gemini API

1. Go to the [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Get API key"
4. Choose "Create API key in new project" or select an existing project
5. Copy the generated API key

## Step 2: Configure Sentrypede

Add the following to your `.env` file:

```bash
# Google Gemini Configuration
GEMINI_API_KEY=your-api-key-here
GEMINI_MODEL=gemini-pro
GEMINI_MAX_TOKENS=4096
```

### Configuration Options

- **GEMINI_API_KEY**: Your Google AI API key (required)
- **GEMINI_MODEL**: The Gemini model to use (default: `gemini-pro`)
  - `gemini-pro`: Best for code analysis and generation
  - `gemini-pro-vision`: For multimodal tasks (not used by Sentrypede)
- **GEMINI_MAX_TOKENS**: Maximum tokens for responses (default: 4096)

## Step 3: Test the Connection

Run the Gemini test script:

```bash
npm run test:full
```

This will verify that Gemini is properly configured and can analyze code.

## Features

Sentrypede uses Gemini AI to:

1. **Analyze Errors**: Understand the root cause of Sentry errors
2. **Generate Fixes**: Create code patches to fix the issues
3. **Write Tests**: Generate unit tests for the fixes
4. **Create PR Descriptions**: Write detailed pull request descriptions

## How It Works

### 1. Error Analysis

When a new Sentry error is detected, Sentrypede sends the following to Gemini:
- Error type and message
- Stack trace
- Breadcrumbs (user actions leading to the error)
- Occurrence count and affected users

Gemini responds with:
- Summary of the error
- Root cause analysis
- Suggested fix approach
- Confidence level (0-1)
- List of affected files

### 2. Code Fix Generation

For each affected file, Sentrypede:
- Fetches the current code from GitHub
- Sends it to Gemini with the error context
- Receives the fixed code

Gemini identifies changes like:
- Adding try-catch blocks
- Adding null/undefined checks
- Adding optional chaining (`?.`)
- Adding nullish coalescing (`??`)
- Other error handling improvements

### 3. Test Generation

Gemini can generate unit tests that:
- Test the error case that was fixed
- Verify the happy path still works
- Use appropriate testing frameworks

### 4. Pull Request Creation

The AI-generated PR includes:
- Detailed issue information
- Analysis summary and confidence
- List of changes made
- Explanation of the fix
- Review instructions

## Best Practices

### 1. Code Context

For best results, ensure Sentrypede can access the relevant source files:
- Configure GitHub access properly
- Ensure file paths in Sentry errors are correct
- Use source maps for minified code

### 2. Confidence Thresholds

Sentrypede only creates PRs when confidence > 0.5. You can adjust this in the code:

```typescript
if (fixResult.analysis.confidence > 0.5) {
  // Create PR
}
```

### 3. Review Process

Always review AI-generated fixes:
- Check for unintended side effects
- Verify the fix addresses the root cause
- Ensure code style consistency
- Run tests before merging

## Troubleshooting

### API Key Issues

If you see authentication errors:
1. Verify your API key is correct
2. Check if the key has been revoked
3. Ensure billing is enabled on your Google Cloud project

### Rate Limits

Gemini has rate limits:
- 60 requests per minute
- 1,500 requests per day (free tier)

If you hit limits:
- Implement request queuing
- Upgrade to a paid plan
- Cache analysis results

### Model Errors

If Gemini fails to analyze:
- Check the error message format
- Ensure code context is provided
- Verify the model name is correct

## Example Analysis

Here's what a typical Gemini analysis looks like:

```json
{
  "summary": "Null reference error when accessing user properties",
  "rootCause": "The user object can be undefined when the function is called before authentication completes",
  "suggestedFix": "Add null checking before accessing user properties",
  "confidence": 0.85,
  "affectedFiles": ["src/utils/user.js"],
  "explanation": "The error occurs because the code assumes the user object always exists, but it can be undefined during the authentication flow. Adding proper null checks will prevent this error."
}
```

## Security Considerations

1. **API Key Security**: Never commit your API key to version control
2. **Code Privacy**: Be aware that code is sent to Google's servers
3. **Sensitive Data**: Ensure error messages don't contain sensitive information

## Cost Estimation

Gemini Pro pricing (as of 2024):
- Free tier: 60 queries/minute, up to 1,500/day
- Paid tier: $0.00025 per 1K characters input, $0.0005 per 1K characters output

Typical Sentrypede usage:
- Error analysis: ~2K characters input, ~1K output
- Code fix: ~5K characters input, ~3K output
- Total per issue: ~$0.004

## Integration with Sentrypede

The Gemini service is integrated into the Sentrypede workflow:

1. **Worker detects new Sentry issue** → Posts to Slack
2. **Fetches error details** → Sends to Gemini for analysis
3. **Gets code from GitHub** → Sends to Gemini for fix generation
4. **Creates pull request** → Includes AI analysis and confidence
5. **Updates Slack thread** → Shows progress and results

## Advanced Configuration

### Custom Prompts

You can customize the analysis prompts in `src/services/gemini.ts`:

```typescript
private buildAnalysisPrompt(issue: SentryIssue, event: SentryEvent | null): string {
  // Customize the prompt here
}
```

### Model Parameters

Adjust generation parameters:

```typescript
generationConfig: {
  maxOutputTokens: 4096,
  temperature: 0.3,  // Lower = more consistent
  topP: 0.8,         // Nucleus sampling
  topK: 40,          // Top-k sampling
}
```

## Monitoring

Track Gemini usage:
- Log all API calls and responses
- Monitor confidence scores
- Track fix success rates
- Measure time to resolution

## Future Enhancements

Potential improvements:
1. **Multi-file fixes**: Handle errors spanning multiple files
2. **Learning from feedback**: Improve based on PR reviews
3. **Custom training**: Fine-tune on your codebase
4. **Batch analysis**: Process multiple related errors together

---

For more information, see the [Google AI documentation](https://ai.google.dev/docs). 