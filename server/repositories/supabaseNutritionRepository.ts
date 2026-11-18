import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { MealRepository } from './mealRepository.ts';
import type {
  MealSource,
  MealType,
  NutritionTotals,
  TodaySummaryRecord,
} from '../types/nutrition.ts';

export interface SupabaseProfileRecord {
  uid: string;
  username: string;
  displayName: string;
  dailyCalorieGoal: number;
  proteinGoal: number;
  carbsGoal: number;
  fatGoal: number;
  photoURL?: string;
  provider: 'google.com' | 'password';
}

export interface SupabaseMealRecord {
  id: string;
  userId: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface SupabaseChatMessageRecord {
  id: string;
  userId: string;
  dateKey: string;
  role: 'user' | 'assistant';
  content: string;
  mealId?: string;
  confidence?: number;
  clarificationOptions?: string[];
  sources?: string[];
  nutritionSnapshot?: NutritionTotals;
  hasImage?: boolean;
  timestamp: string;
}

let cachedClient: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  if (process.env.DATABASE_PROVIDER === 'firestore') {
    return false;
  }
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return Boolean(
    url &&
    key &&
    !url.includes('your-project-ref') &&
    key !== 'MY_SUPABASE_SERVICE_ROLE_KEY'
  );
}

function getSupabaseClient(): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.');
  }
  cachedClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedClient;
}

function buildSanitizedUsername(uid: string, preferredUsername?: string, email?: string, displayName?: string): string {
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

export class SupabaseDailyLedgerRepository implements MealRepository {
  async getTodaySummary(userId: string, dateKey: string): Promise<TodaySummaryRecord> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('daily_summaries')
      .select('date_key, calories, protein, carbs, fat, daily_calorie_goal')
      .eq('user_id', userId)
      .eq('date_key', dateKey)
      .maybeSingle();

    if (error) {
      throw new Error(`Supabase daily summary read failed: ${error.message}`);
    }

    if (!data) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('daily_calorie_goal')
        .eq('uid', userId)
        .maybeSingle();
      const goal =
        typeof profileData?.daily_calorie_goal === 'number'
          ? profileData.daily_calorie_goal
          : 2000;
      return {
        dateKey,
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        daily_calorie_goal: goal,
        remaining: goal,
      };
    }

    const goal = Number(data.daily_calorie_goal ?? 2000);
    const calories = Number(data.calories ?? 0);
    return {
      dateKey: data.date_key,
      calories,
      protein: Number(data.protein ?? 0),
      carbs: Number(data.carbs ?? 0),
      fat: Number(data.fat ?? 0),
      daily_calorie_goal: goal,
      remaining: Math.max(0, goal - calories),
    };
  }

  async addMealTotals(
    userId: string,
    dateKey: string,
    nutrition: NutritionTotals
  ): Promise<TodaySummaryRecord> {
    const current = await this.getTodaySummary(userId, dateKey);
    return this.replaceDailySummary(
      userId,
      dateKey,
      {
        calories: current.calories + nutrition.calories,
        protein: current.protein + nutrition.protein,
        carbs: current.carbs + nutrition.carbs,
        fat: current.fat + nutrition.fat,
      },
      current.daily_calorie_goal
    );
  }

  async replaceDailySummary(
    userId: string,
    dateKey: string,
    totals: NutritionTotals,
    dailyCalorieGoal: number
  ): Promise<TodaySummaryRecord> {
    const supabase = getSupabaseClient();
    const safeGoal = Math.min(10000, Math.max(800, Math.round(dailyCalorieGoal)));
    const calories = Math.max(0, Math.round(totals.calories));
    const protein = Math.max(0, Math.round(totals.protein));
    const carbs = Math.max(0, Math.round(totals.carbs));
    const fat = Math.max(0, Math.round(totals.fat));

    const { error } = await supabase.from('daily_summaries').upsert(
      {
        user_id: userId,
        date_key: dateKey,
        calories,
        protein,
        carbs,
        fat,
        daily_calorie_goal: safeGoal,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,date_key' }
    );

    if (error) {
      throw new Error(`Supabase daily summary sync failed: ${error.message}`);
    }

    return {
      dateKey,
      calories,
      protein,
      carbs,
      fat,
      daily_calorie_goal: safeGoal,
      remaining: Math.max(0, safeGoal - calories),
    };
  }
}

export async function syncProfileInSupabase(params: {
  uid: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
  provider?: 'google.com' | 'password';
  preferredUsername?: string;
}): Promise<SupabaseProfileRecord> {
  const supabase = getSupabaseClient();
  console.log('Looking up profile for uid:', params.uid);
  const { data: existing, error: fetchError } = await supabase
    .from('profiles')
    .select(
      'uid, username, display_name, daily_calorie_goal, protein_goal, carbs_goal, fat_goal, photo_url, provider'
    )
    .eq('uid', params.uid)
    .maybeSingle();

  console.log('Existing profile:', existing);
  console.log('Fetch error:', fetchError);

  if (fetchError) {
    throw new Error(`Failed to load profile from Supabase: ${fetchError.message}`);
  }

  if (existing) {
    const calGoal = Number(existing.daily_calorie_goal ?? 2000);
    return {
      uid: existing.uid,
      username: existing.username,
      displayName: existing.display_name,
      dailyCalorieGoal: calGoal,
      proteinGoal: Number(existing.protein_goal ?? Math.round((calGoal * 0.3) / 4)),
      carbsGoal: Number(existing.carbs_goal ?? Math.round((calGoal * 0.45) / 4)),
      fatGoal: Number(existing.fat_goal ?? Math.round((calGoal * 0.25) / 9)),
      photoURL: existing.photo_url ?? undefined,
      provider: existing.provider === 'google.com' ? 'google.com' : 'password',
    };
  }

  let candidateUsername = buildSanitizedUsername(
    params.uid,
    params.preferredUsername,
    params.email,
    params.displayName
  );

  const { data: usernameTaken } = await supabase
    .from('profiles')
    .select('uid')
    .eq('username', candidateUsername)
    .maybeSingle();

  if (usernameTaken && usernameTaken.uid !== params.uid) {
    const suffix = `_${params.uid.slice(0, 5).toLowerCase()}`;
    candidateUsername = `${candidateUsername.slice(0, 24 - suffix.length)}${suffix}`;
  }

  const displayName = (params.displayName || candidateUsername).trim().slice(0, 80);
  const provider: 'google.com' | 'password' =
    params.provider === 'google.com' ? 'google.com' : 'password';

  console.log('Creating profile with:', {
    uid: params.uid,
    email: params.email,
    username: candidateUsername,
    displayName,
  });

  const { data: inserted, error: insertError } = await supabase
    .from('profiles')
    .upsert(
      {
        uid: params.uid,
        email: (params.email || '').trim().slice(0, 254),
        username: candidateUsername,
        display_name: displayName || candidateUsername,
        daily_calorie_goal: 2000,
        protein_goal: 150,
        carbs_goal: 225,
        fat_goal: 56,
        photo_url: params.photoURL ? params.photoURL.slice(0, 500) : null,
        provider,
      },
      { onConflict: 'uid' }
    )
    .select(
      'uid, username, display_name, daily_calorie_goal, protein_goal, carbs_goal, fat_goal, photo_url, provider'
    )
    .single();

  if (insertError || !inserted) {
    throw new Error(`Failed to save profile in Supabase: ${insertError?.message || 'Unknown error'}`);
  }

  return {
    uid: inserted.uid,
    username: inserted.username,
    displayName: inserted.display_name,
    dailyCalorieGoal: Number(inserted.daily_calorie_goal ?? 2000),
    proteinGoal: Number(inserted.protein_goal ?? 150),
    carbsGoal: Number(inserted.carbs_goal ?? 225),
    fatGoal: Number(inserted.fat_goal ?? 56),
    photoURL: inserted.photo_url ?? undefined,
    provider: inserted.provider === 'google.com' ? 'google.com' : 'password',
  };
}

export async function updateCalorieGoalInSupabase(uid: string, nextGoal: number): Promise<number> {
  const supabase = getSupabaseClient();
  const clamped = Math.min(10000, Math.max(800, Math.round(nextGoal)));
  const { error } = await supabase
    .from('profiles')
    .update({
      daily_calorie_goal: clamped,
      updated_at: new Date().toISOString(),
    })
    .eq('uid', uid);

  if (error) {
    throw new Error(`Failed to update daily calorie goal: ${error.message}`);
  }
  return clamped;
}

export async function updateNutritionGoalsInSupabase(
  uid: string,
  goals: {
    displayName?: string;
    dailyCalorieGoal: number;
    proteinGoal: number;
    carbsGoal: number;
    fatGoal: number;
  }
): Promise<{
  displayName?: string;
  dailyCalorieGoal: number;
  proteinGoal: number;
  carbsGoal: number;
  fatGoal: number;
}> {
  const supabase = getSupabaseClient();
  const dailyCalorieGoal = Math.min(10000, Math.max(800, Math.round(goals.dailyCalorieGoal)));
  const proteinGoal = Math.min(500, Math.max(20, Math.round(goals.proteinGoal)));
  const carbsGoal = Math.min(1000, Math.max(20, Math.round(goals.carbsGoal)));
  const fatGoal = Math.min(400, Math.max(10, Math.round(goals.fatGoal)));

  const updatePayload: Record<string, unknown> = {
    daily_calorie_goal: dailyCalorieGoal,
    protein_goal: proteinGoal,
    carbs_goal: carbsGoal,
    fat_goal: fatGoal,
    updated_at: new Date().toISOString(),
  };

  let sanitizedDisplayName: string | undefined;
  if (typeof goals.displayName === 'string' && goals.displayName.trim()) {
    sanitizedDisplayName = goals.displayName.trim().slice(0, 80);
    updatePayload.display_name = sanitizedDisplayName;
  }

  const { error } = await supabase
    .from('profiles')
    .update(updatePayload)
    .eq('uid', uid);

  if (error) {
    throw new Error(`Failed to update nutrition goals: ${error.message}`);
  }

  return {
    displayName: sanitizedDisplayName,
    dailyCalorieGoal,
    proteinGoal,
    carbsGoal,
    fatGoal,
  };
}

export async function listMealsInSupabase(
  userId: string,
  dateKey: string
): Promise<SupabaseMealRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('meals')
    .select(
      'id, user_id, date_key, meal_type, foods, portions, calories, protein, carbs, fat, confidence, source, sources, created_at, updated_at'
    )
    .eq('user_id', userId)
    .eq('date_key', dateKey)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load meals from Supabase: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    dateKey: row.date_key,
    mealType: row.meal_type as MealType,
    foods: Array.isArray(row.foods) ? row.foods : [],
    portions: String(row.portions ?? ''),
    calories: Number(row.calories ?? 0),
    protein: Number(row.protein ?? 0),
    carbs: Number(row.carbs ?? 0),
    fat: Number(row.fat ?? 0),
    confidence: Number(row.confidence ?? 0.9),
    source: row.source === 'image' ? 'image' : 'text',
    sources: Array.isArray(row.sources) ? row.sources : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createMealInSupabase(
  userId: string,
  meal: Omit<SupabaseMealRecord, 'userId' | 'createdAt' | 'updatedAt'>
): Promise<SupabaseMealRecord> {
  const supabase = getSupabaseClient();
  const foods = meal.foods
    .map((f) => f.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 20);
  if (foods.length === 0) {
    throw new Error('Meal must contain at least one food item.');
  }

  const nowIso = new Date().toISOString();
  const payload = {
    id: meal.id,
    user_id: userId,
    date_key: meal.dateKey,
    meal_type: meal.mealType,
    foods,
    portions: meal.portions.trim().slice(0, 500) || foods.join(', '),
    calories: Math.min(10000, Math.max(0, Math.round(meal.calories))),
    protein: Math.min(1000, Math.max(0, Math.round(meal.protein))),
    carbs: Math.min(1000, Math.max(0, Math.round(meal.carbs))),
    fat: Math.min(1000, Math.max(0, Math.round(meal.fat))),
    confidence: Math.min(1, Math.max(0, Number(meal.confidence.toFixed(2)))),
    source: meal.source === 'image' ? 'image' : 'text',
    sources: (meal.sources || [])
      .map((s) => s.trim().slice(0, 300))
      .filter((s) => s.startsWith('http'))
      .slice(0, 5),
    created_at: nowIso,
    updated_at: nowIso,
  };

  const { data, error } = await supabase
    .from('meals')
    .insert(payload)
    .select(
      'id, user_id, date_key, meal_type, foods, portions, calories, protein, carbs, fat, confidence, source, sources, created_at, updated_at'
    )
    .single();

  if (error || !data) {
    throw new Error(`Failed to save meal to Supabase: ${error?.message || 'Unknown error'}`);
  }

  return {
    id: data.id,
    userId: data.user_id,
    dateKey: data.date_key,
    mealType: data.meal_type as MealType,
    foods: Array.isArray(data.foods) ? data.foods : foods,
    portions: String(data.portions ?? ''),
    calories: Number(data.calories ?? 0),
    protein: Number(data.protein ?? 0),
    carbs: Number(data.carbs ?? 0),
    fat: Number(data.fat ?? 0),
    confidence: Number(data.confidence ?? 0.9),
    source: data.source === 'image' ? 'image' : 'text',
    sources: Array.isArray(data.sources) ? data.sources : [],
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function updateMealInSupabase(
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
): Promise<void> {
  const supabase = getSupabaseClient();
  const foods = updates.foods
    .map((f) => f.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 20);
  if (foods.length === 0) {
    throw new Error('Meal must include at least one food item.');
  }

  const { error } = await supabase
    .from('meals')
    .update({
      meal_type: updates.mealType,
      foods,
      portions: updates.portions.trim().slice(0, 500) || foods.join(', '),
      calories: Math.min(10000, Math.max(0, Math.round(updates.calories))),
      protein: Math.min(1000, Math.max(0, Math.round(updates.protein))),
      carbs: Math.min(1000, Math.max(0, Math.round(updates.carbs))),
      fat: Math.min(1000, Math.max(0, Math.round(updates.fat))),
      updated_at: new Date().toISOString(),
    })
    .eq('id', mealId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to update meal in Supabase: ${error.message}`);
  }
}

export async function deleteMealInSupabase(userId: string, mealId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('meals')
    .delete()
    .eq('id', mealId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to delete meal from Supabase: ${error.message}`);
  }
}

export async function listChatMessagesInSupabase(
  userId: string,
  dateKey: string
): Promise<SupabaseChatMessageRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('chat_messages')
    .select(
      'id, user_id, date_key, role, content, meal_id, confidence, clarification_options, sources, nutrition_snapshot, has_image, created_at'
    )
    .eq('user_id', userId)
    .eq('date_key', dateKey)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load chat history from Supabase: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    dateKey: row.date_key,
    role: row.role === 'user' ? 'user' : 'assistant',
    content: row.content,
    mealId: row.meal_id ?? undefined,
    confidence: typeof row.confidence === 'number' ? row.confidence : undefined,
    clarificationOptions: Array.isArray(row.clarification_options)
      ? row.clarification_options
      : undefined,
    sources: Array.isArray(row.sources) ? row.sources : undefined,
    nutritionSnapshot:
      row.nutrition_snapshot && typeof row.nutrition_snapshot === 'object'
        ? (row.nutrition_snapshot as NutritionTotals)
        : undefined,
    hasImage: Boolean(row.has_image),
    timestamp: row.created_at,
  }));
}

export async function saveChatMessageInSupabase(
  userId: string,
  msg: Omit<SupabaseChatMessageRecord, 'userId' | 'timestamp'>
): Promise<SupabaseChatMessageRecord> {
  const supabase = getSupabaseClient();
  const nowIso = new Date().toISOString();
  const payload = {
    id: msg.id,
    user_id: userId,
    date_key: msg.dateKey,
    role: msg.role,
    content: msg.content.trim().slice(0, 4000) || '...',
    meal_id: msg.mealId || null,
    confidence:
      typeof msg.confidence === 'number'
        ? Math.min(1, Math.max(0, Number(msg.confidence.toFixed(2))))
        : null,
    clarification_options:
      msg.clarificationOptions && msg.clarificationOptions.length > 0
        ? msg.clarificationOptions
          .map((opt) => opt.trim().slice(0, 80))
          .filter(Boolean)
          .slice(0, 6)
        : null,
    sources:
      msg.sources && msg.sources.length > 0
        ? msg.sources
          .map((s) => s.trim().slice(0, 300))
          .filter((s) => s.startsWith('http'))
          .slice(0, 5)
        : null,
    nutrition_snapshot: msg.nutritionSnapshot
      ? {
        calories: Math.min(10000, Math.max(0, Math.round(msg.nutritionSnapshot.calories))),
        protein: Math.min(1000, Math.max(0, Math.round(msg.nutritionSnapshot.protein))),
        carbs: Math.min(1000, Math.max(0, Math.round(msg.nutritionSnapshot.carbs))),
        fat: Math.min(1000, Math.max(0, Math.round(msg.nutritionSnapshot.fat))),
      }
      : null,
    has_image: Boolean(msg.hasImage),
    created_at: nowIso,
  };

  const { data, error } = await supabase
    .from('chat_messages')
    .insert(payload)
    .select(
      'id, user_id, date_key, role, content, meal_id, confidence, clarification_options, sources, nutrition_snapshot, has_image, created_at'
    )
    .single();

  if (error || !data) {
    throw new Error(`Failed to save chat message to Supabase: ${error?.message || 'Unknown error'}`);
  }

  return {
    id: data.id,
    userId: data.user_id,
    dateKey: data.date_key,
    role: data.role === 'user' ? 'user' : 'assistant',
    content: data.content,
    mealId: data.meal_id ?? undefined,
    confidence: typeof data.confidence === 'number' ? data.confidence : undefined,
    clarificationOptions: Array.isArray(data.clarification_options)
      ? data.clarification_options
      : undefined,
    sources: Array.isArray(data.sources) ? data.sources : undefined,
    nutritionSnapshot:
      data.nutrition_snapshot && typeof data.nutrition_snapshot === 'object'
        ? (data.nutrition_snapshot as NutritionTotals)
        : undefined,
    hasImage: Boolean(data.has_image),
    timestamp: data.created_at,
  };
}

export async function clearChatMessagesInSupabase(
  userId: string,
  dateKey: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('chat_messages')
    .delete()
    .eq('user_id', userId)
    .eq('date_key', dateKey);

  if (error) {
    throw new Error(`Failed to clear chat history in Supabase: ${error.message}`);
  }
}

export async function getSevenDayCaloriesInSupabase(
  userId: string,
  dateKeys: string[]
): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (const key of dateKeys) {
    totals[key] = 0;
  }
  if (dateKeys.length === 0) {
    return totals;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('meals')
    .select('date_key, calories')
    .eq('user_id', userId)
    .in('date_key', dateKeys);

  if (error) {
    throw new Error(`Failed to load 7-day calorie history from Supabase: ${error.message}`);
  }

  for (const row of data || []) {
    const key = String(row.date_key || '');
    if (key in totals) {
      totals[key] += Number(row.calories ?? 0);
    }
  }

  return totals;
}

export async function listMealsRangeInSupabase(
  userId: string,
  startDateKey: string,
  endDateKey: string
): Promise<SupabaseMealRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('meals')
    .select(
      'id, user_id, date_key, meal_type, foods, portions, calories, protein, carbs, fat, confidence, source, sources, created_at, updated_at'
    )
    .eq('user_id', userId)
    .gte('date_key', startDateKey)
    .lte('date_key', endDateKey)
    .order('date_key', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load meals range from Supabase: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    dateKey: row.date_key,
    mealType: row.meal_type as MealType,
    foods: Array.isArray(row.foods) ? row.foods : [],
    portions: String(row.portions ?? ''),
    calories: Number(row.calories ?? 0),
    protein: Number(row.protein ?? 0),
    carbs: Number(row.carbs ?? 0),
    fat: Number(row.fat ?? 0),
    confidence: Number(row.confidence ?? 0.9),
    source: row.source === 'image' ? 'image' : 'text',
    sources: Array.isArray(row.sources) ? row.sources : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export interface ProfileExistenceCheckResult {
  checked: boolean;
  exists: boolean;
  emailExists: boolean;
  usernameExists: boolean;
}

function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export async function checkProfileExistsInSupabase(params: {
  identifier?: string;
  email?: string;
  username?: string;
}): Promise<ProfileExistenceCheckResult> {
  const supabase = getSupabaseClient();
  const rawIdentifier = typeof params.identifier === 'string' ? params.identifier.trim() : '';
  const rawEmail =
    typeof params.email === 'string' && params.email.trim()
      ? params.email.trim()
      : rawIdentifier.includes('@')
        ? rawIdentifier
        : '';
  const rawUsername =
    typeof params.username === 'string' && params.username.trim()
      ? params.username.trim()
      : rawIdentifier && !rawIdentifier.includes('@')
        ? rawIdentifier
        : '';

  let emailExists = false;
  let usernameExists = false;

  if (rawEmail) {
    const cleanEmail = rawEmail.toLowerCase().slice(0, 254);
    const { data, error } = await supabase
      .from('profiles')
      .select('uid')
      .ilike('email', escapeIlikePattern(cleanEmail))
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to check profile email in Supabase: ${error.message}`);
    }
    emailExists = Boolean(data?.uid);
  }

  if (rawUsername) {
    const cleanUsername = rawUsername.toLowerCase().slice(0, 24);
    const { data, error } = await supabase
      .from('profiles')
      .select('uid')
      .eq('username', cleanUsername)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to check profile username in Supabase: ${error.message}`);
    }
    usernameExists = Boolean(data?.uid);
  }

  return {
    checked: true,
    exists: emailExists || usernameExists,
    emailExists,
    usernameExists,
  };
}

