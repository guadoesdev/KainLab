/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  refreshSupabaseUserSession,
  subscribeToSupabaseAuth,
  type AppAuthUser,
} from './lib/supabaseAuth';
import { loadOrSyncVerifiedProfile, type UserProfileRecord } from './lib/profileService';
import { AuthShowcasePanel } from './components/AuthShowcasePanel';
import { AuthFormPanel } from './components/AuthFormPanel';
import { TodayScreen } from './components/TodayScreen';
import type { RegistrationNotice } from './components/VerificationBanner';

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [supabaseConfigured, setSupabaseConfigured] = useState(true);
  const [user, setUser] = useState<AppAuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfileRecord | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [initialAuthError, setInitialAuthError] = useState<string | null>(null);
  const [passwordRecoveryActive, setPasswordRecoveryActive] = useState(false);
  const [registrationNotice, setRegistrationNotice] = useState<RegistrationNotice | null>(null);
  const pendingUsernameRef = useRef<string | undefined>(undefined);
  const isRegisteringRef = useRef(false);

  const syncUserProfile = useCallback(async (currentUser: AppAuthUser) => {
    if (!currentUser.emailVerified) {
      setProfile(null);
      return;
    }

    setSyncError(null);
    try {
      const loaded = await loadOrSyncVerifiedProfile(
        currentUser,
        pendingUsernameRef.current
      );
      pendingUsernameRef.current = undefined;
      setProfile(loaded);
    } catch (error) {
      setSyncError(
        error instanceof Error ? error.message : 'Unable to sync account profile.'
      );
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToSupabaseAuth({
      onConfigStatus: (configured) => {
        setSupabaseConfigured(configured);
      },
      onAuthError: (message) => {
        setInitialAuthError(message);
      },
      onSessionChange: async (nextUser, event) => {
        if (isRegisteringRef.current) {
          return;
        }
        if (event === 'PASSWORD_RECOVERY') {
          setPasswordRecoveryActive(true);
        } else if (event === 'SIGNED_OUT') {
          setPasswordRecoveryActive(false);
        }

        setUser(nextUser);
        setAuthReady(true);
        if (nextUser) {
          setRegistrationNotice(null);
          await syncUserProfile(nextUser);
        } else {
          setProfile(null);
          setSyncError(null);
        }
      },
    });
    return () => unsubscribe();
  }, [syncUserProfile]);

  async function handleRefreshVerification() {
    const refreshedUser = await refreshSupabaseUserSession();
    setUser(refreshedUser);
    if (refreshedUser?.emailVerified) {
      await syncUserProfile(refreshedUser);
    }
  }

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
        <div className="inline-flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-700" aria-hidden="true" />
          <span>Loading Today...</span>
        </div>
      </div>
    );
  }

  if (user && !passwordRecoveryActive) {
    return (
      <>
        {syncError && (
          <div
            role="alert"
            className="bg-red-50 border-b border-red-200 px-6 py-2.5 text-xs text-red-800 text-center"
          >
            Profile sync notice: {syncError}
          </div>
        )}
        <TodayScreen
          user={user}
          profile={profile}
          onProfileUpdated={setProfile}
          onVerificationRefreshed={handleRefreshVerification}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 items-stretch bg-white">
      <AuthShowcasePanel />
      <AuthFormPanel
        supabaseConfigured={supabaseConfigured}
        initialAuthError={initialAuthError}
        passwordRecoveryActive={passwordRecoveryActive}
        onPasswordRecoveryComplete={async () => {
          setPasswordRecoveryActive(false);
          const refreshed = await refreshSupabaseUserSession();
          setUser(refreshed);
          if (refreshed) {
            await syncUserProfile(refreshed);
          }
        }}
        registrationNotice={registrationNotice}
        onDismissRegistrationNotice={() => setRegistrationNotice(null)}
        onRegistrationStarted={(username) => {
          pendingUsernameRef.current = username;
          isRegisteringRef.current = true;
        }}
        onRegistrationCompleted={(notice) => {
          isRegisteringRef.current = false;
          setUser(null);
          setRegistrationNotice(notice);
        }}
        onRegistrationAutoSignedIn={async (signedInUser) => {
          isRegisteringRef.current = false;
          setUser(signedInUser);
          await syncUserProfile(signedInUser);
        }}
        onRegistrationFailed={() => {
          isRegisteringRef.current = false;
        }}
      />
    </div>
  );
}
