import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger';
import { GeminiConfig } from '../config';
import { SentryIssue, SentryEvent } from './sentry';

export interface ErrorAnalysis {
  summary: string;
  rootCause: string;
  suggestedFix: string;
  confidence: number;
  affectedFiles: string[];
  explanation: string;
}

export interface CodeFix {
  filePath: string;
  originalCode: string;
  fixedCode: string;
  changes: string[];
}

export interface FixResult {
  analysis: ErrorAnalysis;
  fixes: CodeFix[];
  testCode?: string;
  pullRequestDescription: string;
}

interface StackFrame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
}

interface Breadcrumb {
  category?: string;
  message?: string;
  data?: {
    url?: string;
  };
}

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(config: GeminiConfig) {
    this.genAI = new GoogleGenerativeAI(config.apiKey);
    this.model = this.genAI.getGenerativeModel({ 
      model: config.model,
      generationConfig: {
        maxOutputTokens: config.maxTokens,
        temperature: 0.3, // Lower temperature for more consistent code generation
      },
    });
  }

  /**
   * Analyze a Sentry error and generate a fix
   */
  async analyzeAndFix(
    issue: SentryIssue,
    event: SentryEvent | null,
    codeContext?: { [filePath: string]: string }
  ): Promise<FixResult> {
    try {
      // First, analyze the error
      const analysis = await this.analyzeError(issue, event);
      
      // Then generate fixes based on the analysis
      const fixes = await this.generateFixes(issue, event, analysis, codeContext);
      
      // Generate test code if applicable
      const testCode = await this.generateTestCode(issue, fixes);
      
      // Create PR description
      const pullRequestDescription = this.createPullRequestDescription(issue, analysis, fixes);
      
      return {
        analysis,
        fixes,
        ...(testCode !== undefined && { testCode }),
        pullRequestDescription,
      };
    } catch (error) {
      logger.error('Failed to analyze and fix error', { error, issueId: issue.id });
      throw error;
    }
  }

  /**
   * Analyze the error to understand root cause
   */
  private async analyzeError(issue: SentryIssue, event: SentryEvent | null): Promise<ErrorAnalysis> {
    const prompt = this.buildAnalysisPrompt(issue, event);
    
    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      return this.parseAnalysisResponse(text);
    } catch (error) {
      logger.error('Failed to analyze error', { error });
      throw error;
    }
  }

  /**
   * Generate code fixes based on the analysis. Made public to allow use with external analysis.
   */
  public async generateFixes(
    issue: SentryIssue,
    event: SentryEvent | null,
    analysis: ErrorAnalysis,
    codeContext?: { [filePath: string]: string }
  ): Promise<CodeFix[]> {
    const fixes: CodeFix[] = [];
    
    for (const filePath of analysis.affectedFiles) {
      const originalCode = codeContext?.[filePath] || '';
      
      if (!originalCode) {
        logger.warn('No code context for file', { filePath });
        continue;
      }
      
      const fixPrompt = this.buildFixPrompt(issue, event, analysis, filePath, originalCode);
      
      try {
        const result = await this.model.generateContent(fixPrompt);
        const response = await result.response;
        const text = response.text();
        
        const fix = this.parseFixResponse(filePath, originalCode, text);
        if (fix) {
          fixes.push(fix);
        }
      } catch (error) {
        logger.error('Failed to generate fix for file', { error, filePath });
      }
    }
    
    return fixes;
  }

  /**
   * Generate test code for the fixes
   */
  private async generateTestCode(issue: SentryIssue, fixes: CodeFix[]): Promise<string | undefined> {
    if (fixes.length === 0) return undefined;
    
    const prompt = this.buildTestPrompt(issue, fixes);
    
    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return this.extractCodeBlock(response.text());
    } catch (error) {
      logger.error('Failed to generate test code', { error });
      return undefined;
    }
  }

  /**
   * Build analysis prompt
   */
  private buildAnalysisPrompt(issue: SentryIssue, event: SentryEvent | null): string {
    let prompt = `Analyze this error from a production application and provide a detailed analysis.

Error Information:
- Type: ${issue.metadata.type}
- Message: ${issue.title}
- Count: ${issue.count} occurrences
- Users Affected: ${issue.userCount}
- First Seen: ${issue.firstSeen}
- Last Seen: ${issue.lastSeen}
`;

    if (issue.culprit) {
      prompt += `- Location: ${issue.culprit}\n`;
    }

    if (event) {
      // Add stack trace
      const stackTrace = this.extractStackTrace(event);
      if (stackTrace) {
        prompt += `\nStack Trace:\n${stackTrace}\n`;
      }

      // Add breadcrumbs
      const breadcrumbs = this.extractBreadcrumbs(event);
      if (breadcrumbs) {
        prompt += `\nRecent Actions (Breadcrumbs):\n${breadcrumbs}\n`;
      }
    }

    prompt += `
Please provide a JSON response with the following structure:
{
  "summary": "Brief summary of the error",
  "rootCause": "Detailed explanation of the root cause",
  "suggestedFix": "High-level description of how to fix it",
  "confidence": 0.0-1.0,
  "affectedFiles": ["file1.js", "file2.js"],
  "explanation": "Detailed explanation of why this error occurs and how the fix addresses it"
}`;

    return prompt;
  }

  /**
   * Build fix generation prompt
   */
  private buildFixPrompt(
    issue: SentryIssue,
    _event: SentryEvent | null,
    analysis: ErrorAnalysis,
    filePath: string,
    originalCode: string
  ): string {
    return `Based on this error analysis, generate a fix for the code.

Error: ${issue.title}
Root Cause: ${analysis.rootCause}
Suggested Fix: ${analysis.suggestedFix}

File: ${filePath}
Original Code:
\`\`\`javascript
${originalCode}
\`\`\`

Generate the fixed code that addresses the root cause. The fix should:
1. Handle the error case properly
2. Maintain backward compatibility
3. Follow the existing code style
4. Include helpful comments explaining the fix

Respond with ONLY the complete fixed code, no explanations.`;
  }

  /**
   * Build test generation prompt
   */
  private buildTestPrompt(issue: SentryIssue, fixes: CodeFix[]): string {
    const mainFix = fixes[0];
    
    return `Generate a unit test that verifies the fix for this error:

Error: ${issue.title}

Fixed Code:
\`\`\`javascript
${mainFix.fixedCode}
\`\`\`

Changes Made:
${mainFix.changes.join('\n')}

Generate a comprehensive unit test that:
1. Tests the error case that was fixed
2. Tests the happy path still works
3. Uses Jest or similar testing framework
4. Includes descriptive test names

Respond with ONLY the test code.`;
  }

  /**
   * Parse analysis response from Gemini
   */
  private parseAnalysisResponse(text: string): ErrorAnalysis {
    try {
      // Extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        summary: parsed.summary || 'Error analysis',
        rootCause: parsed.rootCause || 'Unknown root cause',
        suggestedFix: parsed.suggestedFix || 'No fix suggested',
        confidence: parsed.confidence || 0.5,
        affectedFiles: parsed.affectedFiles || [],
        explanation: parsed.explanation || 'No explanation provided',
      };
    } catch (error) {
      logger.error('Failed to parse analysis response', { error, text });
      
      // Return a default analysis
      return {
        summary: 'Failed to analyze error',
        rootCause: 'Analysis failed',
        suggestedFix: 'Manual investigation required',
        confidence: 0.1,
        affectedFiles: [],
        explanation: 'The AI analysis failed to parse correctly',
      };
    }
  }

  /**
   * Parse fix response from Gemini
   */
  private parseFixResponse(filePath: string, originalCode: string, text: string): CodeFix | null {
    try {
      const fixedCode = this.extractCodeBlock(text);
      
      if (!fixedCode || fixedCode === originalCode) {
        return null;
      }
      
      // Identify changes
      const changes = this.identifyChanges(originalCode, fixedCode);
      
      return {
        filePath,
        originalCode,
        fixedCode,
        changes,
      };
    } catch (error) {
      logger.error('Failed to parse fix response', { error });
      return null;
    }
  }

  /**
   * Extract code block from markdown
   */
  private extractCodeBlock(text: string): string {
    // Try to extract code from markdown code blocks
    const codeBlockMatch = text.match(/```(?:javascript|js|typescript|ts)?\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }
    
    // If no code block, assume the entire response is code
    return text.trim();
  }

  /**
   * Extract stack trace from Sentry event
   */
  private extractStackTrace(event: SentryEvent): string | null {
    const exception = event.entries?.find(e => e.type === 'exception');
    if (!exception?.data?.values?.[0]?.stacktrace?.frames) {
      return null;
    }
    
    const frames = exception.data.values[0].stacktrace.frames as StackFrame[];
    return frames
      .slice(-5) // Get last 5 frames (most relevant)
      .map((frame: StackFrame) => `  at ${frame.function || 'anonymous'} (${frame.filename}:${frame.lineno}:${frame.colno})`)
      .join('\n');
  }

  /**
   * Extract breadcrumbs from Sentry event
   */
  private extractBreadcrumbs(event: SentryEvent): string | null {
    const breadcrumbs = event.entries?.find(e => e.type === 'breadcrumbs');
    if (!breadcrumbs?.data?.values) {
      return null;
    }
    
    return (breadcrumbs.data.values as Breadcrumb[])
      .slice(-5) // Get last 5 breadcrumbs
      .map((b: Breadcrumb) => `  [${b.category}] ${b.message || b.data?.url || 'No message'}`)
      .join('\n');
  }

  /**
   * Identify changes between original and fixed code
   */
  private identifyChanges(original: string, fixed: string): string[] {
    const changes: string[] = [];
    
    // Simple line-by-line comparison
    const originalLines = original.split('\n');
    const fixedLines = fixed.split('\n');
    
    // Look for added error handling
    if (fixed.includes('try') && !original.includes('try')) {
      changes.push('Added try-catch error handling');
    }
    
    if (fixed.includes('if (') && fixed.includes('null') && !original.includes('null')) {
      changes.push('Added null/undefined checks');
    }
    
    if (fixed.includes('?.') && !original.includes('?.')) {
      changes.push('Added optional chaining');
    }
    
    if (fixed.includes('??') && !original.includes('??')) {
      changes.push('Added nullish coalescing');
    }
    
    if (fixedLines.length > originalLines.length) {
      changes.push(`Added ${fixedLines.length - originalLines.length} lines of code`);
    }
    
    return changes.length > 0 ? changes : ['Modified code to fix the error'];
  }

  /**
   * Create pull request description
   */
  private createPullRequestDescription(
    issue: SentryIssue,
    analysis: ErrorAnalysis,
    fixes: CodeFix[]
  ): string {
    const filesList = fixes.map(f => `- \`${f.filePath}\``).join('\n');
    const changesList = fixes.flatMap(f => f.changes).map(c => `- ${c}`).join('\n');
    
    return `## 🤖 AI-Generated Fix for Sentry Issue

This pull request was automatically generated by Sentrypede using AI analysis.

### 📋 Issue Details
- **Sentry Issue ID**: ${issue.id}
- **Error**: ${issue.title}
- **Occurrences**: ${issue.count}
- **Users Affected**: ${issue.userCount}

### 🔍 Analysis
**Summary**: ${analysis.summary}

**Root Cause**: ${analysis.rootCause}

**Confidence**: ${Math.round(analysis.confidence * 100)}%

### 📝 Changes Made
${filesList}

**Modifications**:
${changesList}

### 💡 Explanation
${analysis.explanation}

### ⚠️ Important Notes
- This fix was generated by AI with ${Math.round(analysis.confidence * 100)}% confidence
- Please review carefully before merging
- Consider adding tests if not included
- Verify the fix doesn't introduce new issues

---
*Generated by [Sentrypede](https://github.com/sentrypede) 🐛🤖 powered by Google Gemini*`;
  }

  /**
   * Simple method to test if Gemini is accessible
   */
  async testConnection(): Promise<boolean> {
    try {
      const result = await this.model.generateContent('Say "Hello, Sentrypede!"');
      const response = await result.response;
      const text = response.text();
      logger.info('Gemini connection test successful', { response: text });
      return true;
    } catch (error) {
      logger.error('Gemini connection test failed', { error });
      return false;
    }
  }
} 