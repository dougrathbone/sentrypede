import * as fs from 'fs';
import * as path from 'path';
import { TemplateService } from './template.service';
import { logger } from '../utils/logger'; // Assuming logger path

// Mock fs.readFileSync and logger
jest.mock('fs');
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('TemplateService', () => {
  let templateService: TemplateService;
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    // Reset mocks for each test
    mockFs.readFileSync.mockReset();
    (logger.error as jest.Mock).mockReset();
    (logger.warn as jest.Mock).mockReset();
    templateService = new TemplateService(); 
    // Clear internal cache of TemplateService for isolation, if constructor doesn't already do it for tests
    (templateService as any).templateCache.clear(); 
  });

  it('should load and render a template with simple data', () => {
    const templateName = 'test-simple';
    const templateContent = 'Hello {{name}}!';
    mockFs.readFileSync.mockReturnValue(templateContent);

    const result = templateService.render(templateName, { name: 'World' });

    expect(result).toBe('Hello World!');
    expect(mockFs.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining(path.join('config', 'slack-templates', `${templateName}.md`)),
      'utf-8'
    );
  });

  it('should render a template with nested data', () => {
    const templateName = 'test-nested';
    const templateContent = 'User: {{user.name}}, Email: {{user.email}}';
    mockFs.readFileSync.mockReturnValue(templateContent);

    const result = templateService.render(templateName, { user: { name: 'John Doe', email: 'john@example.com' } });

    expect(result).toBe('User: John Doe, Email: john@example.com');
  });

  it('should handle missing placeholders gracefully', () => {
    const templateName = 'test-missing-placeholder';
    const templateContent = 'Hello {{name}}, welcome to {{place}}!';
    mockFs.readFileSync.mockReturnValue(templateContent);

    const result = templateService.render(templateName, { name: 'Alice' });

    expect(result).toBe('Hello Alice, welcome to [missing_data_for_place]!');
    expect(logger.warn).toHaveBeenCalledWith(
      `Placeholder {{place}} not found in data for template ${templateName}.`
    );
  });

  it('should handle missing nested data gracefully', () => {
    const templateName = 'test-missing-nested';
    const templateContent = 'User: {{user.name}}, City: {{user.address.city}}';
    mockFs.readFileSync.mockReturnValue(templateContent);

    const result = templateService.render(templateName, { user: { name: 'Bob' } });

    expect(result).toBe('User: Bob, City: [missing_data_for_user.address.city]');
    expect(logger.warn).toHaveBeenCalledWith(
      `Placeholder {{user.address.city}} not found in data for template ${templateName}.`
    );
  });

  it('should return error string if template file not found', () => {
    const templateName = 'non-existent-template';
    mockFs.readFileSync.mockImplementation(() => { 
      throw new Error('File not found'); 
    });

    const result = templateService.render(templateName, {});

    expect(result).toBe(`Error: Template ${templateName} not found.`);
    expect(logger.error).toHaveBeenCalledWith(
      `Failed to load template: ${templateName}`,
      expect.objectContaining({ 
        templatePath: expect.stringContaining(path.join('config', 'slack-templates', `${templateName}.md`)),
        error: expect.any(Error)
      })
    );
  });

  it('should use cached template content on subsequent calls', () => {
    const templateName = 'test-cached';
    const templateContent = 'Cache me: {{value}}';
    mockFs.readFileSync.mockReturnValue(templateContent);

    templateService.render(templateName, { value: 'First Call' });
    const result = templateService.render(templateName, { value: 'Second Call' });

    expect(result).toBe('Cache me: Second Call');
    expect(mockFs.readFileSync).toHaveBeenCalledTimes(1); // Should only be called once
  });
}); 