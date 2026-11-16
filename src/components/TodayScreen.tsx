import { useEffect, useMemo, useState } from 'react';
import { sendEmailVerification, signOut, type User } from 'firebase/auth';
import { LogOut, MailCheck, RefreshCw } from 'lucide-react';
import { auth } from '../firebase';
import {
  DEFAULT_DAILY_CALORIE_GOAL,
  updateDailyCalorieGoal,
  type UserProfileRecord,
} from '../lib/profileService';
import {
  callAnalyzeImageApi,
  callChatMealApi,
  clearChatMessagesInFirestore,
  createMealEntryInFirestore,
  deleteMealEntryInFirestore,
  fetchTodayChatFromSupabase,
  fetchTodayMealsFromSupabase,
  generateRecordId,
  getTodayDateKey,
  saveChatMessageInFirestore,
  subscribeToTodayChat,
  subscribeToTodayMeals,
  syncSummaryWithBackend,
  updateMealEntryInFirestore,
} from '../lib/nutritionRepository';
import { getStorageProvider, type StorageProvider } from '../lib/storageBackend';
import type {
  ChatMessageItem,
  MealEntry,
  MealType,
  NutritionAnalysisResponse,
  NutritionTotals,
} from '../types/nutrition';
import { DailySummaryCard } from './DailySummaryCard';
import { MealHistoryList } from './MealHistoryList';
import { NutritionChatPanel } from './NutritionChatPanel';

interface TodayScreenProps {
  user: User;
  profile: UserProfileRecord | null;
  onProfileUpdated: (profile: UserProfileRecord) => void;
  onVerificationRefreshed: () => Promise<void>;
}

export function TodayScreen({
  user,
  profile,
  onProfileUpdated,
  onVerificationRefreshed,
}: TodayScreenProps) {
  const dateKey = getTodayDateKey();
  const [meals, setMeals] = useState<MealEntry[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>([]);
  const [localCalorieGoal, setLocalCalorieGoal] = useState(DEFAULT_DAILY_CALORIE_GOAL);
  const [isSendingAi, setIsSendingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [isRefreshingVerification, setIsRefreshingVerification] = useState(false);
  const [verificationFeedback, setVerificationFeedback] = useState<string | null>(null);

  const [storageProvider, setStorageProvider] = useState<StorageProvider>('firestore');

  const dailyCalorieGoal = profile?.dailyCalorieGoal ?? localCalorieGoal;

  // Subscribe to Firestore or fetch initial Supabase state when user email is verified
  useEffect(() => {
    if (!user.emailVerified) {
      return;
    }

    let cancelled = false;
    let unsubMeals: (() => void) | undefined;
    let unsubChat: (() => void) | undefined;

    getStorageProvider().then(async (provider) => {
      if (cancelled) return;
      setStorageProvider(provider);

      if (provider === 'supabase') {
        try {
          const [loadedMeals, loadedChat] = await Promise.all([
            fetchTodayMealsFromSupabase(user, dateKey),
            fetchTodayChatFromSupabase(user, dateKey),
          ]);
          if (!cancelled) {
            setMeals(loadedMeals);
            setChatMessages(loadedChat);
          }
        } catch (error) {
          if (!cancelled) {
            setAiError(
              error instanceof Error ? error.message : 'Unable to load today nutrition data.'
            );
          }
        }
        return;
      }

      unsubMeals = subscribeToTodayMeals(user.uid, dateKey, (nextMeals) => {
        setMeals(nextMeals);
      });

      unsubChat = subscribeToTodayChat(user.uid, dateKey, (nextMessages) => {
        setChatMessages(nextMessages);
      });
    });

    return () => {
      cancelled = true;
      unsubMeals?.();
      unsubChat?.();
    };
  }, [user, user.uid, user.emailVerified, dateKey]);

  const dailyTotals: NutritionTotals = useMemo(() => {
    return meals.reduce<NutritionTotals>(
      (acc, meal) => ({
        calories: acc.calories + (Number(meal.calories) || 0),
        protein: acc.protein + (Number(meal.protein) || 0),
        carbs: acc.carbs + (Number(meal.carbs) || 0),
        fat: acc.fat + (Number(meal.fat) || 0),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );
  }, [meals]);

  // Keep server GET /today-summary synchronized whenever meals or goal change
  useEffect(() => {
    syncSummaryWithBackend(user, dailyTotals, dailyCalorieGoal, dateKey);
  }, [user, dailyTotals, dailyCalorieGoal, dateKey]);

  async function persistAnalysisOutcome(
    analysis: NutritionAnalysisResponse
  ): Promise<string | undefined> {
    let loggedMealId: string | undefined;

    if (analysis.meal_logged) {
      loggedMealId = generateRecordId('meal');
      const newMeal: MealEntry = {
        id: loggedMealId,
        userId: user.uid,
        dateKey,
        mealType: analysis.meal_type,
        foods: analysis.foods,
        portions: analysis.portions,
        calories: analysis.nutrition.calories,
        protein: analysis.nutrition.protein,
        carbs: analysis.nutrition.carbs,
        fat: analysis.nutrition.fat,
        confidence: analysis.confidence,
        source: analysis.source,
        sources: analysis.sources,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (user.emailVerified) {
        if (storageProvider === 'supabase') {
          setMeals((prev) => [...prev, newMeal]);
        }
        await createMealEntryInFirestore(user, newMeal);
      } else {
        setMeals((prev) => [...prev, newMeal]);
      }
    }

    const assistantMsg: ChatMessageItem = {
      id: generateRecordId('msg'),
      userId: user.uid,
      dateKey,
      role: 'assistant',
      content: analysis.reply,
      mealId: loggedMealId,
      confidence: analysis.confidence,
      clarificationOptions: analysis.clarification_options,
      sources: analysis.sources,
      nutritionSnapshot: analysis.meal_logged ? analysis.nutrition : undefined,
      timestamp: new Date(),
    };

    if (user.emailVerified) {
      if (storageProvider === 'supabase') {
        setChatMessages((prev) => [...prev, assistantMsg]);
      }
      await saveChatMessageInFirestore(user, assistantMsg);
    } else {
      setChatMessages((prev) => [...prev, assistantMsg]);
    }

    return loggedMealId;
  }

  async function handleSendText(text: string) {
    setAiError(null);
    const historySnapshot = chatMessages.slice(-6).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const userMsg: ChatMessageItem = {
      id: generateRecordId('msg'),
      userId: user.uid,
      dateKey,
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    if (user.emailVerified) {
      if (storageProvider === 'supabase') {
        setChatMessages((prev) => [...prev, userMsg]);
      }
      await saveChatMessageInFirestore(user, userMsg);
    } else {
      setChatMessages((prev) => [...prev, userMsg]);
    }

    setIsSendingAi(true);
    try {
      const analysis = await callChatMealApi(user, {
        message: text,
        history: historySnapshot,
        dateKey,
      });
      await persistAnalysisOutcome(analysis);
    } catch (error) {
      setAiError(
        error instanceof Error ? error.message : 'Unable to analyze meal right now.'
      );
    } finally {
      setIsSendingAi(false);
    }
  }

  async function handleSendImage(file: File, previewDataUrl: string, caption?: string) {
    setAiError(null);
    const historySnapshot = chatMessages.slice(-6).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const userMsg: ChatMessageItem = {
      id: generateRecordId('msg'),
      userId: user.uid,
      dateKey,
      role: 'user',
      content: caption ? caption : 'Uploaded a food photo for analysis.',
      hasImage: true,
      localImagePreview: previewDataUrl,
      timestamp: new Date(),
    };

    if (user.emailVerified) {
      if (storageProvider === 'supabase') {
        setChatMessages((prev) => [...prev, userMsg]);
      }
      await saveChatMessageInFirestore(user, userMsg);
    } else {
      setChatMessages((prev) => [...prev, userMsg]);
    }

    setIsSendingAi(true);
    try {
      const analysis = await callAnalyzeImageApi(user, {
        imageFile: file,
        caption,
        history: historySnapshot,
        dateKey,
      });
      await persistAnalysisOutcome(analysis);
    } catch (error) {
      setAiError(
        error instanceof Error ? error.message : 'Unable to analyze this food photo.'
      );
    } finally {
      setIsSendingAi(false);
    }
  }

  async function handleUpdateMeal(
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
  ) {
    const previousMeals = meals;
    setMeals((prev) =>
      prev.map((m) => (m.id === mealId ? { ...m, ...updates, updatedAt: new Date() } : m))
    );

    if (user.emailVerified) {
      try {
        await updateMealEntryInFirestore(user, mealId, updates);
      } catch (error) {
        setMeals(previousMeals);
        throw error;
      }
    }
  }

  async function handleDeleteMeal(mealId: string) {
    const previousMeals = meals;
    setMeals((prev) => prev.filter((m) => m.id !== mealId));

    if (user.emailVerified) {
      try {
        await deleteMealEntryInFirestore(user, mealId);
      } catch (error) {
        setMeals(previousMeals);
        throw error;
      }
    }
  }

  async function handleUpdateGoal(nextGoal: number) {
    if (user.emailVerified) {
      const saved = await updateDailyCalorieGoal(user, nextGoal);
      if (profile) {
        onProfileUpdated({ ...profile, dailyCalorieGoal: saved });
      }
    } else {
      setLocalCalorieGoal(nextGoal);
    }
  }

  async function handleClearChat() {
    if (user.emailVerified) {
      if (storageProvider === 'supabase') {
        setChatMessages([]);
      }
      await clearChatMessagesInFirestore(
        user,
        chatMessages.map((m) => m.id),
        dateKey
      );
    } else {
      setChatMessages([]);
    }
  }

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await signOut(auth);
    } finally {
      setIsSigningOut(false);
    }
  }

  async function handleResendVerification() {
    setVerificationFeedback(null);
    setIsSendingVerification(true);
    try {
      await sendEmailVerification(user);
      setVerificationFeedback(`Verification link sent to ${user.email}.`);
    } catch (error) {
      setVerificationFeedback(
        error instanceof Error ? error.message : 'Could not send verification email.'
      );
    } finally {
      setIsSendingVerification(false);
    }
  }

  async function handleRefreshVerification() {
    setIsRefreshingVerification(true);
    try {
      await onVerificationRefreshed();
    } finally {
      setIsRefreshingVerification(false);
    }
  }

  const todayFormatted = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="sticky top-0 z-30 h-14 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-3 min-w-0">
            <h1 className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
              Today
            </h1>
            <span className="hidden sm:inline text-xs text-slate-500 whitespace-nowrap shrink-0">
              AI Nutrition Tracker · {todayFormatted}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden md:inline text-xs text-slate-600 truncate max-w-[180px]">
              {profile?.displayName || user.displayName || user.email}
            </span>
            <button
              type="button"
              disabled={isSigningOut}
              onClick={handleSignOut}
              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-6 space-y-5">
        {!user.emailVerified && (
          <div
            role="status"
            className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm"
          >
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 font-medium text-amber-950">
                <MailCheck className="h-4 w-4 text-amber-700 shrink-0" aria-hidden="true" />
                <span>Verify your email to persist meals across devices</span>
              </div>
              <p className="text-xs text-amber-900">
                {verificationFeedback ||
                  `You can chat and log meals now; verify ${user.email} to sync history to cloud storage.`}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={isSendingVerification}
                onClick={handleResendVerification}
                className="min-h-[38px] px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-xs font-medium text-amber-950 hover:bg-amber-100/60 whitespace-nowrap"
              >
                {isSendingVerification ? 'Sending...' : 'Resend link'}
              </button>
              <button
                type="button"
                disabled={isRefreshingVerification}
                onClick={handleRefreshVerification}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isRefreshingVerification ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>Refresh</span>
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 space-y-6">
            <DailySummaryCard
              totals={dailyTotals}
              dailyCalorieGoal={dailyCalorieGoal}
              mealCount={meals.length}
              onUpdateCalorieGoal={handleUpdateGoal}
            />
            <MealHistoryList
              meals={meals}
              onUpdateMeal={handleUpdateMeal}
              onDeleteMeal={handleDeleteMeal}
            />
          </div>

          <div className="lg:col-span-5">
            <NutritionChatPanel
              messages={chatMessages}
              isSending={isSendingAi}
              errorMessage={aiError}
              onSendText={handleSendText}
              onSendImage={handleSendImage}
              onClearChat={handleClearChat}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
