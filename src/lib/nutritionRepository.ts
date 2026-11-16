import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { getStorageProvider } from './storageBackend';
import type {
  ChatMessageItem,
  MealEntry,
  MealType,
  NutritionAnalysisResponse,
  NutritionTotals,
} from '../types/nutrition';

export function getTodayDateKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function generateRecordId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

export async function fetchTodayMealsFromSupabase(
  user: User,
  dateKey: string
): Promise<MealEntry[]> {
  const token = await user.getIdToken();
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

export async function fetchTodayChatFromSupabase(
  user: User,
  dateKey: string
): Promise<ChatMessageItem[]> {
  const token = await user.getIdToken();
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

export function subscribeToTodayMeals(
  userId: string,
  dateKey: string,
  onData: (meals: MealEntry[]) => void
): Unsubscribe {
  const path = `users/${userId}/meals`;
  const mealsQuery = query(
    collection(db, 'users', userId, 'meals'),
    where('dateKey', '==', dateKey),
    orderBy('createdAt', 'asc')
  );

  return onSnapshot(
    mealsQuery,
    (snapshot) => {
      const items = snapshot.docs.map((docSnap) => docSnap.data() as MealEntry);
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeToTodayChat(
  userId: string,
  dateKey: string,
  onData: (messages: ChatMessageItem[]) => void
): Unsubscribe {
  const path = `users/${userId}/chatMessages`;
  const chatQuery = query(
    collection(db, 'users', userId, 'chatMessages'),
    where('dateKey', '==', dateKey),
    orderBy('timestamp', 'asc')
  );

  return onSnapshot(
    chatQuery,
    (snapshot) => {
      const items = snapshot.docs.map((docSnap) => docSnap.data() as ChatMessageItem);
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function createMealEntryInFirestore(
  user: User,
  meal: Omit<MealEntry, 'createdAt' | 'updatedAt'>
): Promise<void> {
  const path = `users/${user.uid}/meals/${meal.id}`;
  const foods = meal.foods
    .map((f) => f.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 20);
  if (foods.length === 0) {
    throw new Error('Meal must contain at least one food item.');
  }

  if ((await getStorageProvider()) === 'supabase') {
    const token = await user.getIdToken();
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
    return;
  }

  const payload: Record<string, unknown> = {
    id: meal.id,
    userId: user.uid,
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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (meal.sources && meal.sources.length > 0) {
    payload.sources = meal.sources
      .map((s) => s.trim().slice(0, 300))
      .filter((s) => s.startsWith('http'))
      .slice(0, 5);
  }

  try {
    await setDoc(doc(db, 'users', user.uid, 'meals', meal.id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateMealEntryInFirestore(
  user: User,
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
  const path = `users/${user.uid}/meals/${mealId}`;
  const foods = updates.foods
    .map((f) => f.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 20);
  if (foods.length === 0) {
    throw new Error('Meal must include at least one food item.');
  }

  if ((await getStorageProvider()) === 'supabase') {
    const token = await user.getIdToken();
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
    return;
  }

  try {
    await updateDoc(doc(db, 'users', user.uid, 'meals', mealId), {
      mealType: updates.mealType,
      foods,
      portions: updates.portions.trim().slice(0, 500) || foods.join(', '),
      calories: Math.min(10000, Math.max(0, Math.round(updates.calories))),
      protein: Math.min(1000, Math.max(0, Math.round(updates.protein))),
      carbs: Math.min(1000, Math.max(0, Math.round(updates.carbs))),
      fat: Math.min(1000, Math.max(0, Math.round(updates.fat))),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteMealEntryInFirestore(
  user: User,
  mealId: string
): Promise<void> {
  if ((await getStorageProvider()) === 'supabase') {
    const token = await user.getIdToken();
    const response = await fetch(`/api/meals/${encodeURIComponent(mealId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof data?.error === 'string' ? data.error : 'Unable to delete meal.');
    }
    return;
  }

  const path = `users/${user.uid}/meals/${mealId}`;
  try {
    await deleteDoc(doc(db, 'users', user.uid, 'meals', mealId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveChatMessageInFirestore(
  user: User,
  msg: Omit<ChatMessageItem, 'timestamp' | 'localImagePreview'>
): Promise<void> {
  const path = `users/${user.uid}/chatMessages/${msg.id}`;
  const payload: Record<string, unknown> = {
    id: msg.id,
    userId: user.uid,
    dateKey: msg.dateKey,
    role: msg.role,
    content: msg.content.trim().slice(0, 4000) || '...',
    timestamp: serverTimestamp(),
  };

  if (msg.mealId) {
    payload.mealId = msg.mealId;
  }
  if (typeof msg.confidence === 'number') {
    payload.confidence = Math.min(1, Math.max(0, Number(msg.confidence.toFixed(2))));
  }
  if (msg.clarificationOptions && msg.clarificationOptions.length > 0) {
    payload.clarificationOptions = msg.clarificationOptions
      .map((opt) => opt.trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 6);
  }
  if (msg.sources && msg.sources.length > 0) {
    payload.sources = msg.sources
      .map((s) => s.trim().slice(0, 300))
      .filter((s) => s.startsWith('http'))
      .slice(0, 5);
  }
  if (msg.nutritionSnapshot) {
    payload.nutritionSnapshot = {
      calories: Math.min(10000, Math.max(0, Math.round(msg.nutritionSnapshot.calories))),
      protein: Math.min(1000, Math.max(0, Math.round(msg.nutritionSnapshot.protein))),
      carbs: Math.min(1000, Math.max(0, Math.round(msg.nutritionSnapshot.carbs))),
      fat: Math.min(1000, Math.max(0, Math.round(msg.nutritionSnapshot.fat))),
    };
  }
  if (typeof msg.hasImage === 'boolean') {
    payload.hasImage = msg.hasImage;
  }

  if ((await getStorageProvider()) === 'supabase') {
    const token = await user.getIdToken();
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
    return;
  }

  try {
    await setDoc(doc(db, 'users', user.uid, 'chatMessages', msg.id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function clearChatMessagesInFirestore(
  user: User,
  messageIds: string[],
  dateKey?: string
): Promise<void> {
  if ((await getStorageProvider()) === 'supabase') {
    const token = await user.getIdToken();
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
    return;
  }

  for (const id of messageIds) {
    const path = `users/${user.uid}/chatMessages/${id}`;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'chatMessages', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }
}

export async function callChatMealApi(
  user: User,
  params: {
    message: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    dateKey: string;
  }
): Promise<NutritionAnalysisResponse> {
  const token = await user.getIdToken();
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
  user: User,
  params: {
    imageFile: File;
    caption?: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    dateKey: string;
  }
): Promise<NutritionAnalysisResponse> {
  const token = await user.getIdToken();
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
  user: User,
  totals: NutritionTotals,
  dailyCalorieGoal: number,
  dateKey: string
): Promise<void> {
  try {
    const token = await user.getIdToken();
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
