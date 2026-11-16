import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
} from 'lucide-react';
import {
  evaluatePasswordStrength,
  loadRememberedLogin,
  mapSupabaseAuthError,
  normalizeUsername,
  rememberUsernameEmailMapping,
  resolveLoginIdentifierToEmail,
  saveRememberedLogin,
  validateEmail,
  validateUsername,
} from '../lib/authHelpers';
import {
  sendSupabasePasswordReset,
  signInWithSupabaseGoogle,
  signInWithSupabasePassword,
  signUpWithSupabasePassword,
  updateSupabasePassword,
  type AppAuthUser,
} from '../lib/supabaseAuth';
import { PasswordStrengthMeter } from './PasswordStrengthMeter';
import { VerificationBanner, type RegistrationNotice } from './VerificationBanner';

type AuthMode = 'signin' | 'signup' | 'forgot' | 'recovery';

interface AuthFormPanelProps {
  supabaseConfigured: boolean;
  initialAuthError?: string | null;
  passwordRecoveryActive?: boolean;
  onPasswordRecoveryComplete?: () => void;
  registrationNotice: RegistrationNotice | null;
  onDismissRegistrationNotice: () => void;
  onRegistrationStarted: (username: string) => void;
  onRegistrationCompleted: (notice: RegistrationNotice) => void;
  onRegistrationAutoSignedIn: (user: AppAuthUser) => void;
  onRegistrationFailed: () => void;
}

function GoogleMark() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
      />
    </svg>
  );
}

function ButtonProgressBar({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-0 bottom-0 h-[3px] overflow-hidden ${
        tone === 'dark' ? 'bg-white/15' : 'bg-slate-200'
      }`}
    >
      <span
        className={`block h-full w-1/3 rounded-full animate-progress-sweep ${
          tone === 'dark' ? 'bg-blue-400' : 'bg-blue-700'
        }`}
      />
    </span>
  );
}

export function AuthFormPanel({
  supabaseConfigured,
  initialAuthError = null,
  passwordRecoveryActive = false,
  onPasswordRecoveryComplete,
  registrationNotice,
  onDismissRegistrationNotice,
  onRegistrationStarted,
  onRegistrationCompleted,
  onRegistrationAutoSignedIn,
  onRegistrationFailed,
}: AuthFormPanelProps) {
  const [mode, setMode] = useState<AuthMode>(passwordRecoveryActive ? 'recovery' : 'signin');

  // Sign-in state
  const [loginIdentifier, setLoginIdentifier] = useState<string>(() => loadRememberedLogin());
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [rememberLogin, setRememberLogin] = useState<boolean>(() => Boolean(loadRememberedLogin()));

  // Sign-up state
  const [signupUsername, setSignupUsername] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupDisplayName, setSignupDisplayName] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);

  // Forgot password & recovery state
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState('');
  const [showRecoveryPassword, setShowRecoveryPassword] = useState(false);

  // Submission & feedback state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialAuthError);
  const [needsProviderSetup, setNeedsProviderSetup] = useState(false);

  const passwordStrength = evaluatePasswordStrength(
    mode === 'recovery' ? recoveryPassword : signupPassword
  );

  useEffect(() => {
    if (passwordRecoveryActive) {
      setMode('recovery');
      setErrorMessage(null);
    }
  }, [passwordRecoveryActive]);

  useEffect(() => {
    if (initialAuthError) {
      setErrorMessage(initialAuthError);
    }
  }, [initialAuthError]);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setErrorMessage(null);
    setNeedsProviderSetup(false);
    setResetSent(false);
  }

  async function handleGoogleAuth() {
    setErrorMessage(null);
    setNeedsProviderSetup(false);
    setIsGoogleLoading(true);
    try {
      await signInWithSupabaseGoogle();
    } catch (error) {
      const mapped = mapSupabaseAuthError(error);
      setErrorMessage(mapped.message);
      setNeedsProviderSetup(mapped.needsProviderSetup);
      setIsGoogleLoading(false);
    }
  }

  async function handleSignInSubmit(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setNeedsProviderSetup(false);

    const identifier = loginIdentifier.trim();
    if (!identifier) {
      setErrorMessage('Enter your username or email address.');
      return;
    }
    if (!loginPassword) {
      setErrorMessage('Enter your password.');
      return;
    }

    const resolvedEmail = resolveLoginIdentifierToEmail(identifier);
    if (!resolvedEmail) {
      setErrorMessage(
        'That username is not cached on this device yet. Sign in with your email address once to link it, or create a new account.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const signedInUser = await signInWithSupabasePassword(resolvedEmail, loginPassword);
      if (rememberLogin) {
        saveRememberedLogin(identifier);
      } else {
        saveRememberedLogin(null);
      }
      if (!identifier.includes('@')) {
        rememberUsernameEmailMapping(identifier, resolvedEmail);
      } else if (signedInUser.displayName) {
        rememberUsernameEmailMapping(signedInUser.displayName, resolvedEmail);
      }
    } catch (error) {
      const mapped = mapSupabaseAuthError(error);
      setErrorMessage(mapped.message);
      setNeedsProviderSetup(mapped.needsProviderSetup);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignUpSubmit(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setNeedsProviderSetup(false);

    const usernameErr = validateUsername(signupUsername);
    if (usernameErr) {
      setErrorMessage(usernameErr);
      return;
    }

    const emailErr = validateEmail(signupEmail);
    if (emailErr) {
      setErrorMessage(emailErr);
      return;
    }

    if (signupPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }

    if (passwordStrength.score < 2) {
      setErrorMessage(
        'Password is too weak. Mix at least two character types (uppercase, lowercase, numbers, or symbols).'
      );
      return;
    }

    if (signupPassword !== signupConfirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    const cleanUsername = normalizeUsername(signupUsername);
    const cleanEmail = signupEmail.trim();
    const cleanDisplayName = signupDisplayName.trim() || cleanUsername;

    setIsSubmitting(true);
    onRegistrationStarted(cleanUsername);
    try {
      const result = await signUpWithSupabasePassword({
        email: cleanEmail,
        password: signupPassword,
        username: cleanUsername,
        displayName: cleanDisplayName,
      });

      if (result.alreadyExistsHint) {
        onRegistrationFailed();
        setErrorMessage('An account with this email address already exists. Try signing in instead.');
        return;
      }

      rememberUsernameEmailMapping(cleanUsername, cleanEmail);
      saveRememberedLogin(cleanUsername);

      if (result.hasSession && result.user) {
        setSignupUsername('');
        setSignupEmail('');
        setSignupDisplayName('');
        setSignupPassword('');
        setSignupConfirmPassword('');
        onRegistrationAutoSignedIn(result.user);
        return;
      }

      setLoginIdentifier(cleanUsername);
      setLoginPassword('');
      setSignupUsername('');
      setSignupEmail('');
      setSignupDisplayName('');
      setSignupPassword('');
      setSignupConfirmPassword('');
      setMode('signin');
      onRegistrationCompleted({
        email: cleanEmail,
        username: cleanUsername,
        verificationEmailSent: result.verificationEmailSent,
      });
    } catch (error) {
      onRegistrationFailed();
      const mapped = mapSupabaseAuthError(error);
      setErrorMessage(mapped.message);
      setNeedsProviderSetup(mapped.needsProviderSetup);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleForgotSubmit(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setNeedsProviderSetup(false);

    const emailErr = validateEmail(resetEmail);
    if (emailErr) {
      setErrorMessage(emailErr);
      return;
    }

    setIsSubmitting(true);
    try {
      await sendSupabasePasswordReset(resetEmail.trim());
      setResetSent(true);
    } catch (error) {
      const mapped = mapSupabaseAuthError(error);
      setErrorMessage(mapped.message);
      setNeedsProviderSetup(mapped.needsProviderSetup);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRecoverySubmit(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);

    if (recoveryPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }

    const strength = evaluatePasswordStrength(recoveryPassword);
    if (strength.score < 2) {
      setErrorMessage(
        'Password is too weak. Mix at least two character types (uppercase, lowercase, numbers, or symbols).'
      );
      return;
    }

    if (recoveryPassword !== recoveryConfirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      await updateSupabasePassword(recoveryPassword);
      setRecoveryPassword('');
      setRecoveryConfirmPassword('');
      onPasswordRecoveryComplete?.();
    } catch (error) {
      const mapped = mapSupabaseAuthError(error);
      setErrorMessage(mapped.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const busy = isSubmitting || isGoogleLoading || !supabaseConfigured;

  return (
    <main className="lg:col-span-6 flex flex-col justify-between bg-white px-6 py-8 sm:px-12 lg:px-14 xl:px-20">
      <div className="flex items-center justify-between lg:justify-end">
        <a
          href="/"
          className="lg:hidden font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          KainLab
        </a>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>Today Workspace</span>
          <span aria-hidden="true">·</span>
          <span>Supabase Auth</span>
        </div>
      </div>

      <div className="w-full max-w-[440px] mx-auto my-auto py-8">
        {!supabaseConfigured && (
          <div
            role="status"
            className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950 space-y-1.5"
          >
            <p className="font-semibold text-amber-950">Supabase Auth configuration required</p>
            <p className="leading-relaxed text-amber-900">
              Set <code className="font-mono font-semibold">SUPABASE_URL</code> and{' '}
              <code className="font-mono font-semibold">SUPABASE_PUBLISHABLE_KEY</code> in your{' '}
              <code className="font-mono">.env</code> or Render environment variables, then restart the server.
            </p>
          </div>
        )}

        {registrationNotice && (
          <VerificationBanner
            notice={registrationNotice}
            onDismiss={onDismissRegistrationNotice}
          />
        )}

        {mode !== 'forgot' && mode !== 'recovery' && (
          <div
            role="tablist"
            aria-label="Authentication mode"
            className="grid grid-cols-2 gap-1 p-1 mb-8 rounded-lg bg-slate-100 border border-slate-200"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              onClick={() => switchMode('signin')}
              className={`min-h-[40px] px-4 py-2 text-sm font-medium rounded-md transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 ${
                mode === 'signin'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              onClick={() => switchMode('signup')}
              className={`min-h-[40px] px-4 py-2 text-sm font-medium rounded-md transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 ${
                mode === 'signup'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Create account
            </button>
          </div>
        )}

        <MotionConfig reducedMotion="user">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.985 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="origin-top"
            >
              <header className="mb-6 space-y-1.5">
                {mode === 'signin' && (
                  <>
                    <h2 className="font-display text-2xl font-semibold tracking-tight text-slate-900 [text-wrap:balance]">
                      Sign in to your account
                    </h2>
                    <p className="text-sm text-slate-600">
                      Use your username and password, or continue with Google.
                    </p>
                  </>
                )}
                {mode === 'signup' && (
                  <>
                    <h2 className="font-display text-2xl font-semibold tracking-tight text-slate-900 [text-wrap:balance]">
                      Create your account
                    </h2>
                    <p className="text-sm text-slate-600">
                      Register a username and password, or sign up in one step with Google.
                    </p>
                  </>
                )}
                {mode === 'forgot' && (
                  <>
                    <button
                      type="button"
                      onClick={() => switchMode('signin')}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 mb-3 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded-sm"
                    >
                      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                      Back to sign in
                    </button>
                    <h2 className="font-display text-2xl font-semibold tracking-tight text-slate-900 [text-wrap:balance]">
                      Reset your password
                    </h2>
                    <p className="text-sm text-slate-600">
                      Enter the email address associated with your account to receive a reset link.
                    </p>
                  </>
                )}
                {mode === 'recovery' && (
                  <>
                    <h2 className="font-display text-2xl font-semibold tracking-tight text-slate-900 [text-wrap:balance]">
                      Choose a new password
                    </h2>
                    <p className="text-sm text-slate-600">
                      Enter a strong new password for your KainLab account.
                    </p>
                  </>
                )}
              </header>

              {errorMessage && (
                <div
                  role="alert"
                  className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-800 space-y-2"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{errorMessage}</span>
                  </div>

                  {needsProviderSetup && (
                    <div className="pt-2 border-t border-red-200/80 text-xs text-red-900 space-y-1">
                      <p className="font-medium">How to enable this provider in Supabase:</p>
                      <ol className="list-decimal list-inside space-y-1 text-red-800">
                        <li>Open Supabase Dashboard → Authentication → Providers.</li>
                        <li>Enable Email or Google and add your site URL to Redirect URLs.</li>
                        <li>Return here and try signing in again.</li>
                      </ol>
                    </div>
                  )}
                </div>
              )}

              {mode !== 'forgot' && mode !== 'recovery' && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    aria-busy={isGoogleLoading}
                    onClick={handleGoogleAuth}
                    className={`relative overflow-hidden w-full min-h-[44px] inline-flex items-center justify-center gap-3 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 ${
                      isGoogleLoading
                        ? 'border-slate-300 bg-slate-50 text-slate-800 cursor-wait'
                        : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50 hover:border-slate-400 active:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed'
                    }`}
                  >
                    {isGoogleLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-700" aria-hidden="true" />
                    ) : (
                      <GoogleMark />
                    )}
                    <span>{isGoogleLoading ? 'Connecting to Google...' : 'Continue with Google'}</span>
                    {isGoogleLoading && <ButtonProgressBar tone="light" />}
                  </button>

                  <div className="relative my-6 flex items-center">
                    <div className="flex-grow border-t border-slate-200" />
                    <span className="mx-3 text-xs font-medium text-slate-500 whitespace-nowrap">
                      or continue with credentials
                    </span>
                    <div className="flex-grow border-t border-slate-200" />
                  </div>
                </>
              )}

              {mode === 'signin' && (
                <form onSubmit={handleSignInSubmit} className="space-y-4" noValidate>
                  <div className="space-y-1.5">
                    <label htmlFor="signin-identifier" className="block text-sm font-medium text-slate-800">
                      Username or email
                    </label>
                    <input
                      id="signin-identifier"
                      name="username"
                      type="text"
                      autoComplete="username"
                      required
                      value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)}
                      placeholder="alex_morgan or alex@company.com"
                      className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="signin-password" className="block text-sm font-medium text-slate-800">
                        Password
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setResetEmail(resolveLoginIdentifierToEmail(loginIdentifier) || '');
                          switchMode('forgot');
                        }}
                        className="text-xs font-medium text-blue-700 hover:text-blue-800 hover:underline underline-offset-2 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded-sm"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        id="signin-password"
                        name="password"
                        type={showLoginPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        required
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white pl-3.5 pr-11 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword((prev) => !prev)}
                        aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
                      >
                        {showLoginPassword ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <label className="inline-flex items-center gap-2.5 text-sm text-slate-600 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={rememberLogin}
                        onChange={(e) => setRememberLogin(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                      />
                      <span>Remember username on this device</span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    aria-busy={isSubmitting}
                    className={`relative overflow-hidden w-full min-h-[44px] mt-2 inline-flex items-center justify-center gap-2.5 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 ${
                      isSubmitting
                        ? 'bg-slate-800 cursor-wait'
                        : 'bg-slate-900 hover:bg-slate-800 active:bg-slate-950 disabled:opacity-60 disabled:cursor-not-allowed'
                    }`}
                  >
                    {isSubmitting && (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-300" aria-hidden="true" />
                    )}
                    <span aria-live="polite">{isSubmitting ? 'Signing in...' : 'Sign in'}</span>
                    {isSubmitting && <ButtonProgressBar tone="dark" />}
                  </button>

                  <p className="pt-2 text-center text-sm text-slate-600">
                    Don&apos;t have an account?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('signup')}
                      className="font-medium text-blue-700 hover:text-blue-800 hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded-sm"
                    >
                      Sign up
                    </button>
                  </p>
                </form>
              )}

              {mode === 'signup' && (
                <form onSubmit={handleSignUpSubmit} className="space-y-4" noValidate>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor="signup-username" className="block text-sm font-medium text-slate-800">
                        Username
                      </label>
                      <input
                        id="signup-username"
                        name="username"
                        type="text"
                        autoComplete="username"
                        required
                        maxLength={24}
                        value={signupUsername}
                        onChange={(e) => setSignupUsername(e.target.value)}
                        placeholder="alex_morgan"
                        className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="signup-name" className="block text-sm font-medium text-slate-800">
                        Full name <span className="text-slate-400 font-normal">(optional)</span>
                      </label>
                      <input
                        id="signup-name"
                        name="name"
                        type="text"
                        autoComplete="name"
                        maxLength={80}
                        value={signupDisplayName}
                        onChange={(e) => setSignupDisplayName(e.target.value)}
                        placeholder="Alex Morgan"
                        className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                      />
                    </div>
                  </div>

                  <p className="text-xs text-slate-500 -mt-2">
                    Usernames use 3–24 letters, numbers, underscores, or hyphens.
                  </p>

                  <div className="space-y-1.5">
                    <label htmlFor="signup-email" className="block text-sm font-medium text-slate-800">
                      Email address
                    </label>
                    <input
                      id="signup-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      maxLength={254}
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      placeholder="alex@company.com"
                      className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="signup-password" className="block text-sm font-medium text-slate-800">
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="signup-password"
                        name="new-password"
                        type={showSignupPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        aria-describedby="signup-password-strength"
                        required
                        value={signupPassword}
                        onChange={(e) => setSignupPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white pl-3.5 pr-11 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSignupPassword((prev) => !prev)}
                        aria-label={showSignupPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
                      >
                        {showSignupPassword ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>

                    <PasswordStrengthMeter
                      id="signup-password-strength"
                      password={signupPassword}
                      strength={passwordStrength}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="signup-confirm" className="block text-sm font-medium text-slate-800">
                      Confirm password
                    </label>
                    <input
                      id="signup-confirm"
                      name="confirm-password"
                      type={showSignupPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      value={signupConfirmPassword}
                      onChange={(e) => setSignupConfirmPassword(e.target.value)}
                      placeholder="Re-enter your password"
                      className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    aria-busy={isSubmitting}
                    className={`relative overflow-hidden w-full min-h-[44px] mt-2 inline-flex items-center justify-center gap-2.5 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 ${
                      isSubmitting
                        ? 'bg-slate-800 cursor-wait'
                        : 'bg-slate-900 hover:bg-slate-800 active:bg-slate-950 disabled:opacity-60 disabled:cursor-not-allowed'
                    }`}
                  >
                    {isSubmitting && (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-300" aria-hidden="true" />
                    )}
                    <span aria-live="polite">
                      {isSubmitting ? 'Creating account...' : 'Create account'}
                    </span>
                    {isSubmitting && <ButtonProgressBar tone="dark" />}
                  </button>

                  <p className="pt-2 text-center text-sm text-slate-600">
                    Already registered?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('signin')}
                      className="font-medium text-blue-700 hover:text-blue-800 hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded-sm"
                    >
                      Sign in
                    </button>
                  </p>
                </form>
              )}

              {mode === 'forgot' && (
                <form onSubmit={handleForgotSubmit} className="space-y-4" noValidate>
                  {resetSent ? (
                    <div className="space-y-4">
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 space-y-2">
                        <div className="flex items-start gap-2.5">
                          <CheckCircle2 className="h-4 w-4 text-emerald-700 mt-0.5 shrink-0" aria-hidden="true" />
                          <div>
                            <p className="font-medium">Password reset email sent</p>
                            <p className="text-emerald-800 mt-0.5">
                              Check <span className="font-medium">{resetEmail.trim()}</span> for instructions to set a new password.
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => switchMode('signin')}
                          className="flex-1 min-h-[44px] inline-flex items-center justify-center rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
                        >
                          Return to sign in
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setResetSent(false);
                            setErrorMessage(null);
                          }}
                          className="min-h-[44px] inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
                        >
                          Try another email
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <label htmlFor="reset-email" className="block text-sm font-medium text-slate-800">
                          Email address
                        </label>
                        <input
                          id="reset-email"
                          name="email"
                          type="email"
                          autoComplete="email"
                          required
                          value={resetEmail}
                          onChange={(e) => setResetEmail(e.target.value)}
                          placeholder="alex@company.com"
                          className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={busy}
                        aria-busy={isSubmitting}
                        className={`relative overflow-hidden w-full min-h-[44px] inline-flex items-center justify-center gap-2.5 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 ${
                          isSubmitting
                            ? 'bg-slate-800 cursor-wait'
                            : 'bg-slate-900 hover:bg-slate-800 active:bg-slate-950 disabled:opacity-60 disabled:cursor-not-allowed'
                        }`}
                      >
                        {isSubmitting && (
                          <Loader2 className="h-4 w-4 animate-spin text-blue-300" aria-hidden="true" />
                        )}
                        <span aria-live="polite">
                          {isSubmitting ? 'Sending reset link...' : 'Send reset link'}
                        </span>
                        {isSubmitting && <ButtonProgressBar tone="dark" />}
                      </button>
                    </>
                  )}
                </form>
              )}

              {mode === 'recovery' && (
                <form onSubmit={handleRecoverySubmit} className="space-y-4" noValidate>
                  <div className="space-y-1.5">
                    <label htmlFor="recovery-password" className="block text-sm font-medium text-slate-800">
                      New password
                    </label>
                    <div className="relative">
                      <input
                        id="recovery-password"
                        name="new-password"
                        type={showRecoveryPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        aria-describedby="recovery-password-strength"
                        required
                        value={recoveryPassword}
                        onChange={(e) => setRecoveryPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white pl-3.5 pr-11 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRecoveryPassword((prev) => !prev)}
                        aria-label={showRecoveryPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
                      >
                        {showRecoveryPassword ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>

                    <PasswordStrengthMeter
                      id="recovery-password-strength"
                      password={recoveryPassword}
                      strength={passwordStrength}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="recovery-confirm" className="block text-sm font-medium text-slate-800">
                      Confirm new password
                    </label>
                    <input
                      id="recovery-confirm"
                      name="confirm-password"
                      type={showRecoveryPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      value={recoveryConfirmPassword}
                      onChange={(e) => setRecoveryConfirmPassword(e.target.value)}
                      placeholder="Re-enter your new password"
                      className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    aria-busy={isSubmitting}
                    className={`relative overflow-hidden w-full min-h-[44px] inline-flex items-center justify-center gap-2.5 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 ${
                      isSubmitting
                        ? 'bg-slate-800 cursor-wait'
                        : 'bg-slate-900 hover:bg-slate-800 active:bg-slate-950 disabled:opacity-60 disabled:cursor-not-allowed'
                    }`}
                  >
                    {isSubmitting && (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-300" aria-hidden="true" />
                    )}
                    <span aria-live="polite">
                      {isSubmitting ? 'Updating password...' : 'Update password'}
                    </span>
                    {isSubmitting && <ButtonProgressBar tone="dark" />}
                  </button>
                </form>
              )}
            </motion.div>
          </AnimatePresence>
        </MotionConfig>
      </div>

      <footer className="text-xs text-slate-500 flex items-center justify-between gap-4 border-t border-slate-100 pt-4">
        <span>KainLab</span>
        <span>Email, Password &amp; Google Sign-In</span>
      </footer>
    </main>
  );
}
