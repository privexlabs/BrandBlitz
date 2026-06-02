typescript
import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import cors, { CorsOptions, CorsRequest } from 'cors';
import { URL } from 'url';
import { Logger } from 'winston';
import { createLogger, format, transports } from 'winston';

/**
 * Creates a configured Winston logger for test diagnostics.
 * @returns {Logger} Configured logger instance
 */
function createTestLogger(): Logger {
  return createLogger({
    level: 'error',
    format: format.combine(
      format.timestamp(),
      format.errors({ stack: true }),
      format.json()
    ),
    transports: [
      new transports.Console({
        format: format.combine(
          format.colorize(),
          format.simple()
        )
      })
    ]
  });
}

const logger: Logger = createTestLogger();

/**
 * Interface for CORS configuration validation result.
 */
interface CorsValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates that an origin string is a properly formatted URL.
 * @param {string} origin - The origin to validate
 * @returns {CorsValidationResult} Validation result with optional error message
 */
function validateOriginFormat(origin: string): CorsValidationResult {
  if (!origin || typeof origin !== 'string') {
    return { isValid: false, error: 'Origin must be a non-empty string' };
  }

  try {
    const parsedUrl: URL = new URL(origin);
    
    // Validate protocol
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { isValid: false, error: `Invalid protocol: ${parsedUrl.protocol}` };
    }

    // Validate hostname is not empty
    if (!parsedUrl.hostname) {
      return { isValid: false, error: 'Origin must have a valid hostname' };
    }

    // Validate no path, query, or fragment
    if (parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) {
      return { isValid: false, error: 'Origin must not contain path, query, or fragment' };
    }

    return { isValid: true };
  } catch (error) {
    return { isValid: false, error: `Invalid URL format: ${(error as Error).message}` };
  }
}

/**
 * Creates a test Express application with production-grade CORS configuration.
 * Implements strict origin validation with comprehensive error handling.
 * 
 * @param {string[]} allowedOrigins - Array of explicitly allowed origins
 * @returns {Application} Configured Express application
 * @throws {Error} If allowedOrigins is empty or contains invalid origins
 */
function createTestApp(allowedOrigins: string[]): Application {
  // Validate input
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    const error: Error = new Error('ALLOWED_ORIGINS must be a non-empty array');
    logger.error('Failed to create test app', { 
      error: error.message,
      allowedOrigins 
    });
    throw error;
  }

  // Validate all origins are properly formatted
  for (const origin of allowedOrigins) {
    const validation: CorsValidationResult = validateOriginFormat(origin);
    if (!validation.isValid) {
      const error: Error = new Error(`Invalid origin "${origin}": ${validation.error}`);
      logger.error('Invalid origin configuration', {
        error: error.message,
        origin,
        validation
      });
      throw error;
    }
  }

  const app: Application = express();

  // Create a set for O(1) lookup performance
  const allowedOriginsSet: Set<string> = new Set(allowedOrigins);

  // Configure CORS with strict validation
  const corsOptions: CorsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void): void => {
      try {
        // Allow requests with no origin (server-to-server, curl, health checks)
        if (!origin) {
          callback(null, true);
          return;
        }

        // Validate origin format
        const validation: CorsValidationResult = validateOriginFormat(origin);
        if (!validation.isValid) {
          logger.warn('CORS request with invalid origin format', {
            origin,
            error: validation.error
          });
          callback(new Error(`Not allowed by CORS: ${validation.error}`));
          return;
        }

        // Check against allowed origins set
        if (allowedOriginsSet.has(origin)) {
          callback(null, true);
        } else {
          logger.warn('CORS request from unlisted origin', {
            origin,
            allowedOrigins: Array.from(allowedOriginsSet)
          });
          callback(new Error('Not allowed by CORS'));
        }
      } catch (error) {
        logger.error('Unexpected error in CORS origin callback', {
          error: (error as Error).message,
          origin
        });
        callback(new Error('Internal CORS configuration error'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-CSRF-Token',
      'Accept',
      'Accept-Language'
    ],
    exposedHeaders: ['X-Request-Id', 'X-Response-Time'],
    maxAge: 86400, // 24 hours in seconds
    preflightContinue: false,
    optionsSuccessStatus: 204
  };

  app.use(cors(corsOptions));

  // Add security headers
  app.use((_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  // Test endpoint with error handling
  app.get('/api/test', (req: Request, res: Response): void => {
    try {
      res.json({ 
        message: 'OK',
        timestamp: new Date().toISOString(),
        origin: req.headers.origin || 'no-origin'
      });
    } catch (error) {
      logger.error('Error in test endpoint', {
        error: (error as Error).message,
        path: req.path,
        method: req.method
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    logger.error('Unhandled error', {
      error: err.message,
      stack: err.stack
    });
    
    if (err.message.includes('Not allowed by CORS')) {
      res.status(403).json({ 
        error: 'Origin not allowed',
        message: 'Cross-origin request from this origin is not permitted'
      });
    } else {
      res.status(500).json({ 
        error: 'Internal server error',
        message: 'An unexpected error occurred'
      });
    }
  });

  return app;
}

describe('CORS Middleware - Production Grade', () => {
  const allowedOrigins: string[] = [
    'https://app.example.com',
    'https://admin.example.com',
    'http://localhost:3000',
    'https://api.example.com'
  ];

  let testApp: Application;

  beforeAll((): void => {
    try {
      testApp = createTestApp(allowedOrigins);
      logger.info('Test app created successfully', { allowedOrigins });
    } catch (error) {
      logger.error('Failed to create test app', {
        error: (error as Error).message
      });
      throw error;
    }
  });

  describe('Application Initialization', () => {
    it('should throw error when allowedOrigins is empty', (): void => {
      expect((): void => {
        createTestApp([]);
      }).toThrow('ALLOWED_ORIGINS must be a non-empty array');
    });

    it('should throw error when allowedOrigins contains invalid URL', (): void => {
      expect((): void => {
        createTestApp(['not-a-valid-url']);
      }).toThrow('Invalid origin');
    });

    it('should throw error when allowedOrigins contains path', (): void => {
      expect((): void => {
        createTestApp(['https://example.com/path']);
      }).toThrow('must not contain path');
    });

    it('should throw error when allowedOrigins contains query', (): void => {
      expect((): void => {
        createTestApp(['https://example.com?query=test']);
      }).toThrow('must not contain query');
    });

    it('should throw error when allowedOrigins contains fragment', (): void => {
      expect((): void => {
        createTestApp(['https://example.com#fragment']);
      }).toThrow('must not contain fragment');
    });

    it('should throw error when allowedOrigins is not an array', (): void => {
      expect((): void => {
        createTestApp('invalid' as unknown as string[]);
      }).toThrow('ALLOWED_ORIGINS must be a non-empty array');
    });
  });

  describe('CORS Request Handling', () => {
    it('should allow requests from allowed origins', async (): Promise<void> => {
      const response = await request(testApp)
        .get('/api/test')
        .set('Origin', 'https://app.example.com')
        .expect(200);

      expect(response.body).toHaveProperty('message', 'OK');
      expect(response.body).toHaveProperty('origin', 'https://app.example.com');
    });

    it('should allow requests from multiple allowed origins', async (): Promise<void> => {
      const origins: string[] = [
        'https://admin.example.com',
        'http://localhost:3000',
        'https://api.example.com'
      ];

      for (const origin of origins) {
        const response = await request(testApp)
          .get('/api/test')
          .set('Origin', origin)
          .expect(200);

        expect(response.body).toHaveProperty('message', 'OK');
        expect(response.body).toHaveProperty('origin', origin);
      }
    });

    it('should reject requests from unlisted origins with 403', async (): Promise<void> => {
      const response = await request(testApp)
        .get('/api/test')
        .set('Origin', 'https://evil.com')
        .expect(403);

      expect(response.body).toHaveProperty('error', 'Origin not allowed');
      expect(response.body).toHaveProperty('message', 'Cross-origin request from this origin is not permitted');
    });

    it('should reject requests with invalid origin format', async (): Promise<void> => {
      const response = await request(testApp)
        .get('/api/test')
        .set('Origin', 'invalid-url')
        .expect(403);

      expect(response.body).toHaveProperty('error', 'Origin not allowed');
    });

    it('should allow requests without origin header', async (): Promise<void> => {
      const response = await request(testApp)
        .get('/api/test')
        .expect(200);

      expect(response.body).toHaveProperty('message', 'OK');
      expect(response.body).toHaveProperty('origin', 'no-origin');
    });

    it('should handle preflight requests correctly', async (): Promise<void> => {
      const response = await request(testApp)
        .options('/api/test')
        .set('Origin', 'https://app.example.com')
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBe('https://app.example.com');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(response.headers['access-control-max-age']).toBe('86400');
    });

    it('should reject preflight requests from unlisted origins', async (): Promise<void> => {
      const response = await request(testApp)
        .options('/api/test')
        .set('Origin', 'https://evil.com')
        .set('Access-Control-Request-Method', 'GET')
        .expect(403);

      expect(response.body).toHaveProperty('error', 'Origin not allowed');
    });
  });

  describe('Security Headers', () => {
    it('should include security headers in responses', async (): Promise<void> => {
      const response = await request(testApp)
        .get('/api/test')
        .set('Origin', 'https://app.example.com')
        .expect(200);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-xss-protection']).toBe('1; mode=block');
      expect(response.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    });
  });

  describe('Error Handling', () => {
    it('should handle internal server errors gracefully', async (): Promise<void> => {
      // Create a new app with a broken endpoint
      const brokenApp: Application = express();
      brokenApp.use(cors({
        origin: ['https://app.example.com'],
        credentials: true
      }));
      
      brokenApp.get('/api/error', (_req: Request, _res: Response): void => {
        throw new Error('Simulated internal error');
      });

      brokenApp.use((err: Error, _req: Request, res: Response, _next: NextFunction): void => {
        logger.error('Simulated error', { error: err.message });
        res.status(500).json({ error: 'Internal server error' });
      });

      const response = await request(brokenApp)
        .get('/api/error')
        .set('Origin', 'https://app.example.com')
        .expect(500);

      expect(response.body).toHaveProperty('error', 'Internal server error');
    });

    it('should handle malformed origin headers', async (): Promise<void> => {
      const response = await request(testApp)
        .get('/api/test')
        .set('Origin', '')
        .expect(200);

      expect(response.body).toHaveProperty('message', 'OK');
    });
  });

  describe('Performance', () => {
    it('should handle multiple concurrent requests efficiently', async (): Promise<void> => {
      const concurrentRequests: number = 10;
      const requests: Promise<request.Response>[] = [];

      for (let i: number = 0; i < concurrentRequests; i++) {
        requests.push(
          request(testApp)
            .get('/api/test')
            .set('Origin', 'https://app.example.com')
        );
      }

      const responses: request.Response[] = await Promise.all(requests);
      
      responses.forEach((response: request.Response): void => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('message', 'OK');
      });
    });

    it('should maintain performance with mixed allowed and disallowed origins', async (): Promise<void> => {
      const mixedRequests: { origin: string; expectedStatus: number }[] = [
        { origin: 'https://app.example.com', expectedStatus: 200 },
        { origin: 'https://evil.com', expectedStatus: 403 },
        { origin: 'https://admin.example.com', expectedStatus: 200 },
        { origin: 'https://malicious.com', expectedStatus: 403 },
        { origin: 'http://localhost:3000', expectedStatus: 200 }
      ];

      const requests: Promise<request.Response>[] = mixedRequests.map(
        ({ origin }: { origin: string; expectedStatus: number }): Promise<request.Response> => {
          return request(testApp)
            .get('/api/test')
            .set('Origin', origin);
        }
      );

      const responses: request.Response[] = await Promise.all(requests);
      
      responses.forEach((response: request.Response, index: number): void => {
        expect(response.status).toBe(mixedRequests[index].expectedStatus);
      });
    });
  });
});