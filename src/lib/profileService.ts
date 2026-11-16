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

export function deriveDefaultMacroGoals(dailyCalorieGoal: number): {
  proteinGoal: number;
  carbsGoal: number;
  fatGoal: number;
} {
  return {
    proteinGoal: Math.min(500, Math.max(40, Math.round((dailyCalorieGoal * 0.3) / 4))),
    carbsGoal: Math.min(1000, Math.max(50, Math.round((dailyCalorieGoal * 0.45) / 4))),
    fatGoal: Math.min(400, Math.max(25, Math.round((dailyCalorieGoal * 0.25) / 9))),
  };
}

export interface NutritionGoalsInput {
  displayName?: string;
  dailyCalorieGoal: number;
  proteinGoal: number;
  carbsGoal: number;
  fatGoal: number;
}

export interface UserProfileRecord {
  uid: string;
  username: string;
  displayName: string;
  dailyCalorieGoal: number;
  proteinGoal?: number;
  carbsGoal?: number;
  fatGoal?: number;
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
    const calGoal =
      typeof raw.dailyCalorieGoal === 'number' &&
      raw.dailyCalorieGoal >= 800 &&
      raw.dailyCalorieGoal <= 10000
        ? raw.dailyCalorieGoal
        : DEFAULT_DAILY_CALORIE_GOAL;
    const defaultMacros = deriveDefaultMacroGoals(calGoal);

    const normalized: UserProfileRecord = {
      uid: raw.uid || user.uid,
      username: raw.username || buildSanitizedCandidateUsername(user, preferredUsername),
      displayName: raw.displayName || user.displayName || 'Member',
      dailyCalorieGoal: calGoal,
      proteinGoal:
        typeof raw.proteinGoal === 'number' && raw.proteinGoal >= 20 && raw.proteinGoal <= 500
          ? raw.proteinGoal
          : defaultMacros.proteinGoal,
      carbsGoal:
        typeof raw.carbsGoal === 'number' && raw.carbsGoal >= 20 && raw.carbsGoal <= 1000
          ? raw.carbsGoal
          : defaultMacros.carbsGoal,
      fatGoal:
        typeof raw.fatGoal === 'number' && raw.fatGoal >= 10 && raw.fatGoal <= 400
          ? raw.fatGoal
          : defaultMacros.fatGoal,
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

  const defaultMacros = deriveDefaultMacroGoals(DEFAULT_DAILY_CALORIE_GOAL);
  const profilePayload: Record<string, unknown> = {
    uid: user.uid,
    username: availableUsername,
    displayName: displayName || availableUsername,
    dailyCalorieGoal: DEFAULT_DAILY_CALORIE_GOAL,
    proteinGoal: defaultMacros.proteinGoal,
    carbsGoal: defaultMacros.carbsGoal,
    fatGoal: defaultMacros.fatGoal,
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

export async function updateNutritionGoals(
  user: User,
  goals: NutritionGoalsInput
): Promise<{
  displayName?: string;
  dailyCalorieGoal: number;
  proteinGoal: number;
  carbsGoal: number;
  fatGoal: number;
}> {
  const dailyCalorieGoal = Math.min(10000, Math.max(800, Math.round(goals.dailyCalorieGoal)));
  const proteinGoal = Math.min(500, Math.max(20, Math.round(goals.proteinGoal)));
  const carbsGoal = Math.min(1000, Math.max(20, Math.round(goals.carbsGoal)));
  const fatGoal = Math.min(400, Math.max(10, Math.round(goals.fatGoal)));
  const sanitizedDisplayName =
    typeof goals.displayName === 'string' && goals.displayName.trim()
      ? goals.displayName.trim().slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX)
      : undefined;

  const providerMode = await getStorageProvider();
  if (providerMode === 'supabase') {
    const token = await user.getIdToken();
    const response = await fetch('/api/profile/goals', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        displayName: sanitizedDisplayName,
        dailyCalorieGoal,
        proteinGoal,
        carbsGoal,
        fatGoal,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        typeof data?.error === 'string' ? data.error : 'Unable to save nutrition goals.'
      );
    }
    return {
      displayName:
        typeof data?.displayName === 'string' ? data.displayName : sanitizedDisplayName,
      dailyCalorieGoal: Number(data?.dailyCalorieGoal ?? dailyCalorieGoal),
      proteinGoal: Number(data?.proteinGoal ?? proteinGoal),
      carbsGoal: Number(data?.carbsGoal ?? carbsGoal),
      fatGoal: Number(data?.fatGoal ?? fatGoal),
    };
  }

  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  const updateData: Record<string, unknown> = {
    dailyCalorieGoal,
    proteinGoal,
    carbsGoal,
    fatGoal,
    updatedAt: serverTimestamp(),
  };
  if (sanitizedDisplayName) {
    updateData.displayName = sanitizedDisplayName;
  }

  const batch = writeBatch(db);
  batch.update(userRef, updateData);
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }

  return {
    displayName: sanitizedDisplayName,
    dailyCalorieGoal,
    proteinGoal,
    carbsGoal,
    fatGoal,
  };
}
