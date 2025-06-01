import { StackTraceParser, StackFrame } from './stack-trace-parser';

describe('StackTraceParser', () => {
  describe('parseFromSentryEvent', () => {
    it('should parse a complete Sentry event with stack trace', () => {
      const sentryEvent = {
        id: 'test-event-1',
        entries: [
          {
            type: 'exception',
            data: {
              values: [
                {
                  stacktrace: {
                    frames: [
                      {
                        filename: 'webpack:///src/utils/helper.js',
                        function: 'validateInput',
                        lineno: 42,
                        colno: 15,
                        context_line: '  throw new Error("Invalid input");',
                        pre_context: ['function validateInput(data) {', '  if (!data) {'],
                        post_context: ['  }', '}'],
                        in_app: true,
                        module: 'utils/helper',
                        package: null,
                        abs_path: '/app/src/utils/helper.js',
                      },
                      {
                        filename: 'src/services/api.ts',
                        function: 'processRequest',
                        lineno: 128,
                        colno: 8,
                        context_line: '  const result = validateInput(data);',
                        in_app: true,
                      },
                      {
                        filename: 'node_modules/express/lib/router/index.js',
                        function: 'next',
                        lineno: 565,
                        colno: 12,
                        in_app: false,
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      };

      const result = StackTraceParser.parseFromSentryEvent(sentryEvent);

      expect(result).not.toBeNull();
      expect(result!.frames).toHaveLength(3);
      expect(result!.repositoryPaths).toEqual(['utils/helper.js', 'services/api.ts']);
      expect(result!.errorLocation).toEqual({
        filename: 'utils/helper.js',
        lineno: 42,
        colno: 15,
        function: 'validateInput',
      });
    });

    it('should return null for event without exception entry', () => {
      const sentryEvent = {
        id: 'test-event-2',
        entries: [
          {
            type: 'message',
            data: { message: 'Test message' },
          },
        ],
      };

      const result = StackTraceParser.parseFromSentryEvent(sentryEvent);
      expect(result).toBeNull();
    });

    it('should return object with empty arrays for event without stack trace frames', () => {
      const sentryEvent = {
        id: 'test-event-3',
        entries: [
          {
            type: 'exception',
            data: {
              values: [
                {
                  stacktrace: {
                    frames: [],
                  },
                },
              ],
            },
          },
        ],
      };

      const result = StackTraceParser.parseFromSentryEvent(sentryEvent);
      expect(result).toEqual({
        frames: [],
        repositoryPaths: [],
        errorLocation: null,
      });
    });

    it('should handle missing optional frame properties', () => {
      const sentryEvent = {
        id: 'test-event-4',
        entries: [
          {
            type: 'exception',
            data: {
              values: [
                {
                  stacktrace: {
                    frames: [
                      {
                        filename: 'src/minimal.js',
                        lineno: 10,
                        in_app: true,
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      };

      const result = StackTraceParser.parseFromSentryEvent(sentryEvent);

      expect(result).not.toBeNull();
      expect(result!.frames[0]).toEqual({
        filename: 'minimal.js',
        function: null,
        lineno: 10,
        colno: null,
        context_line: null,
        pre_context: null,
        post_context: null,
        in_app: true,
        module: null,
        package: null,
        abs_path: null,
      });
    });

    it('should filter out frames without filenames', () => {
      const sentryEvent = {
        id: 'test-event-5',
        entries: [
          {
            type: 'exception',
            data: {
              values: [
                {
                  stacktrace: {
                    frames: [
                      {
                        filename: null,
                        function: 'anonymous',
                        lineno: 1,
                        in_app: false,
                      },
                      {
                        filename: 'src/valid.js',
                        function: 'validFunction',
                        lineno: 20,
                        in_app: true,
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      };

      const result = StackTraceParser.parseFromSentryEvent(sentryEvent);

      expect(result).not.toBeNull();
      expect(result!.frames).toHaveLength(1);
      expect(result!.frames[0].filename).toBe('valid.js');
    });
  });

  describe('cleanFilename', () => {
    it('should remove URL protocols and hosts', () => {
      const testCases = [
        {
          input: 'https://example.com/app/src/file.js',
          expected: 'file.js',
        },
        {
          input: 'http://localhost:3000/src/component.tsx',
          expected: 'component.tsx',
        },
      ];

      testCases.forEach(({ input, expected }) => {
        // Access private method through any type
        const result = (StackTraceParser as any).cleanFilename(input);
        expect(result).toBe(expected);
      });
    });

    it('should remove common prefixes', () => {
      const testCases = [
        { input: 'webpack:///src/file.js', expected: 'file.js' },
        { input: 'webpack://project/src/file.js', expected: 'project/src/file.js' },
        { input: 'app/controllers/home.js', expected: 'controllers/home.js' },
        { input: 'src/utils/helper.ts', expected: 'utils/helper.ts' },
        { input: 'dist/build/output.js', expected: 'output.js' },
        { input: 'build/static/js/main.js', expected: 'static/js/main.js' },
      ];

      testCases.forEach(({ input, expected }) => {
        const result = (StackTraceParser as any).cleanFilename(input);
        expect(result).toBe(expected);
      });
    });

    it('should normalize path separators', () => {
      const result = (StackTraceParser as any).cleanFilename('src\\utils\\helper.js');
      expect(result).toBe('utils/helper.js');
    });

    it('should handle empty or null filenames', () => {
      expect((StackTraceParser as any).cleanFilename('')).toBe('');
      expect((StackTraceParser as any).cleanFilename(null)).toBe('');
      expect((StackTraceParser as any).cleanFilename(undefined)).toBe('');
    });
  });

  describe('isApplicationFile', () => {
    it('should identify application files correctly', () => {
      const appFiles = [
        'src/components/Button.tsx',
        'lib/utils/helper.js',
        'controllers/api.py',
        'models/user.rb',
        'services/auth.go',
      ];

      appFiles.forEach((filename) => {
        expect((StackTraceParser as any).isApplicationFile(filename)).toBe(true);
      });
    });

    it('should exclude node_modules and system files', () => {
      const systemFiles = [
        'node_modules/react/index.js',
        'node_modules/@types/node/globals.d.ts',
        'webpack/bootstrap.js',
        'babel/runtime/helpers.js',
        'core-js/modules/es6.array.js',
        'lodash/isEmpty.js',
        'bundle.min.js',
        'main.bundle.js',
        'internal/process.js',
        'node:fs',
        'fs.readFile',
        'path.resolve',
        'util.promisify',
      ];

      systemFiles.forEach((filename) => {
        expect((StackTraceParser as any).isApplicationFile(filename)).toBe(false);
      });
    });

    it('should handle empty or null filenames', () => {
      expect((StackTraceParser as any).isApplicationFile('')).toBe(false);
      expect((StackTraceParser as any).isApplicationFile(null)).toBe(false);
      expect((StackTraceParser as any).isApplicationFile(undefined)).toBe(false);
    });
  });

  describe('extractRepositoryInfo', () => {
    it('should detect language from frame extensions', () => {
      const frames: StackFrame[] = [
        {
          filename: 'src/component.tsx',
          function: 'render',
          lineno: 10,
          colno: 5,
          context_line: null,
          pre_context: null,
          post_context: null,
          in_app: true,
          module: null,
          package: null,
          abs_path: null,
        },
        {
          filename: 'utils/helper.ts',
          function: 'format',
          lineno: 20,
          colno: 10,
          context_line: null,
          pre_context: null,
          post_context: null,
          in_app: true,
          module: null,
          package: null,
          abs_path: null,
        },
      ];

      const result = StackTraceParser.extractRepositoryInfo(frames);
      expect(result.detectedLanguage).toBe('typescript');
      expect(result.owner).toBeNull();
      expect(result.repo).toBeNull();
    });

    it('should return null for mixed or unknown extensions', () => {
      const frames: StackFrame[] = [
        {
          filename: 'src/file.unknown',
          function: 'test',
          lineno: 1,
          colno: 1,
          context_line: null,
          pre_context: null,
          post_context: null,
          in_app: true,
          module: null,
          package: null,
          abs_path: null,
        },
      ];

      const result = StackTraceParser.extractRepositoryInfo(frames);
      expect(result.detectedLanguage).toBe('unknown');
    });
  });

  describe('getContextRange', () => {
    it('should calculate correct context range', () => {
      const result = StackTraceParser.getContextRange(50, 5);
      expect(result).toEqual({
        startLine: 45,
        endLine: 55,
      });
    });

    it('should not go below line 1', () => {
      const result = StackTraceParser.getContextRange(3, 10);
      expect(result).toEqual({
        startLine: 1,
        endLine: 13,
      });
    });

    it('should use default context size if not provided', () => {
      const result = StackTraceParser.getContextRange(20);
      expect(result).toEqual({
        startLine: 10,
        endLine: 30,
      });
    });
  });

  describe('detectLanguageFromFrames', () => {
    it('should detect JavaScript from .js files', () => {
      const frames: StackFrame[] = [
        { filename: 'app.js', function: null, lineno: 1, colno: null, context_line: null, pre_context: null, post_context: null, in_app: true, module: null, package: null, abs_path: null },
        { filename: 'utils.js', function: null, lineno: 1, colno: null, context_line: null, pre_context: null, post_context: null, in_app: true, module: null, package: null, abs_path: null },
      ];

      const result = (StackTraceParser as any).detectLanguageFromFrames(frames);
      expect(result).toBe('javascript');
    });

    it('should detect TypeScript from .ts files', () => {
      const frames: StackFrame[] = [
        { filename: 'app.ts', function: null, lineno: 1, colno: null, context_line: null, pre_context: null, post_context: null, in_app: true, module: null, package: null, abs_path: null },
        { filename: 'types.tsx', function: null, lineno: 1, colno: null, context_line: null, pre_context: null, post_context: null, in_app: true, module: null, package: null, abs_path: null },
      ];

      const result = (StackTraceParser as any).detectLanguageFromFrames(frames);
      expect(result).toBe('typescript');
    });

    it('should return most common language', () => {
      const frames: StackFrame[] = [
        { filename: 'app.py', function: null, lineno: 1, colno: null, context_line: null, pre_context: null, post_context: null, in_app: true, module: null, package: null, abs_path: null },
        { filename: 'models.py', function: null, lineno: 1, colno: null, context_line: null, pre_context: null, post_context: null, in_app: true, module: null, package: null, abs_path: null },
        { filename: 'util.js', function: null, lineno: 1, colno: null, context_line: null, pre_context: null, post_context: null, in_app: true, module: null, package: null, abs_path: null },
      ];

      const result = (StackTraceParser as any).detectLanguageFromFrames(frames);
      expect(result).toBe('python');
    });

    it('should return null for files without extensions', () => {
      const frames: StackFrame[] = [
        { filename: 'Makefile', function: null, lineno: 1, colno: null, context_line: null, pre_context: null, post_context: null, in_app: true, module: null, package: null, abs_path: null },
        { filename: 'README', function: null, lineno: 1, colno: null, context_line: null, pre_context: null, post_context: null, in_app: true, module: null, package: null, abs_path: null },
      ];

      const result = (StackTraceParser as any).detectLanguageFromFrames(frames);
      expect(result).toBeNull();
    });
  });
}); 