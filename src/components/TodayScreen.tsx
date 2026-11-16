import { useCallback, useEffect, useMemo, useState } from 'react';
import { sendEmailVerification, signOut, type User } from 'firebase/auth';
import {
  BarChart3,
  CalendarDays,
  LogOut,
  MailCheck,
  RefreshCw,
  UserCircle2,
} from 'lucide-react';
import { auth } from '../firebase';
import {
  DEFAULT_DAILY_CALORIE_GOAL,
  deriveDefaultMacroGoals,
  updateDailyCalorieGoal,
  type UserProfileRecord,
} from '../lib/profileService';
import {
  callAnalyzeImageApi,
  callChatMealApi,
  clearChatMessagesInFirestore,
  createMealEntryInFirestore,
  deleteMealEntryInFirestore,
  fetchSevenDayCalorieHistory,
  fetchTodayChatFromSupabase,
  fetchTodayMealsFromSupabase,
  generateRecordId,
  getLast7DaysMeta,
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
  DailyCaloriePoint,
  MealEntry,
  MealType,
  NutritionAnalysisResponse,
  NutritionTotals,
} from '../types/nutrition';
import { CalorieTrendChart } from './CalorieTrendChart';
import { DailySummaryCard } from './DailySummaryCard';
import { MealHistoryList } from './MealHistoryList';
import { NutritionChatPanel } from './NutritionChatPanel';
import { ProfilePage } from './ProfilePage';
import { SummaryPage } from './SummaryPage';

type AppTab = 'today' | 'summary' | 'profile';

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
  const [activeTab, setActiveTab] = useState<AppTab>('today');
  const [meals, setMeals] = useState<MealEntry[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>([]);
  const [localGoals, setLocalGoals] = useState(() => ({
    dailyCalorieGoal: DEFAULT_DAILY_CALORIE_GOAL,
    ...deriveDefaultMacroGoals(DEFAULT_DAILY_CALORIE_GOAL),
  }));
  const [isSendingAi, setIsSendingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [isRefreshingVerification, setIsRefreshingVerification] = useState(false);
  const [verificationFeedback, setVerificationFeedback] = useState<string | null>(null);

  const [storageProvider, setStorageProvider] = useState<StorageProvider>('firestore');
  const [historyTotalsByDate, setHistoryTotalsByDate] = useState<Record<string, number>>({});
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const last7DaysMeta = useMemo(() => getLast7DaysMeta(), [dateKey]);
  const last7DateKeys = useMemo(
    () => last7DaysMeta.map((d) => d.dateKey),
    [last7DaysMeta]
  );

  const dailyCalorieGoal = profile?.dailyCalorieGoal ?? localGoals.dailyCalorieGoal;
  const fallbackMacros = deriveDefaultMacroGoals(dailyCalorieGoal);
  const proteinGoal = profile?.proteinGoal ?? localGoals.proteinGoal ?? fallbackMacros.proteinGoal;
  const carbsGoal = profile?.carbsGoal ?? localGoals.carbsGoal ?? fallbackMacros.carbsGoal;
  const fatGoal = profile?.fatGoal ?? localGoals.fatGoal ?? fallbackMacros.fatGoal;

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

  const loadSevenDayHistory = useCallback(async () => {
    if (!user.emailVerified) {
      setHistoryTotalsByDate({});
      setHistoryError(null);
      setIsHistoryLoading(false);
      return;
    }

    setIsHistoryLoading(true);
    setHistoryError(null);
    try {
      const totals = await fetchSevenDayCalorieHistory(user, last7DateKeys);
      setHistoryTotalsByDate(totals);
    } catch (error) {
      setHistoryError(
        error instanceof Error
          ? error.message
          : 'Unable to load 7-day calorie trend.'
      );
    } finally {
      setIsHistoryLoading(false);
    }
  }, [user, last7DateKeys]);

  useEffect(() => {
    void loadSevenDayHistory();
  }, [loadSevenDayHistory]);

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

  const sevenDayPoints: DailyCaloriePoint[] = useMemo(() => {
    return last7DaysMeta.map((day) => ({
      dateKey: day.dateKey,
      shortLabel: day.shortLabel,
      fullLabel: day.fullLabel,
      calories: day.isToday
        ? dailyTotals.calories
        : Math.max(0, Math.round(historyTotalsByDate[day.dateKey] ?? 0)),
      isToday: day.isToday,
    }));
  }, [last7DaysMeta, historyTotalsByDate, dailyTotals.calories]);

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
      setLocalGoals((prev) => ({ ...prev, dailyCalorieGoal: nextGoal }));
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

  const navItems: Array<{ id: AppTab; label: string; icon: typeof CalendarDays }> = [
    { id: 'today', label: 'Today', icon: CalendarDays },
    { id: 'summary', label: 'Summary', icon: BarChart3 },
    { id: 'profile', label: 'Profile', icon: UserCircle2 },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="sticky top-0 z-30 h-12 sm:h-14 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-8">
          <h1 className="font-display text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            AI Nutrition Tracker
          </h1>

          <nav aria-label="Primary navigation" className="hidden sm:flex items-center gap-6">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`min-h-[40px] px-1 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 ${
                    isActive
                      ? 'border-emerald-700 text-emerald-800'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
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

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 pt-5 pb-20 sm:py-6 space-y-5">
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

        {activeTab === 'today' && (
          <>
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-display text-xl font-semibold text-slate-900">Today</h2>
              <span className="text-xs text-slate-500">{todayFormatted}</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-7 space-y-6">
                <DailySummaryCard
                  totals={dailyTotals}
                  dailyCalorieGoal={dailyCalorieGoal}
                  proteinGoal={proteinGoal}
                  carbsGoal={carbsGoal}
                  fatGoal={fatGoal}
                  mealCount={meals.length}
                  onUpdateCalorieGoal={handleUpdateGoal}
                />
                <CalorieTrendChart
                  points={sevenDayPoints}
                  dailyCalorieGoal={dailyCalorieGoal}
                  isLoading={isHistoryLoading}
                  errorMessage={historyError}
                  onRetry={() => void loadSevenDayHistory()}
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
          </>
        )}

        {activeTab === 'summary' && (
          <SummaryPage
            user={user}
            todayMeals={meals}
            dailyCalorieGoal={dailyCalorieGoal}
            proteinGoal={proteinGoal}
            carbsGoal={carbsGoal}
            fatGoal={fatGoal}
          />
        )}

        {activeTab === 'profile' && (
          <ProfilePage
            user={user}
            profile={profile}
            localGoals={localGoals}
            onProfileUpdated={onProfileUpdated}
            onLocalGoalsUpdated={setLocalGoals}
          />
        )}
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav
        aria-label="Mobile navigation"
        className="sm:hidden fixed bottom-0 left-0 right-0 z-30 h-14 border-t border-slate-200 bg-white/95 backdrop-blur-md grid grid-cols-3 items-center"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                isActive ? 'text-emerald-800' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
