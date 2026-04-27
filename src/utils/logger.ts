/**
 * Structured JSON Logger for Cloudflare Workers
 * Provides consistent, filterable logging with timestamps and context
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

class Logger {
  private minLevel: LogLevel;

  constructor(minLevel: LogLevel = LogLevel.INFO) {
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (context && Object.keys(context).length > 0) {
      entry.context = context;
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    console.log(JSON.stringify(entry));
  }

  debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: LogContext, error?: Error): void {
    this.log(LogLevel.WARN, message, context, error);
  }

  error(message: string, context?: LogContext, error?: Error): void {
    this.log(LogLevel.ERROR, message, context, error);
  }
}

// Global logger instance
export const logger = new Logger(LogLevel.INFO);

// Factory for creating scoped loggers
export function createLogger(scope: string, minLevel?: LogLevel): Logger {
  const scopedLogger = new Logger(minLevel);

  return {
    debug: (msg: string, ctx?: LogContext) => scopedLogger.debug(`[${scope}] ${msg}`, ctx),
    info: (msg: string, ctx?: LogContext) => scopedLogger.info(`[${scope}] ${msg}`, ctx),
    warn: (msg: string, ctx?: LogContext, err?: Error) => scopedLogger.warn(`[${scope}] ${msg}`, ctx, err),
    error: (msg: string, ctx?: LogContext, err?: Error) => scopedLogger.error(`[${scope}] ${msg}`, ctx, err),
  } as Logger;
}
