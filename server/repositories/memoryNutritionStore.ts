import type { MealSource, MealType, NutritionTotals } from '../types/nutrition.ts';
import type {
  SupabaseChatMessageRecord,
  SupabaseMealRecord,
  SupabaseProfileRecord,
} from './supabaseNutritionRepository.ts';

function deriveDefaultMacroGoals(dailyCalorieGoal: number) {
  return {
    proteinGoal: Math.min(500, Math.max(40, Math.round((dailyCalorieGoal * 0.3) / 4))),
    carbsGoal: Math.min(1000, Math.max(50, Math.round((dailyCalorieGoal * 0.45) / 4))),
    fatGoal: Math.min(400, Math.max(25, Math.round((dailyCalorieGoal * 0.25) / 9))),
  };
}

function sanitizeUsername(
  uid: string,
  preferredUsername?: string,
  email?: string,
  displayName?: string
): string {
  const raw = preferredUsername || displayName || email?.split('@')[0] || `user_${uid.slice(0, 6)}`;
  let cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  if (cleaned.length < 3) {
    cleaned = `user_${uid.slice(0, 6).toLowerCase()}`;
  }
  return cleaned.slice(0, 24);
}

const profilesStore = new Map<string, SupabaseProfileRecord>();
const mealsStore = new Map<string, SupabaseMealRecord[]>();
const chatStore = new Map<string, SupabaseChatMessageRecord[]>();

export function syncProfileInMemory(params: {
  uid: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
  provider?: 'google.com' | 'password';
  preferredUsername?: string;
}): SupabaseProfileRecord {
  const existing = profilesStore.get(params.uid);
  if (existing) {
    return existing;
  }
  const username = sanitizeUsername(
    params.uid,
    params.preferredUsername,
    params.email,
    params.displayName
  );
  const defaultGoal = 2000;
  const macros = deriveDefaultMacroGoals(defaultGoal);
  const record: SupabaseProfileRecord = {
    uid: params.uid,
    username,
    displayName: (params.displayName || username).trim().slice(0, 80) || username,
    dailyCalorieGoal: defaultGoal,
    proteinGoal: macros.proteinGoal,
    carbsGoal: macros.carbsGoal,
    fatGoal: macros.fatGoal,
    photoURL: params.photoURL?.slice(0, 500),
    provider: params.provider === 'google.com' ? 'google.com' : 'password',
  };
  profilesStore.set(params.uid, record);
  return record;
}

export function updateCalorieGoalInMemory(uid: string, nextGoal: number): number {
  const clamped = Math.min(10000, Math.max(800, Math.round(nextGoal)));
  const existing = profilesStore.get(uid) ?? syncProfileInMemory({ uid });
  profilesStore.set(uid, { ...existing, dailyCalorieGoal: clamped });
  return clamped;
}

export function updateNutritionGoalsInMemory(
  uid: string,
  goals: {
    displayName?: string;
    dailyCalorieGoal: number;
    proteinGoal: number;
    carbsGoal: number;
    fatGoal: number;
  }
) {
  const dailyCalorieGoal = Math.min(10000, Math.max(800, Math.round(goals.dailyCalorieGoal)));
  const proteinGoal = Math.min(500, Math.max(20, Math.round(goals.proteinGoal)));
  const carbsGoal = Math.min(1000, Math.max(20, Math.round(goals.carbsGoal)));
  const fatGoal = Math.min(400, Math.max(10, Math.round(goals.fatGoal)));
  const displayName =
    typeof goals.displayName === 'string' && goals.displayName.trim()
      ? goals.displayName.trim().slice(0, 80)
      : undefined;

  const existing = profilesStore.get(uid) ?? syncProfileInMemory({ uid });
  const updated: SupabaseProfileRecord = {
    ...existing,
    displayName: displayName || existing.displayName,
    dailyCalorieGoal,
    proteinGoal,
    carbsGoal,
    fatGoal,
  };
  profilesStore.set(uid, updated);
  return {
    displayName: updated.displayName,
    dailyCalorieGoal,
    proteinGoal,
    carbsGoal,
    fatGoal,
  };
}

export function listMealsInMemory(userId: string, dateKey: string): SupabaseMealRecord[] {
  return (mealsStore.get(userId) ?? []).filter((m) => m.dateKey === dateKey);
}

export function listMealsRangeInMemory(
  userId: string,
  startDateKey: string,
  endDateKey: string
): SupabaseMealRecord[] {
  return (mealsStore.get(userId) ?? []).filter(
    (m) => m.dateKey >= startDateKey && m.dateKey <= endDateKey
  );
}

export function createMealInMemory(
  userId: string,
  meal: {
    id: string;
    dateKey: string;
    mealType: MealType;
    foods: string[];
    portions: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    confidence: number;
    source: MealSource;
    sources?: string[];
  }
): SupabaseMealRecord {
  const foods = meal.foods
    .map((f) => f.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 20);
  if (foods.length === 0) {
    throw new Error('Meal must contain at least one food item.');
  }
  const now = new Date().toISOString();
  const record: SupabaseMealRecord = {
    id: meal.id,
    userId,
    dateKey: meal.dateKey,
    mealType: meal.mealType,
    foods,
    portions: meal.portions.trim().slice(0, 500) || foods.join(', '),
    calories: Math.min(10000, Math.max(0, Math.round(meal.calories))),
    protein: Math.min(1000, Math.max(0, Math.round(meal.protein))),
    carbs: Math.min(1000, Math.max(0, Math.round(meal.carbs))),
    fat: Math.min(1000, Math.max(0, Math.round(meal.fat))),
    confidence: Math.min(1, Math.max(0, Number(meal.confidence.toFixed(2)))),
    source: meal.source,
    sources: (meal.sources || []).filter((s) => s.startsWith('http')).slice(0, 5),
    createdAt: now,
    updatedAt: now,
  };
  const list = mealsStore.get(userId) ?? [];
  mealsStore.set(userId, [...list, record]);
  return record;
}

export function updateMealInMemory(
  userId: string,
  mealId: string,
  updates: {
    mealType: MealType;
    foods: string[];
    portions: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }
): void {
  const foods = updates.foods
    .map((f) => f.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 20);
  if (foods.length === 0) {
    throw new Error('Meal must include at least one food item.');
  }
  const list = mealsStore.get(userId) ?? [];
  mealsStore.set(
    userId,
    list.map((m) =>
      m.id === mealId
        ? {
            ...m,
            mealType: updates.mealType,
            foods,
            portions: updates.portions.trim().slice(0, 500) || foods.join(', '),
            calories: Math.min(10000, Math.max(0, Math.round(updates.calories))),
            protein: Math.min(1000, Math.max(0, Math.round(updates.protein))),
            carbs: Math.min(1000, Math.max(0, Math.round(updates.carbs))),
            fat: Math.min(1000, Math.max(0, Math.round(updates.fat))),
            updatedAt: new Date().toISOString(),
          }
        : m
    )
  );
}

export function deleteMealInMemory(userId: string, mealId: string): void {
  const list = mealsStore.get(userId) ?? [];
  mealsStore.set(
    userId,
    list.filter((m) => m.id !== mealId)
  );
}

export function listChatMessagesInMemory(
  userId: string,
  dateKey: string
): SupabaseChatMessageRecord[] {
  return (chatStore.get(userId) ?? []).filter((m) => m.dateKey === dateKey);
}

export function saveChatMessageInMemory(
  userId: string,
  msg: Omit<SupabaseChatMessageRecord, 'userId' | 'timestamp'>
): SupabaseChatMessageRecord {
  const record: SupabaseChatMessageRecord = {
    ...msg,
    userId,
    content: msg.content.trim().slice(0, 4000) || '...',
    nutritionSnapshot: msg.nutritionSnapshot
      ? {
          calories: Math.max(0, Math.round(msg.nutritionSnapshot.calories)),
          protein: Math.max(0, Math.round(msg.nutritionSnapshot.protein)),
          carbs: Math.max(0, Math.round(msg.nutritionSnapshot.carbs)),
          fat: Math.max(0, Math.round(msg.nutritionSnapshot.fat)),
        }
      : undefined,
    timestamp: new Date().toISOString(),
  };
  const list = chatStore.get(userId) ?? [];
  chatStore.set(userId, [...list, record]);
  return record;
}

export function clearChatMessagesInMemory(userId: string, dateKey: string): void {
  const list = chatStore.get(userId) ?? [];
  chatStore.set(
    userId,
    list.filter((m) => m.dateKey !== dateKey)
  );
}

export function getSevenDayCaloriesInMemory(
  userId: string,
  dateKeys: string[]
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const key of dateKeys) {
    totals[key] = 0;
  }
  for (const meal of mealsStore.get(userId) ?? []) {
    if (meal.dateKey in totals) {
      totals[meal.dateKey] += Math.max(0, Number(meal.calories) || 0);
    }
  }
  return totals;
}
