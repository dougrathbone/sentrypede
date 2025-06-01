import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

export class TemplateService {
  private templateCache: Map<string, string> = new Map();
  // Correct base directory assuming this service is in src/services
  private baseDir = path.join(__dirname, '..', 'config', 'slack-templates'); 

  constructor() {
    // Optional: Preload templates if needed, or load on demand
  }

  private getTemplateContent(templateName: string): string {
    if (this.templateCache.has(templateName)) {
      return this.templateCache.get(templateName)!;
    }

    try {
      const templatePath = path.join(this.baseDir, `${templateName}.md`);
      const content = fs.readFileSync(templatePath, 'utf-8');
      this.templateCache.set(templateName, content);
      return content;
    } catch (error) {
      logger.error(`Failed to load template: ${templateName}`, { templatePath: path.join(this.baseDir, `${templateName}.md`), error });
      return `Error: Template ${templateName} not found.`; // Fallback content
    }
  }

  public render(templateName: string, data: Record<string, any> = {}): string {
    let content = this.getTemplateContent(templateName);
    
    // More robust placeholder replacement supporting dot notation for deep access
    content = content.replace(/{{\s*([\w.]+)\s*}}/g, (_match, placeholderKey) => {
      const keys = placeholderKey.split('.');
      let value: any = data;
      for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
          value = value[key];
        } else {
          logger.warn(`Placeholder {{${placeholderKey}}} not found in data for template ${templateName}.`);
          return `[missing_data_for_${placeholderKey.replace(/\s/g, '_')}]`; // Return a specific missing data string
        }
      }
      return String(value);
    });
    return content;
  }
} 