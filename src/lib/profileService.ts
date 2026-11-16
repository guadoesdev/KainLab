import type { User } from 'firebase/auth';
import {
  doc,
  getDoc,
  serverTimestamp,
  type Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  BLUEPRINT_LIMITS,
  normalizeUsername,
  rememberUsernameEmailMapping,
} from './authHelpers';
import { getStorageProvider } from './storageBackend';

export const DEFAULT_DAILY_CALORIE_GOAL = 2000;

export interface UserProfileRecord {
  uid: string;
  username: string;
  displayName: string;
  dailyCalorieGoal: number;
  photoURL?: string;
  provider: 'google.com' | 'password';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

function buildSanitizedCandidateUsername(user: User, preferredUsername?: string): string {
  const rawSource =
    preferredUsername ||
    user.displayName ||
    user.email?.split('@')[0] ||
    `user_${user.uid.slice(0, 6)}`;

  let cleaned = rawSource
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');

  if (cleaned.length < BLUEPRINT_LIMITS.USERNAME_MIN) {
    cleaned = `user_${user.uid.slice(0, 6).toLowerCase()}`;
  }

  return cleaned.slice(0, BLUEPRINT_LIMITS.USERNAME_MAX);
}

async function findAvailableUsername(base: string, uid: string): Promise<string> {
  const firstCandidate = normalizeUsername(base).slice(0, BLUEPRINT_LIMITS.USERNAME_MAX);
  const firstRef = doc(db, 'usernames', firstCandidate);
  try {
    const snap = await getDoc(firstRef);
    if (!snap.exists() || snap.data()?.uid === uid) {
      return firstCandidate;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `usernames/${firstCandidate}`);
  }

  const suffix = `_${uid.slice(0, 5).toLowerCase()}`;
  return `${firstCandidate.slice(0, BLUEPRINT_LIMITS.USERNAME_MAX - suffix.length)}${suffix}`;
}

export async function loadOrSyncVerifiedProfile(
  user: User,
  preferredUsername?: string
): Promise<UserProfileRecord | null> {
  if (!user.emailVerified) {
    return null;
  }

  const providerMode = await getStorageProvider();
  if (providerMode === 'supabase') {
    const token = await user.getIdToken();
    const isGoogle = user.providerData.some((p) => p.providerId === 'google.com');
    const response = await fetch('/api/profile/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        email: user.email || '',
        displayName: user.displayName || undefined,
        photoURL: user.photoURL || undefined,
        provider: isGoogle ? 'google.com' : 'password',
        preferredUsername,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        typeof data?.error === 'string' ? data.error : 'Unable to sync account profile.'
      );
    }

    const profile = data as UserProfileRecord;
    if (user.email && profile.username) {
      rememberUsernameEmailMapping(profile.username, user.email);
    }
    return profile;
  }

  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);

  let existingSnap;
  try {
    existingSnap = await getDoc(userRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (existingSnap.exists()) {
    const raw = existingSnap.data() as Partial<UserProfileRecord>;
    const normalized: UserProfileRecord = {
      uid: raw.uid || user.uid,
      username: raw.username || buildSanitizedCandidateUsername(user, preferredUsername),
      displayName: raw.displayName || user.displayName || 'Member',
      dailyCalorieGoal:
        typeof raw.dailyCalorieGoal === 'number' &&
        raw.dailyCalorieGoal >= 800 &&
        raw.dailyCalorieGoal <= 10000
          ? raw.dailyCalorieGoal
          : DEFAULT_DAILY_CALORIE_GOAL,
      photoURL: raw.photoURL,
      provider: raw.provider === 'google.com' ? 'google.com' : 'password',
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };

    if (typeof raw.dailyCalorieGoal !== 'number') {
      try {
        const batch = writeBatch(db);
        batch.update(userRef, {
          dailyCalorieGoal: DEFAULT_DAILY_CALORIE_GOAL,
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, userPath);
      }
    }

    if (user.email && normalized.username) {
      rememberUsernameEmailMapping(normalized.username, user.email);
    }
    return normalized;
  }

  const baseUsername = buildSanitizedCandidateUsername(user, preferredUsername);
  const availableUsername = await findAvailableUsername(baseUsername, user.uid);

  const displayName = (user.displayName || availableUsername)
    .trim()
    .slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX);

  const isGoogle = user.providerData.some((p) => p.providerId === 'google.com');
  const provider: 'google.com' | 'password' = isGoogle ? 'google.com' : 'password';

  const profilePayload: Record<string, unknown> = {
    uid: user.uid,
    username: availableUsername,
    displayName: displayName || availableUsername,
    dailyCalorieGoal: DEFAULT_DAILY_CALORIE_GOAL,
    provider,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (user.photoURL && user.photoURL.length <= BLUEPRINT_LIMITS.PHOTO_URL_MAX) {
    profilePayload.photoURL = user.photoURL;
  }

  const email = (user.email || '').trim().slice(0, BLUEPRINT_LIMITS.EMAIL_MAX);
  const privatePayload = {
    uid: user.uid,
    email,
    updatedAt: serverTimestamp(),
  };

  const usernamePayload = {
    uid: user.uid,
    username: availableUsername,
    createdAt: serverTimestamp(),
  };

  const batch = writeBatch(db);
  batch.set(userRef, profilePayload);
  batch.set(doc(db, 'users', user.uid, 'private', 'contact'), privatePayload);
  batch.set(doc(db, 'usernames', availableUsername), usernamePayload);

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  if (email) {
    rememberUsernameEmailMapping(availableUsername, email);
  }

  try {
    const createdSnap = await getDoc(userRef);
    return createdSnap.exists() ? (createdSnap.data() as UserProfileRecord) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }
}

export async function updateDailyCalorieGoal(
  user: User,
  nextGoal: number
): Promise<number> {
  const clamped = Math.min(10000, Math.max(800, Math.round(nextGoal)));
  const providerMode = await getStorageProvider();

  if (providerMode === 'supabase') {
    const token = await user.getIdToken();
    const response = await fetch('/api/profile/goal', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ dailyCalorieGoal: clamped }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        typeof data?.error === 'string' ? data.error : 'Unable to update calorie goal.'
      );
    }
    return Number(data?.dailyCalorieGoal ?? clamped);
  }

  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  const batch = writeBatch(db);
  batch.update(userRef, {
    dailyCalorieGoal: clamped,
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }
  return clamped;
}
