import {
  createClient,
  type AuthChangeEvent,
  type Session,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';

export interface AppAuthUser {
  uid: string;
  email: string | null;
  username?: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  providerId: 'google.com' | 'password';
  getAccessToken: () => Promise<string>;
}

export interface SupabaseAuthPublicConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  configured: boolean;
}

let configPromise: Promise<SupabaseAuthPublicConfig> | null = null;
let clientPromise: Promise<SupabaseClient | null> | null = null;
let activeClient: SupabaseClient | null = null;

function readViteSupabaseConfig(): SupabaseAuthPublicConfig | null {
  const url = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
  const key = String(
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      import.meta.env.VITE_SUPABASE_ANON_KEY ||
      ''
  ).trim();

  if (
    url &&
    key &&
    !url.includes('your-project-ref') &&
    key !== 'MY_SUPABASE_PUBLISHABLE_KEY' &&
    key !== 'MY_SUPABASE_ANON_KEY'
  ) {
    return {
      supabaseUrl: url.replace(/\/+$/, ''),
      supabasePublishableKey: key,
      configured: true,
    };
  }
  return null;
}

export async function getSupabaseAuthConfig(): Promise<SupabaseAuthPublicConfig> {
  const viteConfig = readViteSupabaseConfig();
  if (viteConfig) {
    return viteConfig;
  }

  if (!configPromise) {
    configPromise = fetch('/api/config/auth')
      .then(async (res) => {
        if (!res.ok) {
          return { supabaseUrl: '', supabasePublishableKey: '', configured: false };
        }
        const data = (await res.json().catch(() => ({}))) as Partial<SupabaseAuthPublicConfig>;
        const url = typeof data.supabaseUrl === 'string' ? data.supabaseUrl.trim() : '';
        const key =
          typeof data.supabasePublishableKey === 'string'
            ? data.supabasePublishableKey.trim()
            : '';
        return {
          supabaseUrl: url,
          supabasePublishableKey: key,
          configured: Boolean(data.configured && url && key),
        };
      })
      .catch(() => ({ supabaseUrl: '', supabasePublishableKey: '', configured: false }));
  }

  return configPromise;
}

export async function getSupabaseBrowserClient(): Promise<SupabaseClient | null> {
  if (activeClient) {
    return activeClient;
  }
  if (!clientPromise) {
    clientPromise = getSupabaseAuthConfig().then((cfg) => {
      if (!cfg.configured) {
        return null;
      }
      activeClient = createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
      return activeClient;
    });
  }
  return clientPromise;
}

export function mapSupabaseUser(
  user: User,
  session?: Session | null
): AppAuthUser {
  const meta = (user.user_metadata || {}) as Record<string, unknown>;
  const appMeta = (user.app_metadata || {}) as Record<string, unknown>;

  const displayName =
    (typeof meta.full_name === 'string' && meta.full_name.trim()) ||
    (typeof meta.display_name === 'string' && meta.display_name.trim()) ||
    (typeof meta.name === 'string' && meta.name.trim()) ||
    (typeof meta.username === 'string' && meta.username.trim()) ||
    user.email?.split('@')[0] ||
    null;

  const photoURL =
    (typeof meta.avatar_url === 'string' && meta.avatar_url.trim()) ||
    (typeof meta.picture === 'string' && meta.picture.trim()) ||
    null;

  const isGoogle =
    appMeta.provider === 'google' ||
    (Array.isArray(user.identities) &&
      user.identities.some((identity) => identity.provider === 'google'));

  const username =
    typeof meta.username === 'string' && meta.username.trim()
      ? meta.username.trim()
      : null;

  return {
    uid: user.id,
    email: user.email ?? null,
    username,
    displayName,
    photoURL,
    emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
    providerId: isGoogle ? 'google.com' : 'password',
    getAccessToken: async () => {
      const client = await getSupabaseBrowserClient();
      if (client) {
        const { data } = await client.auth.getSession();
        if (data.session?.access_token) {
          return data.session.access_token;
        }
      }
      if (session?.access_token) {
        return session.access_token;
      }
      throw new Error('Authentication session expired. Please sign in again.');
    },
  };
}

export function extractOAuthCallbackErrorFromUrl(): string | null {
  try {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const rawError =
      searchParams.get('error_description') ||
      hashParams.get('error_description') ||
      searchParams.get('error') ||
      hashParams.get('error');
    if (!rawError) {
      return null;
    }
    const cleanUrl = `${window.location.pathname}`;
    window.history.replaceState({}, document.title, cleanUrl);
    return decodeURIComponent(rawError.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

export function subscribeToSupabaseAuth(handlers: {
  onConfigStatus: (configured: boolean) => void;
  onSessionChange: (user: AppAuthUser | null, event: AuthChangeEvent | 'INITIAL_SESSION') => void;
  onAuthError?: (message: string) => void;
}): () => void {
  let active = true;
  let unsubscribeAuth: (() => void) | null = null;

  const urlError = extractOAuthCallbackErrorFromUrl();
  if (urlError && handlers.onAuthError) {
    handlers.onAuthError(urlError);
  }

  getSupabaseBrowserClient()
    .then(async (client) => {
      if (!active) return;
      if (!client) {
        handlers.onConfigStatus(false);
        handlers.onSessionChange(null, 'INITIAL_SESSION');
        return;
      }

      handlers.onConfigStatus(true);

      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((event, session) => {
        if (!active) return;
        const mapped = session?.user ? mapSupabaseUser(session.user, session) : null;
        handlers.onSessionChange(mapped, event);
      });
      unsubscribeAuth = () => subscription.unsubscribe();

      const { data, error } = await client.auth.getSession();
      if (!active) return;
      if (error && handlers.onAuthError) {
        handlers.onAuthError(error.message);
      }
      const mapped = data.session?.user
        ? mapSupabaseUser(data.session.user, data.session)
        : null;
      handlers.onSessionChange(mapped, 'INITIAL_SESSION');

      // Clean PKCE code query param after Supabase exchanges it
      if (window.location.search.includes('code=')) {
        const params = new URLSearchParams(window.location.search);
        params.delete('code');
        const nextSearch = params.toString();
        const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
        window.history.replaceState({}, document.title, nextUrl);
      }
    })
    .catch((err) => {
      if (!active) return;
      handlers.onConfigStatus(false);
      handlers.onSessionChange(null, 'INITIAL_SESSION');
      if (handlers.onAuthError && err instanceof Error) {
        handlers.onAuthError(err.message);
      }
    });

  return () => {
    active = false;
    unsubscribeAuth?.();
  };
}

async function requireClient(): Promise<SupabaseClient> {
  const client = await getSupabaseBrowserClient();
  if (!client) {
    throw new Error(
      'Supabase Auth is not configured. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to your environment.'
    );
  }
  return client;
}

export async function signInWithSupabasePassword(
  email: string,
  password: string
): Promise<AppAuthUser> {
  const client = await requireClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw error;
  }
  if (!data.user) {
    throw new Error('Unable to sign in with those credentials.');
  }
  return mapSupabaseUser(data.user, data.session);
}

export async function signUpWithSupabasePassword(params: {
  email: string;
  password: string;
  username: string;
  displayName: string;
}): Promise<{
  user: AppAuthUser | null;
  hasSession: boolean;
  verificationEmailSent: boolean;
  alreadyExistsHint: boolean;
}> {
  const client = await requireClient();
  const { data, error } = await client.auth.signUp({
    email: params.email,
    password: params.password,
    options: {
      emailRedirectTo: window.location.origin,
      data: {
        username: params.username,
        display_name: params.displayName,
        full_name: params.displayName,
      },
    },
  });

  if (error) {
    throw error;
  }

  // Supabase returns empty identities when email confirmation is on and the email already exists.
  const identitiesCount = Array.isArray(data.user?.identities) ? data.user.identities.length : 1;
  if (data.user && identitiesCount === 0) {
    return {
      user: null,
      hasSession: false,
      verificationEmailSent: false,
      alreadyExistsHint: true,
    };
  }

  const hasSession = Boolean(data.session);
  const mappedUser = data.user ? mapSupabaseUser(data.user, data.session) : null;

  return {
    user: mappedUser,
    hasSession,
    verificationEmailSent: !hasSession,
    alreadyExistsHint: false,
  };
}

export async function signInWithSupabaseGoogle(): Promise<void> {
  const client = await requireClient();
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: {
        prompt: 'select_account',
      },
    },
  });
  if (error) {
    throw error;
  }
}

export async function sendSupabasePasswordReset(email: string): Promise<void> {
  const client = await requireClient();
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  if (error) {
    throw error;
  }
}

export async function updateSupabasePassword(newPassword: string): Promise<void> {
  const client = await requireClient();
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) {
    throw error;
  }
}

export async function resendSupabaseVerificationEmail(email: string): Promise<void> {
  const client = await requireClient();
  const { error } = await client.auth.resend({
    type: 'signup',
    email,
    options: {
      emailRedirectTo: window.location.origin,
    },
  });
  if (error) {
    throw error;
  }
}

export async function refreshSupabaseUserSession(): Promise<AppAuthUser | null> {
  const client = await requireClient();
  const { data: sessionData } = await client.auth.refreshSession();
  const { data: userData, error } = await client.auth.getUser();
  if (error || !userData.user) {
    return null;
  }
  return mapSupabaseUser(userData.user, sessionData.session);
}

export async function signOutSupabase(): Promise<void> {
  const client = await getSupabaseBrowserClient();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) {
    throw error;
  }
}
