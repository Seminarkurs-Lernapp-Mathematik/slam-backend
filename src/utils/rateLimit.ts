/**
 * In-Memory Rate Limiting for Cloudflare Workers
 * Sliding window algorithm with automatic cleanup
 */

import type { Context, MiddlewareHandler } from 'hono';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

class RateLimitStore {
  private store = new Map<string, RateLimitEntry>();
  private lastCleanup = Date.now();
  private readonly cleanupInterval = 60000; // 60s

  get(key: string): RateLimitEntry | undefined {
    this.maybeCleanup();
    return this.store.get(key);
  }

  set(key: string, entry: RateLimitEntry): void {
    this.store.set(key, entry);
  }

  private maybeCleanup(): void {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupInterval) return;

    this.lastCleanup = now;
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetAt) {
        this.store.delete(key);
      }
    }
  }
}

const store = new RateLimitStore();

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (c: Context) => string;
}

function defaultKeyGenerator(c: Context): string {
  return c.req.header('cf-connecting-ip') ??
         c.req.header('x-forwarded-for') ??
         'unknown';
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const { windowMs, maxRequests, keyGenerator = defaultKeyGenerator } = options;

  return async (c: Context, next) => {
    const key = keyGenerator(c);
    const now = Date.now();
    const resetAt = now + windowMs;

    let entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt };
      store.set(key, entry);
    }

    entry.count++;

    const remaining = Math.max(0, maxRequests - entry.count);

    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(entry.resetAt));

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return c.json({
        success: false,
        error: 'Rate Limit Exceeded',
        message: 'Too many requests. Please try again later.',
        retryAfter,
      }, 429, {
        'Retry-After': String(retryAfter),
      });
    }

    await next();
  };
}

export const RateLimitPresets = {
  strict: () => rateLimit({ windowMs: 60000, maxRequests: 10 }),
  standard: () => rateLimit({ windowMs: 60000, maxRequests: 60 }),
  generous: () => rateLimit({ windowMs: 60000, maxRequests: 300 }),
  ai: () => rateLimit({ windowMs: 60000, maxRequests: 20 }),
  auth: () => rateLimit({ windowMs: 60000, maxRequests: 5 }),
};
