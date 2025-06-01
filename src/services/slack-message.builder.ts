import { KnownBlock } from '@slack/bolt';
import { SentryIssue, SentryEvent } from './sentry';
import { TemplateService } from './template.service';

// AnalysisData interface (can be shared or kept here if specific to message building)
interface AnalysisData {
  summary: string;
  cause: string;
  suggestion: string;
  confidence: number;
}

// --- Helper Functions (formatting, emojis - specific to Slack message appearance) ---

function getSeverityEmoji(level: string): string {
  const emojis: Record<string, string> = {
    fatal: '💀',
    error: '🔴',
    warning: '⚠️',
    info: 'ℹ️',
  };
  return emojis[level] || '🔵';
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat().format(num);
}

function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMins > 0) return `${diffMins}m ago`;
  return 'just now';
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

function getRelevantStackFrame(event: SentryEvent): any {
  const exception = event.entries?.find(e => e.type === 'exception');
  const frames = exception?.data?.values?.[0]?.stacktrace?.frames;
  return frames?.[frames.length - 1]; // Get the last frame (most recent call)
}

function getStatusEmojiForText(status: string): string {
    const statusLower = status.toLowerCase();
    if (statusLower.includes('analyz')) return '🔍';
    if (statusLower.includes('fetch')) return '📥';
    if (statusLower.includes('generat') || statusLower.includes('creat')) return '🔨';
    if (statusLower.includes('test')) return '🧪';
    if (statusLower.includes('complete') || statusLower.includes('success')) return '✅';
    if (statusLower.includes('fail') || statusLower.includes('error')) return '❌';
    return '🔄';
}

// --- Slack Message Builder Service ---

export class SlackMessageBuilderService {
  private templateService: TemplateService;

  constructor() {
    this.templateService = new TemplateService();
  }

  public createInitialIssueBlocks(issue: SentryIssue, event?: SentryEvent): KnownBlock[] {
    const summaryLines = [
      `📍 *${issue.project.name}* (${issue.tags?.find(t => t.key === 'environment')?.value || 'unknown'})`,
      `🔢 ${formatNumber(parseInt(issue.count))} occurrences affecting ${formatNumber(issue.userCount)} users`,
      `⏱️ First seen ${getRelativeTime(new Date(issue.firstSeen))}`,
    ];
    const browserTag = issue.tags?.find(t => t.key === 'browser');
    if (browserTag) {
      summaryLines.push(`🌐 ${browserTag.value}`);
    }

    const headerText = this.templateService.render('initial-issue-blocks-header', {
      severityEmoji: getSeverityEmoji(issue.level),
      level_uppercase: issue.level.toUpperCase(),
      metadata: { type: truncateText(issue.metadata.type, 50) }, // Pass truncated type
    });

    const summarySectionText = this.templateService.render('initial-issue-blocks-summary-section', {
      title: truncateText(issue.title, 150),
      summaryLines: summaryLines.join('\n'),
    });

    const blocks: KnownBlock[] = [
      { type: 'header', text: { type: 'plain_text', text: headerText, emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: summarySectionText } },
    ];

    if (issue.culprit) {
      blocks.push({ 
        type: 'section', 
        text: { type: 'mrkdwn', text: this.templateService.render('initial-issue-blocks-culprit-section', { culprit: issue.culprit }) }
      });
    }

    if (issue.metadata.value && issue.metadata.value !== issue.title) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: this.templateService.render('initial-issue-blocks-metadata-section', { metadata: { value: truncateText(issue.metadata.value, 200) } }) }
      });
    }

    if (event?.entries) {
      const stackFrame = getRelevantStackFrame(event);
      if (stackFrame && stackFrame.filename && stackFrame.lineno) {
        blocks.push({
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: this.templateService.render('initial-issue-blocks-stackframe-context', {
              filename: stackFrame.filename,
              lineno: stackFrame.lineno,
              functionName: stackFrame.function || 'anonymous',
            })
          }],
        });
      }
    }

    blocks.push(
      { type: 'divider' },
      { type: 'actions', elements: [ { type: 'button', text: { type: 'plain_text', text: 'View in Sentry' }, url: issue.permalink } ] }
    );
    return blocks;
  }

  public getInitialIssueFallbackText(issue: SentryIssue): string {
    return this.templateService.render('initial-issue-fallback', {
      level: issue.level,
      project: { name: issue.project.name }, // Template expects project.name
      title: truncateText(issue.title, 100),
    });
  }

  public createAnalysisReportBlocks(analysis: AnalysisData): KnownBlock[] {
    const confidenceEmoji = analysis.confidence > 0.7 ? '🟢' : analysis.confidence > 0.4 ? '🟡' : '🔴';
    const mainSectionText = this.templateService.render('analysis-report-main-section', {
      summary: analysis.summary,
      cause: analysis.cause,
      confidenceEmoji: confidenceEmoji,
      confidencePercentage: Math.round(analysis.confidence * 100),
    });
    const suggestionSectionText = this.templateService.render('analysis-report-suggestion-section', {
      suggestion: analysis.suggestion,
    });

    return [
      { type: 'section', text: { type: 'mrkdwn', text: mainSectionText } },
      { type: 'section', text: { type: 'mrkdwn', text: suggestionSectionText } },
    ];
  }

  public getAnalysisReportFallbackText(): string {
    return this.templateService.render('analysis-report-fallback');
  }

  public createSuccessBlocks(prUrl: string, summary?: string): KnownBlock[] {
    const mainSectionText = this.templateService.render('success-main-section', {
      summaryOptional: summary ? `\n\n${summary}` : '',
      prUrl: prUrl,
    });
    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: mainSectionText },
        accessory: { type: 'button', text: { type: 'plain_text', text: 'Review PR' }, url: prUrl, style: 'primary' },
      },
    ];
  }

  public getSuccessFallbackText(): string {
    return this.templateService.render('success-fallback');
  }

  public createFailureBlocks(reason: string, issuePermalink?: string, suggestions?: string[]): KnownBlock[] {
    const nextStepsOptional = (suggestions && suggestions.length > 0) 
      ? `\n\n*Next steps:*\n${suggestions.map(s => `• ${s}`).join('\n')}` 
      : '';
    const mainSectionText = this.templateService.render('failure-main-section', {
      reason: reason,
      nextStepsOptional: nextStepsOptional,
    });

    const blocks: KnownBlock[] = [
      { type: 'section', text: { type: 'mrkdwn', text: mainSectionText } },
    ];

    if (issuePermalink) {
      blocks.push({ 
        type: 'actions', 
        elements: [ { type: 'button', text: { type: 'plain_text', text: 'View in Sentry' }, url: issuePermalink } ] 
      });
    }
    return blocks;
  }

  public getFailureFallbackText(): string {
    return this.templateService.render('failure-fallback');
  }

  public createStatusMessageText(status: string, details?: string): string {
    return this.templateService.render('status-update', {
      emoji: getStatusEmojiForText(status),
      status: status,
      detailsOptional: details ? `\n${details}` : '',
    });
  }

  public createAgentStatusMessage(stats: { active: number; fixed: number; failed: number }): { text: string } {
    return { text: this.templateService.render('agent-status', stats) };
  }

  public createHelpMessage(): { text: string } {
    return { text: this.templateService.render('agent-help') };
  }

  public createDefaultReply(): { text: string } {
    return { text: this.templateService.render('agent-default-reply') };
  }
} 