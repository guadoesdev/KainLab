import {
  BLUEPRINT_LIMITS,
  rememberUsernameEmailMapping,
} from './authHelpers';
import type { AppAuthUser } from './supabaseAuth';

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
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export async function loadOrSyncVerifiedProfile(
  user: AppAuthUser,
  preferredUsername?: string
): Promise<UserProfileRecord | null> {
  if (!user.emailVerified) {
    return null;
  }

  const token = await user.getAccessToken();
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
      provider: user.providerId,
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

export async function updateDailyCalorieGoal(
  user: AppAuthUser,
  nextGoal: number
): Promise<number> {
  const clamped = Math.min(10000, Math.max(800, Math.round(nextGoal)));
  const token = await user.getAccessToken();
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

export async function updateNutritionGoals(
  user: AppAuthUser,
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

  const token = await user.getAccessToken();
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
