export const BLUEPRINT_LIMITS = {
  UID_MAX: 128,
  USERNAME_MIN: 3,
  USERNAME_MAX: 24,
  USERNAME_PATTERN: /^[a-zA-Z0-9_-]+$/,
  DISPLAY_NAME_MIN: 1,
  DISPLAY_NAME_MAX: 80,
  PHOTO_URL_MAX: 500,
  EMAIL_MIN: 3,
  EMAIL_MAX: 254,
} as const;

const USERNAME_DIRECTORY_KEY = 'kestrel_username_directory_v1';
const REMEMBERED_LOGIN_KEY = 'kestrel_remembered_login_v1';

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(raw: string): string | null {
  const value = normalizeUsername(raw);
  if (!value) {
    return 'Username is required.';
  }
  if (value.length < BLUEPRINT_LIMITS.USERNAME_MIN || value.length > BLUEPRINT_LIMITS.USERNAME_MAX) {
    return `Username must be between ${BLUEPRINT_LIMITS.USERNAME_MIN} and ${BLUEPRINT_LIMITS.USERNAME_MAX} characters.`;
  }
  if (!BLUEPRINT_LIMITS.USERNAME_PATTERN.test(value)) {
    return 'Use only letters, numbers, underscores, or hyphens.';
  }
  return null;
}

export function validateEmail(raw: string): string | null {
  const value = raw.trim();
  if (!value) {
    return 'Email address is required.';
  }
  if (value.length < BLUEPRINT_LIMITS.EMAIL_MIN || value.length > BLUEPRINT_LIMITS.EMAIL_MAX) {
    return 'Enter a valid email address.';
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value)) {
    return 'Enter a valid email address (for example, alex@company.com).';
  }
  return null;
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Not entered' | 'Weak' | 'Fair' | 'Good' | 'Strong';
  checks: {
    length: boolean;
    uppercase: boolean;
    lowercase: boolean;
    number: boolean;
    symbol: boolean;
  };
  metCount: number;
}

export function evaluatePasswordStrength(password: string): PasswordStrength {
  const checks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    symbol: /[^a-zA-Z0-9]/.test(password),
  };

  const complexityCount = [
    checks.uppercase,
    checks.lowercase,
    checks.number,
    checks.symbol,
  ].filter(Boolean).length;

  const metCount = (checks.length ? 1 : 0) + complexityCount;

  if (password.length === 0) {
    return { score: 0, label: 'Not entered', checks, metCount: 0 };
  }

  if (!checks.length || complexityCount <= 1) {
    return { score: 1, label: 'Weak', checks, metCount };
  }

  if (complexityCount === 2) {
    return { score: 2, label: 'Fair', checks, metCount };
  }

  if (complexityCount === 3) {
    return { score: 3, label: 'Good', checks, metCount };
  }

  return { score: 4, label: 'Strong', checks, metCount };
}

export function rememberUsernameEmailMapping(username: string, email: string): void {
  try {
    const cleanUsername = normalizeUsername(username);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanUsername || !cleanEmail) return;
    const raw = localStorage.getItem(USERNAME_DIRECTORY_KEY);
    const map: Record<string, string> = raw ? JSON.parse(raw) : {};
    map[cleanUsername] = cleanEmail;
    localStorage.setItem(USERNAME_DIRECTORY_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

export function resolveLoginIdentifierToEmail(identifier: string): string | null {
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  if (trimmed.includes('@')) {
    return trimmed;
  }
  try {
    const raw = localStorage.getItem(USERNAME_DIRECTORY_KEY);
    if (!raw) return null;
    const map: Record<string, string> = JSON.parse(raw);
    return map[normalizeUsername(trimmed)] || null;
  } catch {
    return null;
  }
}

export function saveRememberedLogin(identifier: string | null): void {
  try {
    if (identifier && identifier.trim()) {
      localStorage.setItem(REMEMBERED_LOGIN_KEY, identifier.trim());
    } else {
      localStorage.removeItem(REMEMBERED_LOGIN_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function loadRememberedLogin(): string {
  try {
    return localStorage.getItem(REMEMBERED_LOGIN_KEY) || '';
  } catch {
    return '';
  }
}

export interface FriendlyAuthError {
  message: string;
  needsEmailProviderSetup: boolean;
}

export function mapFirebaseAuthError(error: unknown): FriendlyAuthError {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  switch (code) {
    case 'auth/operation-not-allowed':
      return {
        message: 'Email and password authentication is not enabled yet for this Firebase project.',
        needsEmailProviderSetup: true,
      };
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return {
        message: 'The username, email, or password you entered is incorrect.',
        needsEmailProviderSetup: false,
      };
    case 'auth/email-already-in-use':
      return {
        message: 'An account with this email address already exists. Try signing in instead.',
        needsEmailProviderSetup: false,
      };
    case 'auth/weak-password':
      return {
        message: 'Choose a stronger password with at least 8 characters.',
        needsEmailProviderSetup: false,
      };
    case 'auth/invalid-email':
      return {
        message: 'Please enter a valid email address.',
        needsEmailProviderSetup: false,
      };
    case 'auth/popup-closed-by-user':
      return {
        message: 'Google sign-in was cancelled before completion.',
        needsEmailProviderSetup: false,
      };
    case 'auth/popup-blocked':
      return {
        message: 'Your browser blocked the Google sign-in window. Allow popups for this site and try again.',
        needsEmailProviderSetup: false,
      };
    case 'auth/too-many-requests':
      return {
        message: 'Too many consecutive attempts. Please wait a moment and try again.',
        needsEmailProviderSetup: false,
      };
    case 'auth/network-request-failed':
      return {
        message: 'Network connection error. Check your connection and try again.',
        needsEmailProviderSetup: false,
      };
    default:
      return {
        message:
          error instanceof Error && error.message
            ? error.message
            : 'Unable to complete authentication. Please try again.',
        needsEmailProviderSetup: false,
      };
  }
}
