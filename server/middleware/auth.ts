import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';

export interface SupabasePublicConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  configured: boolean;
}

export function getSupabasePublicConfig(): SupabasePublicConfig {
  const rawUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const rawKey = (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();

  const validUrl = Boolean(rawUrl && !rawUrl.includes('your-project-ref'));
  const validKey = Boolean(
    rawKey &&
      rawKey !== 'MY_SUPABASE_PUBLISHABLE_KEY' &&
      rawKey !== 'MY_SUPABASE_ANON_KEY'
  );

  return {
    supabaseUrl: validUrl ? rawUrl.replace(/\/+$/, '') : '',
    supabasePublishableKey: validKey ? rawKey : '',
    configured: validUrl && validKey,
  };
}

let cachedJwksUrl: string | null = null;
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedAuthClient: SupabaseClient | null = null;
let cachedAuthClientSig = '';

const verifiedUserCache = new Map<
  string,
  {
    uid: string;
    email?: string;
    emailVerified: boolean;
    expiresAt: number;
  }
>();

function getJwks(supabaseUrl: string): ReturnType<typeof createRemoteJWKSet> {
  const jwksUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
  if (!cachedJwks || cachedJwksUrl !== jwksUrl) {
    cachedJwksUrl = jwksUrl;
    cachedJwks = createRemoteJWKSet(new URL(jwksUrl));
  }
  return cachedJwks;
}

function getSupabaseAuthVerifierClient(): SupabaseClient | null {
  const { supabaseUrl, supabasePublishableKey } = getSupabasePublicConfig();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const apiKey =
    (serviceKey && serviceKey !== 'MY_SUPABASE_SERVICE_ROLE_KEY' ? serviceKey : '') ||
    supabasePublishableKey;

  if (!supabaseUrl || !apiKey) {
    return null;
  }

  const sig = `${supabaseUrl}::${apiKey}`;
  if (!cachedAuthClient || cachedAuthClientSig !== sig) {
    cachedAuthClientSig = sig;
    cachedAuthClient = createClient(supabaseUrl, apiKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return cachedAuthClient;
}

export interface AuthenticatedRequest extends Request {
  authUser?: {
    uid: string;
    email?: string;
    emailVerified?: boolean;
  };
}

async function verifyViaSupabaseApi(
  token: string
): Promise<{ uid: string; email?: string; emailVerified: boolean } | null> {
  const now = Date.now();
  const cached = verifiedUserCache.get(token);
  if (cached && cached.expiresAt > now) {
    return {
      uid: cached.uid,
      email: cached.email,
      emailVerified: cached.emailVerified,
    };
  }

  const client = getSupabaseAuthVerifierClient();
  if (!client) {
    return null;
  }

  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    return null;
  }

  const result = {
    uid: data.user.id,
    email: data.user.email,
    emailVerified: Boolean(data.user.email_confirmed_at || data.user.confirmed_at),
  };

  // Cache briefly (30s) to keep request latency low while still honoring revocations quickly.
  if (verifiedUserCache.size > 500) {
    verifiedUserCache.clear();
  }
  verifiedUserCache.set(token, {
    ...result,
    expiresAt: now + 30_000,
  });

  return result;
}

export async function requireSupabaseJwt(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { supabaseUrl } = getSupabasePublicConfig();
  if (!supabaseUrl) {
    res.status(503).json({
      error:
        'Supabase authentication is not configured on this server. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.',
    });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Bearer authentication token.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Empty authentication token.' });
    return;
  }

  try {
    let alg = '';
    try {
      const header = decodeProtectedHeader(token);
      alg = typeof header.alg === 'string' ? header.alg : '';
    } catch {
      alg = '';
    }

    // Asymmetric Supabase JWTs (ES256 / RS256 / EdDSA) verify locally via JWKS.
    if (alg && alg !== 'HS256') {
      try {
        const { payload } = await jwtVerify(token, getJwks(supabaseUrl), {
          issuer: `${supabaseUrl}/auth/v1`,
          audience: 'authenticated',
        });

        const uid = typeof payload.sub === 'string' ? payload.sub : '';
        if (uid) {
          const userMeta =
            typeof payload.user_metadata === 'object' && payload.user_metadata !== null
              ? (payload.user_metadata as Record<string, unknown>)
              : undefined;
          req.authUser = {
            uid,
            email: typeof payload.email === 'string' ? payload.email : undefined,
            emailVerified: Boolean(
              payload.email_confirmed_at ?? userMeta?.email_verified ?? true
            ),
          };
          next();
          return;
        }
      } catch {
        // Fall through to authoritative getUser verification (handles rotated keys or HS256).
      }
    }

    const verifiedUser = await verifyViaSupabaseApi(token);
    if (!verifiedUser) {
      res.status(401).json({ error: 'Invalid or expired authentication token.' });
      return;
    }

    req.authUser = verifiedUser;
    next();
  } catch (error) {
    console.warn('Supabase JWT verification failed:', error instanceof Error ? error.message : error);
    res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}
