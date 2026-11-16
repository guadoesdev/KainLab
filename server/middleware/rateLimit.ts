import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from './auth.ts';

interface Bucket {
  timestamps: number[];
}

export function createAiRateLimiter(options: { windowMs: number; maxRequests: number }) {
  const buckets = new Map<string, Bucket>();

  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const key = req.authUser?.uid || req.ip || 'anonymous';
    const now = Date.now();
    const cutoff = now - options.windowMs;

    const bucket = buckets.get(key) || { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((ts) => ts > cutoff);

    if (bucket.timestamps.length >= options.maxRequests) {
      const oldest = bucket.timestamps[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: `Rate limit reached. Please wait ${retryAfterSec}s before sending another AI request.`,
      });
      return;
    }

    bucket.timestamps.push(now);
    buckets.set(key, bucket);
    next();
  };
}
