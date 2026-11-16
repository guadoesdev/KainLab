import type { AppAuthUser } from './supabaseAuth';
import type {
  ChatMessageItem,
  MealEntry,
  MealType,
  NutritionAnalysisResponse,
  NutritionTotals,
} from '../types/nutrition';

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getTodayDateKey(): string {
  return formatDateKey(new Date());
}

export interface DayMeta {
  dateKey: string;
  shortLabel: string;
  fullLabel: string;
  isToday: boolean;
}

export function getLast7DaysMeta(): DayMeta[] {
  const now = new Date();
  const days: DayMeta[] = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const isToday = offset === 0;
    days.push({
      dateKey: formatDateKey(d),
      shortLabel: isToday
        ? 'Today'
        : d.toLocaleDateString(undefined, { weekday: 'short' }),
      fullLabel: d.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
      isToday,
    });
  }

  return days;
}

export async function fetchSevenDayCalorieHistory(
  user: AppAuthUser,
  dateKeys: string[]
): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (const key of dateKeys) {
    totals[key] = 0;
  }
  if (dateKeys.length === 0) {
    return totals;
  }

  const token = await user.getAccessToken();
  const response = await fetch(
    `/api/calories-history?dateKeys=${encodeURIComponent(dateKeys.join(','))}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data?.error === 'string'
        ? data.error
        : 'Unable to load 7-day calorie history.'
    );
  }
  const serverTotals =
    data?.totalsByDate && typeof data.totalsByDate === 'object'
      ? (data.totalsByDate as Record<string, unknown>)
      : {};
  for (const key of dateKeys) {
    totals[key] = Math.max(0, Math.round(Number(serverTotals[key] ?? 0)));
  }
  return totals;
}

export async function fetchMealsInDateRange(
  user: AppAuthUser,
  startDateKey: string,
  endDateKey: string
): Promise<MealEntry[]> {
  const token = await user.getAccessToken();
  const response = await fetch(
    `/api/meals-range?startDateKey=${encodeURIComponent(startDateKey)}&endDateKey=${encodeURIComponent(endDateKey)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : 'Unable to load meal summary range.'
    );
  }
  const rows = Array.isArray(data?.meals) ? data.meals : [];
  return rows.map((row: MealEntry & { createdAt?: string; updatedAt?: string }) => ({
    ...row,
    createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
  }));
}

export function generateRecordId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

export async function fetchTodayMeals(
  user: AppAuthUser,
  dateKey: string
): Promise<MealEntry[]> {
  const token = await user.getAccessToken();
  const response = await fetch(`/api/meals?dateKey=${encodeURIComponent(dateKey)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Unable to load meals.');
  }
  const rows = Array.isArray(data?.meals) ? data.meals : [];
  return rows.map((row: MealEntry & { createdAt?: string; updatedAt?: string }) => ({
    ...row,
    createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
  }));
}

export async function fetchTodayChat(
  user: AppAuthUser,
  dateKey: string
): Promise<ChatMessageItem[]> {
  const token = await user.getAccessToken();
  const response = await fetch(`/api/chat-messages?dateKey=${encodeURIComponent(dateKey)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Unable to load chat history.');
  }
  const rows = Array.isArray(data?.messages) ? data.messages : [];
  return rows.map((row: ChatMessageItem & { timestamp?: string }) => ({
    ...row,
    timestamp: row.timestamp ? new Date(row.timestamp) : new Date(),
  }));
}

export async function createMealEntry(
  user: AppAuthUser,
  meal: Omit<MealEntry, 'createdAt' | 'updatedAt'>
): Promise<void> {
  const foods = meal.foods
    .map((f) => f.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 20);
  if (foods.length === 0) {
    throw new Error('Meal must contain at least one food item.');
  }

  const token = await user.getAccessToken();
  const response = await fetch('/api/meals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      id: meal.id,
      dateKey: meal.dateKey,
      mealType: meal.mealType,
      foods,
      portions: meal.portions,
      calories: meal.calories,
      protein: meal.protein,
      carbs: meal.carbs,
      fat: meal.fat,
      confidence: meal.confidence,
      source: meal.source,
      sources: meal.sources || [],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Unable to save meal.');
  }
}

export async function updateMealEntry(
  user: AppAuthUser,
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
): Promise<void> {
  const foods = updates.foods
    .map((f) => f.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 20);
  if (foods.length === 0) {
    throw new Error('Meal must include at least one food item.');
  }

  const token = await user.getAccessToken();
  const response = await fetch(`/api/meals/${encodeURIComponent(mealId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      mealType: updates.mealType,
      foods,
      portions: updates.portions,
      calories: updates.calories,
      protein: updates.protein,
      carbs: updates.carbs,
      fat: updates.fat,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Unable to update meal.');
  }
}

export async function deleteMealEntry(
  user: AppAuthUser,
  mealId: string
): Promise<void> {
  const token = await user.getAccessToken();
  const response = await fetch(`/api/meals/${encodeURIComponent(mealId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Unable to delete meal.');
  }
}

export async function saveChatMessage(
  user: AppAuthUser,
  msg: Omit<ChatMessageItem, 'timestamp' | 'localImagePreview'>
): Promise<void> {
  const token = await user.getAccessToken();
  const response = await fetch('/api/chat-messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(msg),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : 'Unable to save chat message.'
    );
  }
}

export async function clearChatMessages(
  user: AppAuthUser,
  dateKey?: string
): Promise<void> {
  const token = await user.getAccessToken();
  const resolvedDateKey = dateKey || getTodayDateKey();
  const response = await fetch(
    `/api/chat-messages?dateKey=${encodeURIComponent(resolvedDateKey)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : 'Unable to clear chat history.'
    );
  }
}

export async function callChatMealApi(
  user: AppAuthUser,
  params: {
    message: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    dateKey: string;
  }
): Promise<NutritionAnalysisResponse> {
  const token = await user.getAccessToken();
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      message: params.message,
      history: params.history,
      dateKey: params.dateKey,
      currentTimeIso: new Date().toISOString(),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data?.error === 'string'
        ? data.error
        : `Request failed with status ${response.status}`
    );
  }
  return data as NutritionAnalysisResponse;
}

export async function callAnalyzeImageApi(
  user: AppAuthUser,
  params: {
    imageFile: File;
    caption?: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    dateKey: string;
  }
): Promise<NutritionAnalysisResponse> {
  const token = await user.getAccessToken();
  const formData = new FormData();
  formData.append('image', params.imageFile);
  if (params.caption) {
    formData.append('caption', params.caption);
  }
  formData.append('history', JSON.stringify(params.history));
  formData.append('dateKey', params.dateKey);
  formData.append('currentTimeIso', new Date().toISOString());

  const response = await fetch('/api/analyze-image', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data?.error === 'string'
        ? data.error
        : `Image analysis failed with status ${response.status}`
    );
  }
  return data as NutritionAnalysisResponse;
}

export async function syncSummaryWithBackend(
  user: AppAuthUser,
  totals: NutritionTotals,
  dailyCalorieGoal: number,
  dateKey: string
): Promise<void> {
  try {
    const token = await user.getAccessToken();
    await fetch('/api/today-summary/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        dateKey,
        calories: totals.calories,
        protein: totals.protein,
        carbs: totals.carbs,
        fat: totals.fat,
        daily_calorie_goal: dailyCalorieGoal,
      }),
    });
  } catch {
    // Non-blocking background sync for GET /today-summary
  }
}
