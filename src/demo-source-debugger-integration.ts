#!/usr/bin/env npx ts-node

import { loadConfig } from './config';
import { SentryServiceFactory } from './services/sentry-factory';
import { SlackService } from './services/slack';
import { GeminiService } from './services/gemini';
import { SourceFileRetrievalService } from './services/source-file-retrieval';
import { FileCache } from './services/file-cache';
import { SentryIssue } from './services/sentry';
import { StackTraceParser } from './utils/stack-trace-parser';
import { logger } from './utils/logger';

interface EnhancedAnalysisResult {
  error: {
    title: string;
    message: string;
    url: string;
    occurrences: string;
    userCount: number;
  };
  sourceContext: {
    primaryFile: {
      path: string;
      language: string;
      errorLine: number;
      errorFunction: string;
      contextLines: string;
    };
    relatedFiles: Array<{
      path: string;
      language: string;
    }>;
    repositoryInfo: {
      owner: string;
      repo: string;
      commitSha: string;
    };
  };
  analysis: {
    rootCause: string;
    recommendation: string;
    confidence: string;
    riskLevel: string;
    fixSuggestion: string;
  };
}

async function demonstrateSourceDebugger(): Promise<void> {
  logger.info('🔍 Starting Enhanced Source Debugger Integration Demo...');

  try {
    // Load configuration
    const config = loadConfig();
    
    // Initialize services
    const sentryServiceResult = await SentryServiceFactory.create(config.sentry);
    const sentryService = sentryServiceResult.service;
    const slackService = new SlackService(config.slack);
    const geminiService = new GeminiService(config.gemini);
    
    // Initialize source file retrieval with caching
    const fileCache = new FileCache({
      maxSizeBytes: 100 * 1024 * 1024, // 100MB
      maxEntries: 500,
      ttlMs: 60 * 60 * 1000, // 1 hour
    });
    const sourceFileService = new SourceFileRetrievalService(config.github, fileCache);

    logger.info('📡 Fetching recent Sentry issues...');
    
    // Fetch recent issues from Sentry
    const issues = await sentryService.fetchRecentIssues();
    logger.info(`Found ${issues.length} recent issues`);

    if (issues.length === 0) {
      logger.warn('No recent issues found. Please check your Sentry configuration.');
      return;
    }

    // Enhanced issue analysis and selection
    logger.info('🔍 Analyzing issues for source debugger compatibility...');
    const candidateIssues = await analyzeAndRankIssues(issues, sentryService);
    
    if (candidateIssues.length === 0) {
      logger.warn('No suitable issues found for source debugging. Trying basic analysis on first error...');
      const firstError = issues.find(issue => issue.level === 'error');
      if (firstError) {
        await performBasicAnalysis(firstError, geminiService, slackService);
      }
      return;
    }

    // Try each candidate until we find one with source context
    let successfulAnalysis = false;
    
    for (const candidate of candidateIssues.slice(0, 3)) { // Try top 3 candidates
      logger.info(`🎯 Trying issue: ${candidate.issue.title}`, {
        issueId: candidate.issue.id,
        score: candidate.score,
        hasStackTrace: candidate.hasStackTrace,
        environment: candidate.environment,
        platform: candidate.platform,
      });

      try {
        // Get detailed event information
        const latestEvent = await sentryService.getLatestEvent(candidate.issue.id);
        
        // NEW: Create source analysis context using Phase 9.1 features
        logger.info('🔧 Creating source analysis context...');
        const sourceContext = await sourceFileService.createAnalysisContext(latestEvent);
        
        if (sourceContext) {
          logger.info('✨ Source context created successfully!', {
            primaryFile: sourceContext.primaryFile.filePath,
            relatedFiles: sourceContext.relatedFiles.length,
            language: sourceContext.primaryFile.fileInfo.language,
            commitSha: sourceContext.repositoryInfo.commitSha.substring(0, 8),
          });

          // Enhanced AI analysis with source code context
          logger.info('🧠 Performing enhanced AI analysis with source code...');
          const analysis = await performEnhancedAnalysis(
            candidate.issue,
            sourceContext,
            geminiService
          );

          // Post enhanced results to Slack
          logger.info('📤 Posting enhanced analysis to Slack...');
          await postEnhancedResultsToSlack(analysis, slackService);
          
          successfulAnalysis = true;
          break;
        } else {
          logger.warn(`Could not create source context for issue ${candidate.issue.id}, trying next candidate...`);
        }
      } catch (error) {
        logger.warn(`Failed to analyze issue ${candidate.issue.id}:`, { error });
        continue;
      }
    }

    if (!successfulAnalysis) {
      logger.warn('Could not create source analysis context for any candidate. Falling back to basic analysis.');
      await performBasicAnalysis(candidateIssues[0].issue, geminiService, slackService);
    }

    // Display cache statistics
    const cacheStats = sourceFileService.getCacheStats();
    logger.info('📊 Source file cache statistics:', {
      totalEntries: cacheStats.totalEntries,
      totalSizeKB: Math.round(cacheStats.totalSizeBytes / 1024),
      hitRate: Math.round(cacheStats.hitRate * 100) + '%',
    });

    logger.info('🎉 Source Debugger Integration Demo completed successfully!');

  } catch (error) {
    logger.error('💥 Integration demo failed:', { error });
    throw error;
  }
}

interface IssueCandidate {
  issue: SentryIssue;
  score: number;
  hasStackTrace: boolean;
  environment: string;
  platform: string;
  stackFrameCount: number;
  hasAppFrames: boolean;
}

async function analyzeAndRankIssues(
  issues: SentryIssue[],
  sentryService: any
): Promise<IssueCandidate[]> {
  const candidates: IssueCandidate[] = [];
  
  for (const issue of issues) {
    if (!sentryService.shouldProcessIssue(issue) || issue.level !== 'error') {
      continue;
    }

    try {
      // Get event details to analyze stack trace
      const event = await sentryService.getLatestEvent(issue.id);
      const stackTrace = StackTraceParser.parseFromSentryEvent(event);
      
      const environment = issue.tags?.find(t => t.key === 'environment')?.value || 'unknown';
      const platform = event.platform || 'unknown';
      
      let score = 0;
      let hasStackTrace = false;
      let stackFrameCount = 0;
      let hasAppFrames = false;

      if (stackTrace && stackTrace.frames.length > 0) {
        hasStackTrace = true;
        stackFrameCount = stackTrace.frames.length;
        hasAppFrames = stackTrace.frames.some(frame => frame.in_app);
        
        // Score based on stack trace quality
        score += hasStackTrace ? 10 : 0;
        score += hasAppFrames ? 20 : 0;
        score += Math.min(stackFrameCount, 10); // Up to 10 points for frame count
        
        // Prefer certain environments (dev/staging likely to have unmapped source)
        if (environment === 'development') score += 15;
        else if (environment === 'staging') score += 10;
        else if (environment === 'production') score += 5;
        
        // Prefer JavaScript/TypeScript platforms
        if (platform === 'javascript' || platform === 'node') score += 10;
        
        // Prefer errors with repository paths
        if (stackTrace.repositoryPaths.length > 0) score += 15;
        
        // Prefer errors with clear error locations
        if (stackTrace.errorLocation) score += 10;
        
        logger.info(`Issue candidate analysis:`, {
          issueId: issue.id,
          title: issue.title.substring(0, 60) + '...',
          score,
          hasStackTrace,
          stackFrameCount,
          hasAppFrames,
          environment,
          platform,
          repositoryPaths: stackTrace.repositoryPaths.length,
          hasErrorLocation: !!stackTrace.errorLocation,
        });
      }

      if (score > 5) { // Minimum threshold
        candidates.push({
          issue,
          score,
          hasStackTrace,
          environment,
          platform,
          stackFrameCount,
          hasAppFrames,
        });
      }
    } catch (error) {
      logger.debug(`Failed to analyze issue ${issue.id}:`, { error });
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  
  logger.info(`Found ${candidates.length} candidate issues for source debugging`, {
    topScores: candidates.slice(0, 5).map(c => ({ 
      id: c.issue.id, 
      score: c.score, 
      env: c.environment,
      hasStackTrace: c.hasStackTrace,
      hasAppFrames: c.hasAppFrames,
    }))
  });

  return candidates;
}

async function performEnhancedAnalysis(
  issue: SentryIssue,
  sourceContext: any,
  geminiService: GeminiService
): Promise<EnhancedAnalysisResult> {
  // Create enhanced prompt with actual source code context
  const errorLines = sourceContext.primaryFile.contextLines.lines
    .map((line: any) => 
      `${line.number.toString().padStart(3)}: ${line.isErrorLine ? '>>> ' : '    '}${line.content}`
    )
    .join('\n');

  try {
    // Build comprehensive analysis prompt
    const analysisPrompt = `Analyze this JavaScript/TypeScript error with actual source code context and provide specific, actionable fix recommendations.

**Error Details:**
- Title: ${issue.title}
- Type: ${issue.metadata?.type || 'Unknown'}
- Occurrences: ${issue.count} times
- Users Affected: ${issue.userCount}
- Platform: javascript
- File: ${sourceContext.primaryFile.filePath}
- Language: ${sourceContext.primaryFile.fileInfo.language}

**Source Code Context (line ${sourceContext.primaryFile.errorLocation?.line || 'unknown'}):**
\`\`\`${sourceContext.primaryFile.fileInfo.language}
${errorLines}
\`\`\`

**Related Files in Stack Trace:**
${sourceContext.relatedFiles.map((file: any) => `- ${file.filePath} (${file.fileInfo.language})`).join('\n')}

**Repository Info:**
- Owner: ${sourceContext.repositoryInfo.owner}
- Repo: ${sourceContext.repositoryInfo.repo}
- Commit: ${sourceContext.repositoryInfo.commitSha.substring(0, 12)}

Please provide a detailed JSON response with the following structure:
{
  "rootCause": "Specific technical explanation based on the actual code",
  "fixRecommendation": "Concrete code changes or patterns to implement",
  "codeExample": "Actual code snippet showing the fix (if applicable)",
  "confidenceScore": "8/10",
  "riskLevel": "Low|Medium|High with explanation",
  "testingGuidance": "Specific test cases to verify the fix",
  "preventionTips": "How to prevent similar issues in the future",
  "additionalContext": "Any patterns or dependencies noticed in the code"
}

Focus on the actual source code provided and give specific, implementable recommendations rather than generic advice.`;

    // Send to Gemini for analysis
    const result = await geminiService.testConnection();
    if (!result) {
      throw new Error('Gemini connection failed');
    }

    // Use Gemini's analysis capabilities (accessing the private model)
    const model = (geminiService as any).model;
    const aiResult = await model.generateContent(analysisPrompt);
    const response = await aiResult.response;
    const aiText = response.text();

    logger.info('Received AI analysis response', {
      responseLength: aiText.length,
      eventId: sourceContext.repositoryInfo.commitSha.substring(0, 8)
    });

    // Parse AI response
    let parsedAnalysis;
    try {
      // Extract JSON from the response
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedAnalysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in AI response');
      }
    } catch (parseError) {
      logger.warn('Failed to parse AI response as JSON, using text analysis', { parseError });
      // Fallback to text parsing
      parsedAnalysis = {
        rootCause: extractSection(aiText, 'Root Cause') || 'AI analysis indicates a runtime error requiring investigation',
        fixRecommendation: extractSection(aiText, 'Fix') || 'Review the code context and implement proper error handling',
        codeExample: extractCodeBlock(aiText) || null,
        confidenceScore: '7/10',
        riskLevel: 'Medium - requires careful testing',
        testingGuidance: extractSection(aiText, 'Test') || 'Create unit tests that reproduce the error condition',
        preventionTips: 'Add type checking and null/undefined guards',
        additionalContext: aiText.substring(0, 200) + '...'
      };
    }

    return {
      error: {
        title: issue.title,
        message: issue.metadata?.value || 'No message available',
        url: issue.permalink,
        occurrences: issue.count,
        userCount: issue.userCount,
      },
      sourceContext: {
        primaryFile: {
          path: sourceContext.primaryFile.filePath,
          language: sourceContext.primaryFile.fileInfo.language || 'unknown',
          errorLine: sourceContext.primaryFile.errorLocation?.line || 0,
          errorFunction: sourceContext.primaryFile.errorLocation?.function || 'unknown',
          contextLines: errorLines,
        },
        relatedFiles: sourceContext.relatedFiles.map((file: any) => ({
          path: file.filePath,
          language: file.fileInfo.language || 'unknown',
        })),
        repositoryInfo: {
          owner: sourceContext.repositoryInfo.owner,
          repo: sourceContext.repositoryInfo.repo,
          commitSha: sourceContext.repositoryInfo.commitSha,
        },
      },
      analysis: {
        rootCause: parsedAnalysis.rootCause || 'Analysis not available',
        recommendation: parsedAnalysis.fixRecommendation || 'No specific recommendation',
        confidence: parsedAnalysis.confidenceScore || 'Unknown',
        riskLevel: parsedAnalysis.riskLevel || 'Unknown',
        fixSuggestion: formatAIAnalysis(parsedAnalysis),
      },
    };
  } catch (error) {
    logger.error('Failed to perform enhanced analysis:', { error });
    
    // Fallback to basic analysis
    return {
      error: {
        title: issue.title,
        message: issue.metadata?.value || 'No message available',
        url: issue.permalink,
        occurrences: issue.count,
        userCount: issue.userCount,
      },
      sourceContext: {
        primaryFile: {
          path: sourceContext.primaryFile.filePath,
          language: sourceContext.primaryFile.fileInfo.language || 'unknown',
          errorLine: sourceContext.primaryFile.errorLocation?.line || 0,
          errorFunction: sourceContext.primaryFile.errorLocation?.function || 'unknown',
          contextLines: errorLines,
        },
        relatedFiles: sourceContext.relatedFiles.map((file: any) => ({
          path: file.filePath,
          language: file.fileInfo.language || 'unknown',
        })),
        repositoryInfo: {
          owner: sourceContext.repositoryInfo.owner,
          repo: sourceContext.repositoryInfo.repo,
          commitSha: sourceContext.repositoryInfo.commitSha,
        },
      },
      analysis: {
        rootCause: 'AI analysis failed - manual investigation required',
        recommendation: 'Review the source code and stack trace for potential issues',
        confidence: 'Low',
        riskLevel: 'Unknown',
        fixSuggestion: 'Error analysis unavailable. Please review the code context manually.',
      },
    };
  }
}

function formatAIAnalysis(analysis: any): string {
  let formatted = '';

  if (analysis.rootCause) {
    formatted += `**🔍 Root Cause Analysis:**\n${analysis.rootCause}\n\n`;
  }

  if (analysis.fixRecommendation) {
    formatted += `**💡 Fix Recommendation:**\n${analysis.fixRecommendation}\n\n`;
  }

  if (analysis.codeExample) {
    formatted += `**📝 Code Example:**\n\`\`\`javascript\n${analysis.codeExample}\n\`\`\`\n\n`;
  }

  if (analysis.confidenceScore) {
    formatted += `**🎯 Confidence:** ${analysis.confidenceScore}\n\n`;
  }

  if (analysis.riskLevel) {
    formatted += `**⚠️ Risk Level:** ${analysis.riskLevel}\n\n`;
  }

  if (analysis.testingGuidance) {
    formatted += `**🧪 Testing Guidance:**\n${analysis.testingGuidance}\n\n`;
  }

  if (analysis.preventionTips) {
    formatted += `**🛡️ Prevention Tips:**\n${analysis.preventionTips}\n\n`;
  }

  if (analysis.additionalContext) {
    formatted += `**📋 Additional Context:**\n${analysis.additionalContext}`;
  }

  return formatted || 'Analysis completed - please review the source code context.';
}

function extractCodeBlock(text: string): string | null {
  // Try to extract code from markdown code blocks
  const codeBlockMatch = text.match(/```(?:javascript|js|typescript|ts)?\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  return null;
}

async function performBasicAnalysis(
  issue: SentryIssue,
  geminiService: GeminiService,
  slackService: SlackService
): Promise<void> {
  logger.info('📝 Performing basic analysis (no source code)...');

  const testResult = await geminiService.testConnection();
  const analysis = testResult ? 
    `Basic error analysis: This appears to be a ${issue.metadata?.type || 'runtime'} error that requires manual investigation. 

**Possible reasons for missing source context:**
• Error may be from minified/bundled JavaScript (source maps needed)
• Stack trace may not contain repository file paths
• Error might be from external dependencies (node_modules)

**Recommendation:** Check if this error has source maps available or occurs in development environment.` :
    'AI analysis not available at this time.';
  
  const environment = issue.tags?.find(t => t.key === 'environment')?.value || 'unknown';
  
  const message = `🔍 **Basic Sentry Analysis** (No Source Code Available)

**Error:** ${issue.title}
**Type:** ${issue.metadata?.type || 'Unknown'}
**Occurrences:** ${issue.count} times
**Users Affected:** ${issue.userCount}
**Environment:** ${environment}
**Sentry Link:** ${issue.permalink}

**Analysis:**
${analysis}

---
*✨ Powered by Sentrypede Source Debugger - Phase 9.1*
*💡 For enhanced analysis with source code, ensure errors have unmapped stack traces pointing to repository files*`;

  await slackService.postMessage(message);
}

async function postEnhancedResultsToSlack(
  analysis: EnhancedAnalysisResult,
  slackService: SlackService
): Promise<void> {
  const codeBlock = '```';
  
  const enhancedMessage = `🎯 **Enhanced Source Debugger Analysis** ✨

**🐛 Error Details:**
• **Title:** ${analysis.error.title}
• **Occurrences:** ${analysis.error.occurrences} times
• **Users Affected:** ${analysis.error.userCount}
• **Sentry Link:** ${analysis.error.url}

**📁 Source Context:**
• **Repository:** ${analysis.sourceContext.repositoryInfo.owner}/${analysis.sourceContext.repositoryInfo.repo}
• **Commit:** \`${analysis.sourceContext.repositoryInfo.commitSha.substring(0, 12)}\`
• **Primary File:** \`${analysis.sourceContext.primaryFile.path}\` (${analysis.sourceContext.primaryFile.language})
• **Error Location:** Line ${analysis.sourceContext.primaryFile.errorLine}, Function: \`${analysis.sourceContext.primaryFile.errorFunction}\`
• **Related Files:** ${analysis.sourceContext.relatedFiles.length} additional files analyzed

**💻 Code Context:**
${codeBlock}${analysis.sourceContext.primaryFile.language}
${analysis.sourceContext.primaryFile.contextLines}
${codeBlock}

**🔍 Analysis Results:**
${analysis.analysis.fixSuggestion}

**📊 Related Files:**
${analysis.sourceContext.relatedFiles.map(file => `• \`${file.path}\` (${file.language})`).join('\n')}

---
*✨ Powered by Sentrypede Source Debugger - Phase 9.1*
*🚀 This analysis includes actual source code context for precise debugging*`;

  await slackService.postMessage(enhancedMessage);
}

function extractSection(text: string, sectionName: string): string | null {
  const patterns = [
    new RegExp(`\\*\\*${sectionName}[^*]*\\*\\*:?\\s*([^*]+)`, 'i'),
    new RegExp(`${sectionName}:?\\s*([^\\n]+)`, 'i'),
    new RegExp(`\\d+\\.\\s*\\*\\*${sectionName}[^*]*\\*\\*:?\\s*([^*]+)`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

// Run the demonstration
if (require.main === module) {
  demonstrateSourceDebugger()
    .then(() => {
      logger.info('✅ Demo completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('❌ Demo failed:', { error });
      process.exit(1);
    });
}

export { demonstrateSourceDebugger }; 