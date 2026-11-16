import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import {
  fetchMealsInDateRange,
  formatDateKey,
  getTodayDateKey,
} from '../lib/nutritionRepository';
import type { MealEntry, MealType, NutritionTotals } from '../types/nutrition';

type SummaryPeriod = 'day' | 'week' | 'month';

interface SummaryPageProps {
  user: User;
  todayMeals: MealEntry[];
  dailyCalorieGoal: number;
  proteinGoal: number;
  carbsGoal: number;
  fatGoal: number;
}

const MEAL_TYPE_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
};

function addDays(base: Date, delta: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta);
}

function sumNutrition(items: MealEntry[]): NutritionTotals {
  return items.reduce<NutritionTotals>(
    (acc, item) => ({
      calories: acc.calories + (Number(item.calories) || 0),
      protein: acc.protein + (Number(item.protein) || 0),
      carbs: acc.carbs + (Number(item.carbs) || 0),
      fat: acc.fat + (Number(item.fat) || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

interface DayBucket {
  dateKey: string;
  shortLabel: string;
  fullLabel: string;
  meals: MealEntry[];
  totals: NutritionTotals;
}

export function SummaryPage({
  user,
  todayMeals,
  dailyCalorieGoal,
  proteinGoal,
  carbsGoal,
  fatGoal,
}: SummaryPageProps) {
  const [period, setPeriod] = useState<SummaryPeriod>('day');
  const [dayOffset, setDayOffset] = useState(0); // 0 = today, -1 = yesterday
  const [weekOffset, setWeekOffset] = useState(0); // 0 = last 7 days ending today
  const [monthOffset, setMonthOffset] = useState(0); // 0 = current calendar month

  const [rangeMeals, setRangeMeals] = useState<MealEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hoveredDayKey, setHoveredDayKey] = useState<string | null>(null);

  const todayKey = getTodayDateKey();

  const { startDateKey, endDateKey, rangeLabel, dayMetas } = useMemo(() => {
    const now = new Date();
    const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (period === 'day') {
      const target = addDays(todayDate, dayOffset);
      const key = formatDateKey(target);
      const label =
        dayOffset === 0
          ? `Today · ${target.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
          : target.toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            });
      return {
        startDateKey: key,
        endDateKey: key,
        rangeLabel: label,
        dayMetas: [
          {
            dateKey: key,
            shortLabel: dayOffset === 0 ? 'Today' : target.toLocaleDateString(undefined, { weekday: 'short' }),
            fullLabel: target.toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            }),
          },
        ],
      };
    }

    if (period === 'week') {
      const end = addDays(todayDate, weekOffset * 7);
      const start = addDays(end, -6);
      const metas = [];
      for (let i = 0; i < 7; i += 1) {
        const d = addDays(start, i);
        const k = formatDateKey(d);
        metas.push({
          dateKey: k,
          shortLabel:
            k === todayKey
              ? 'Today'
              : d.toLocaleDateString(undefined, { weekday: 'short' }),
          fullLabel: d.toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          }),
        });
      }
      const startLabel = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const endLabel = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      return {
        startDateKey: formatDateKey(start),
        endDateKey: formatDateKey(end),
        rangeLabel: `${startLabel} – ${endLabel}`,
        dayMetas: metas,
      };
    }

    // Month period
    const targetMonthDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const year = targetMonthDate.getFullYear();
    const month = targetMonthDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const metas = [];
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum += 1) {
      const d = new Date(year, month, dayNum);
      metas.push({
        dateKey: formatDateKey(d),
        shortLabel: String(dayNum),
        fullLabel: d.toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        }),
      });
    }
    return {
      startDateKey: metas[0].dateKey,
      endDateKey: metas[metas.length - 1].dateKey,
      rangeLabel: targetMonthDate.toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      }),
      dayMetas: metas,
    };
  }, [period, dayOffset, weekOffset, monthOffset, todayKey]);

  const loadRange = useCallback(async () => {
    setHoveredDayKey(null);
    if (!user.emailVerified) {
      setRangeMeals(todayMeals.filter((m) => m.dateKey >= startDateKey && m.dateKey <= endDateKey));
      setErrorMessage(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const fetched = await fetchMealsInDateRange(user, startDateKey, endDateKey);
      setRangeMeals(fetched);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to load nutrition summary.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [user, startDateKey, endDateKey, todayMeals]);

  useEffect(() => {
    void loadRange();
  }, [loadRange]);

  // Keep today's entries synchronized immediately with live Today meals state
  const effectiveMeals = useMemo(() => {
    const includesToday = todayKey >= startDateKey && todayKey <= endDateKey;
    if (!includesToday) {
      return rangeMeals;
    }
    const nonToday = rangeMeals.filter((m) => m.dateKey !== todayKey);
    return [...nonToday, ...todayMeals];
  }, [rangeMeals, todayMeals, startDateKey, endDateKey, todayKey]);

  const dayBuckets: DayBucket[] = useMemo(() => {
    const byDate = new Map<string, MealEntry[]>();
    for (const meal of effectiveMeals) {
      const existing = byDate.get(meal.dateKey) || [];
      existing.push(meal);
      byDate.set(meal.dateKey, existing);
    }
    return dayMetas.map((meta) => {
      const dayMeals = byDate.get(meta.dateKey) || [];
      return {
        ...meta,
        meals: dayMeals,
        totals: sumNutrition(dayMeals),
      };
    });
  }, [dayMetas, effectiveMeals]);

  const periodTotals = useMemo(() => sumNutrition(effectiveMeals), [effectiveMeals]);
  const loggedDays = useMemo(
    () => dayBuckets.filter((b) => b.meals.length > 0),
    [dayBuckets]
  );
  const daysOnTarget = useMemo(
    () => loggedDays.filter((b) => b.totals.calories <= dailyCalorieGoal).length,
    [loggedDays, dailyCalorieGoal]
  );

  const avgDailyCalories =
    loggedDays.length > 0 ? Math.round(periodTotals.calories / loggedDays.length) : 0;
  const avgProtein =
    loggedDays.length > 0 ? Math.round(periodTotals.protein / loggedDays.length) : 0;
  const avgCarbs =
    loggedDays.length > 0 ? Math.round(periodTotals.carbs / loggedDays.length) : 0;
  const avgFat =
    loggedDays.length > 0 ? Math.round(periodTotals.fat / loggedDays.length) : 0;

  function stepRange(direction: -1 | 1) {
    if (period === 'day') {
      setDayOffset((prev) => Math.min(0, prev + direction));
    } else if (period === 'week') {
      setWeekOffset((prev) => Math.min(0, prev + direction));
    } else {
      setMonthOffset((prev) => Math.min(0, prev + direction));
    }
  }

  const canStepForward =
    (period === 'day' && dayOffset < 0) ||
    (period === 'week' && weekOffset < 0) ||
    (period === 'month' && monthOffset < 0);

  // Macro calorie energy breakdown for Day view
  const macroCaloriesTotal =
    periodTotals.protein * 4 + periodTotals.carbs * 4 + periodTotals.fat * 9;
  const proteinEnergyPct =
    macroCaloriesTotal > 0 ? Math.round(((periodTotals.protein * 4) / macroCaloriesTotal) * 100) : 0;
  const carbsEnergyPct =
    macroCaloriesTotal > 0 ? Math.round(((periodTotals.carbs * 4) / macroCaloriesTotal) * 100) : 0;
  const fatEnergyPct =
    macroCaloriesTotal > 0 ? Math.max(0, 100 - proteinEnergyPct - carbsEnergyPct) : 0;

  // Weekly rollups for Month view
  const monthlyWeeks = useMemo(() => {
    if (period !== 'month') return [];
    const chunks: Array<{
      label: string;
      activeDays: number;
      totals: NutritionTotals;
    }> = [];
    for (let i = 0; i < dayBuckets.length; i += 7) {
      const slice = dayBuckets.slice(i, i + 7);
      const active = slice.filter((d) => d.meals.length > 0);
      const sliceMeals = slice.flatMap((d) => d.meals);
      const first = slice[0];
      const last = slice[slice.length - 1];
      chunks.push({
        label: `Days ${first.shortLabel}–${last.shortLabel}`,
        activeDays: active.length,
        totals: sumNutrition(sliceMeals),
      });
    }
    return chunks;
  }, [period, dayBuckets]);

  // SVG chart metrics for Week & Month views
  const chartMaxCalories = useMemo(() => {
    const maxDay = dayBuckets.reduce((m, b) => Math.max(m, b.totals.calories), 0);
    return Math.ceil(Math.max(dailyCalorieGoal * 1.15, maxDay * 1.15, 1000) / 500) * 500;
  }, [dayBuckets, dailyCalorieGoal]);

  const inspectedBucket =
    dayBuckets.find((b) => b.dateKey === hoveredDayKey) ??
    dayBuckets.find((b) => b.dateKey === todayKey) ??
    dayBuckets[dayBuckets.length - 1];

  return (
    <div className="space-y-6">
      {/* Period Switcher & Date Navigation */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-slate-900">
              Nutrition Summary
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Compare calories and macronutrients across day, week, and month windows
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Summary period"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl self-start sm:self-auto"
          >
            {(['day', 'week', 'month'] as SummaryPeriod[]).map((tab) => {
              const isActive = period === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setPeriod(tab)}
                  className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => stepRange(-1)}
            aria-label={`Previous ${period}`}
            className="min-h-[40px] px-3 py-1.5 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            <span>Previous</span>
          </button>

          <p className="text-sm font-medium text-slate-900 text-center tabular-nums">
            {rangeLabel}
          </p>

          <button
            type="button"
            disabled={!canStepForward}
            onClick={() => stepRange(1)}
            aria-label={`Next ${period}`}
            className="min-h-[40px] px-3 py-1.5 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
          >
            <span>Next</span>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </section>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadRange()}
            className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 whitespace-nowrap shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-busy="true">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="h-28 rounded-2xl border border-slate-200 bg-white p-5 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <>
          {/* KPI Summary Strip */}
          <section
            aria-label="Period Totals"
            className="grid grid-cols-2 lg:grid-cols-4 gap-4"
          >
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-1">
              <p className="text-xs font-medium text-slate-500">
                {period === 'day' ? 'Calories Consumed' : 'Total Calories'}
              </p>
              <p className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                {periodTotals.calories.toLocaleString()}
                <span className="text-xs font-normal text-slate-500 ml-1">kcal</span>
              </p>
              <p className="text-xs text-slate-500 font-mono tabular-nums">
                {period === 'day'
                  ? `Goal: ${dailyCalorieGoal.toLocaleString()} kcal`
                  : `Avg: ${avgDailyCalories.toLocaleString()} kcal/day`}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-1">
              <p className="text-xs font-medium text-slate-500">
                {period === 'day' ? 'Protein' : 'Avg Protein / Day'}
              </p>
              <p className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                {(period === 'day' ? periodTotals.protein : avgProtein).toLocaleString()}
                <span className="text-xs font-normal text-slate-500 ml-1">g</span>
              </p>
              <p className="text-xs text-slate-500 font-mono tabular-nums">
                Goal: {proteinGoal}g/day
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-1">
              <p className="text-xs font-medium text-slate-500">
                {period === 'day' ? 'Carbohydrates' : 'Avg Carbs / Day'}
              </p>
              <p className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                {(period === 'day' ? periodTotals.carbs : avgCarbs).toLocaleString()}
                <span className="text-xs font-normal text-slate-500 ml-1">g</span>
              </p>
              <p className="text-xs text-slate-500 font-mono tabular-nums">
                Goal: {carbsGoal}g/day
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-1">
              <p className="text-xs font-medium text-slate-500">
                {period === 'day' ? 'Fat' : 'Consistency'}
              </p>
              {period === 'day' ? (
                <>
                  <p className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                    {periodTotals.fat.toLocaleString()}
                    <span className="text-xs font-normal text-slate-500 ml-1">g</span>
                  </p>
                  <p className="text-xs text-slate-500 font-mono tabular-nums">
                    Goal: {fatGoal}g/day
                  </p>
                </>
              ) : (
                <>
                  <p className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                    {loggedDays.length}
                    <span className="text-xs font-normal text-slate-500 ml-1">
                      / {dayBuckets.length} days
                    </span>
                  </p>
                  <p className="text-xs text-emerald-800 font-mono tabular-nums">
                    {daysOnTarget} on calorie target · Avg fat {avgFat}g
                  </p>
                </>
              )}
            </div>
          </section>

          {/* DAY VIEW DETAILS */}
          {period === 'day' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <section className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4">
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    Macro Energy Split
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Share of daily calories by macronutrient
                  </p>
                </div>

                {macroCaloriesTotal === 0 ? (
                  <p className="text-xs text-slate-500 py-4">
                    No meals recorded for this day yet.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div className="h-3 w-full rounded-full overflow-hidden flex bg-slate-100" aria-hidden="true">
                      <div
                        className="bg-emerald-600 h-full"
                        style={{ width: `${proteinEnergyPct}%` }}
                      />
                      <div
                        className="bg-blue-700 h-full"
                        style={{ width: `${carbsEnergyPct}%` }}
                      />
                      <div
                        className="bg-amber-600 h-full"
                        style={{ width: `${fatEnergyPct}%` }}
                      />
                    </div>

                    <div className="space-y-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-700">Protein</span>
                        <span className="font-mono tabular-nums text-slate-900">
                          {periodTotals.protein}g / {proteinGoal}g · {proteinEnergyPct}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-700">Carbohydrates</span>
                        <span className="font-mono tabular-nums text-slate-900">
                          {periodTotals.carbs}g / {carbsGoal}g · {carbsEnergyPct}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-700">Fat</span>
                        <span className="font-mono tabular-nums text-slate-900">
                          {periodTotals.fat}g / {fatGoal}g · {fatEnergyPct}%
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <section className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4">
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    Meals Logged ({effectiveMeals.length})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Grouped by meal period
                  </p>
                </div>

                {effectiveMeals.length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70">
                    No meals logged on this date.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {MEAL_TYPE_ORDER.map((type) => {
                      const items = effectiveMeals.filter((m) => m.mealType === type);
                      if (items.length === 0) return null;
                      const slotCalories = items.reduce((s, m) => s + m.calories, 0);
                      return (
                        <div key={type} className="space-y-1.5">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                            <span className="text-xs font-semibold text-slate-800">
                              {MEAL_TYPE_LABELS[type]}
                            </span>
                            <span className="font-mono text-xs text-slate-600 tabular-nums">
                              {slotCalories.toLocaleString()} kcal
                            </span>
                          </div>
                          <ul className="divide-y divide-slate-100">
                            {items.map((meal) => (
                              <li
                                key={meal.id}
                                className="py-2 flex items-center justify-between gap-3 text-xs"
                              >
                                <span className="text-slate-800 truncate">
                                  {meal.foods.join(', ')}
                                </span>
                                <span className="font-mono text-slate-600 tabular-nums whitespace-nowrap shrink-0">
                                  {meal.calories} kcal · P {meal.protein}g · C {meal.carbs}g · F {meal.fat}g
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* WEEK & MONTH CHART + BREAKDOWN */}
          {period !== 'day' && (
            <div className="space-y-6">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-base font-semibold text-slate-900">
                      {period === 'week' ? 'Weekly Calorie Distribution' : 'Monthly Daily Calorie Trend'}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                      Goal line: {dailyCalorieGoal.toLocaleString()} kcal/day
                    </p>
                  </div>

                  {inspectedBucket && (
                    <div className="text-left sm:text-right">
                      <p className="text-xs font-medium text-slate-600">
                        {inspectedBucket.fullLabel}
                      </p>
                      <p className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                        {inspectedBucket.totals.calories.toLocaleString()} kcal
                        <span className="text-xs font-normal text-slate-500 ml-2">
                          ({inspectedBucket.meals.length}{' '}
                          {inspectedBucket.meals.length === 1 ? 'meal' : 'meals'})
                        </span>
                      </p>
                    </div>
                  )}
                </div>

                <div className="w-full overflow-hidden">
                  <svg
                    viewBox="0 0 720 210"
                    role="img"
                    aria-label={`${period} calorie consumption chart`}
                    className="w-full h-auto select-none overflow-visible"
                  >
                    {[0, Math.round(chartMaxCalories / 2), chartMaxCalories].map((tick) => {
                      const y = 18 + 154 * (1 - tick / Math.max(1, chartMaxCalories));
                      return (
                        <g key={tick}>
                          <line x1={48} y1={y} x2={704} y2={y} stroke="#E2E8F0" strokeWidth="1" />
                          <text
                            x={40}
                            y={y + 4}
                            textAnchor="end"
                            className="fill-slate-400 font-mono text-[10px]"
                          >
                            {tick.toLocaleString()}
                          </text>
                        </g>
                      );
                    })}

                    {/* Goal Dashed Line */}
                    {(() => {
                      const goalY =
                        18 + 154 * (1 - Math.min(1, dailyCalorieGoal / Math.max(1, chartMaxCalories)));
                      return (
                        <>
                          <line
                            x1={48}
                            y1={goalY}
                            x2={704}
                            y2={goalY}
                            stroke="#94A3B8"
                            strokeWidth="1.25"
                            strokeDasharray="4 4"
                          />
                          <text
                            x={704}
                            y={Math.max(14, goalY - 5)}
                            textAnchor="end"
                            className="fill-slate-500 font-mono text-[10px]"
                          >
                            Goal
                          </text>
                        </>
                      );
                    })()}

                    {dayBuckets.map((bucket, idx) => {
                      const slotWidth = (704 - 56) / Math.max(1, dayBuckets.length);
                      const barWidth = Math.max(6, Math.min(34, slotWidth * 0.62));
                      const xCenter = 56 + slotWidth * idx + slotWidth / 2;
                      const ratio = Math.min(1, bucket.totals.calories / Math.max(1, chartMaxCalories));
                      const barHeight = Math.max(bucket.totals.calories > 0 ? 4 : 2, 154 * ratio);
                      const y = 172 - barHeight;
                      const isOver = bucket.totals.calories > dailyCalorieGoal;
                      const isActive = inspectedBucket?.dateKey === bucket.dateKey;
                      const showLabel =
                        period === 'week' || idx === 0 || (idx + 1) % 5 === 0 || idx === dayBuckets.length - 1;

                      return (
                        <g key={bucket.dateKey}>
                          <rect
                            x={xCenter - barWidth / 2}
                            y={y}
                            width={barWidth}
                            height={barHeight}
                            rx={3}
                            fill={
                              bucket.totals.calories === 0
                                ? '#E2E8F0'
                                : isOver
                                  ? '#DC2626'
                                  : '#059669'
                            }
                            opacity={isActive ? 1 : 0.82}
                          />
                          <rect
                            x={xCenter - slotWidth / 2}
                            y={18}
                            width={slotWidth}
                            height={176}
                            fill="transparent"
                            role="button"
                            tabIndex={0}
                            aria-label={`${bucket.fullLabel}: ${bucket.totals.calories} kcal`}
                            onMouseEnter={() => setHoveredDayKey(bucket.dateKey)}
                            onFocus={() => setHoveredDayKey(bucket.dateKey)}
                            onClick={() => setHoveredDayKey(bucket.dateKey)}
                            className="cursor-pointer focus:outline-none"
                          />
                          {showLabel && (
                            <text
                              x={xCenter}
                              y={196}
                              textAnchor="middle"
                              className={`text-[10px] ${
                                isActive ? 'fill-slate-900 font-semibold' : 'fill-slate-500'
                              }`}
                            >
                              {bucket.shortLabel}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </section>

              {period === 'week' ? (
                <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100">
                    <h3 className="font-display text-base font-semibold text-slate-900">
                      Day-by-Day Breakdown
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-4 font-medium">Day</th>
                          <th className="py-2.5 px-4 font-medium text-right">Meals</th>
                          <th className="py-2.5 px-4 font-medium text-right">Calories</th>
                          <th className="py-2.5 px-4 font-medium text-right">Protein</th>
                          <th className="py-2.5 px-4 font-medium text-right">Carbs</th>
                          <th className="py-2.5 px-4 font-medium text-right">Fat</th>
                          <th className="py-2.5 px-4 font-medium text-right">vs Goal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                        {dayBuckets.map((bucket) => {
                          const diff = dailyCalorieGoal - bucket.totals.calories;
                          const isOver = bucket.totals.calories > dailyCalorieGoal;
                          return (
                            <tr key={bucket.dateKey} className="hover:bg-slate-50/70">
                              <td className="py-2.5 px-4 font-sans font-medium text-slate-800 whitespace-nowrap">
                                {bucket.fullLabel}
                              </td>
                              <td className="py-2.5 px-4 text-right text-slate-600">
                                {bucket.meals.length}
                              </td>
                              <td className="py-2.5 px-4 text-right font-medium text-slate-900">
                                {bucket.totals.calories.toLocaleString()} kcal
                              </td>
                              <td className="py-2.5 px-4 text-right text-slate-600">
                                {bucket.totals.protein}g
                              </td>
                              <td className="py-2.5 px-4 text-right text-slate-600">
                                {bucket.totals.carbs}g
                              </td>
                              <td className="py-2.5 px-4 text-right text-slate-600">
                                {bucket.totals.fat}g
                              </td>
                              <td
                                className={`py-2.5 px-4 text-right ${
                                  bucket.meals.length === 0
                                    ? 'text-slate-400'
                                    : isOver
                                      ? 'text-red-700'
                                      : 'text-emerald-800'
                                }`}
                              >
                                {bucket.meals.length === 0
                                  ? '—'
                                  : isOver
                                    ? `+${Math.abs(diff)} over`
                                    : `${diff} left`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : (
                <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100">
                    <h3 className="font-display text-base font-semibold text-slate-900">
                      Weekly Rollups in {rangeLabel}
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-4 font-medium">Window</th>
                          <th className="py-2.5 px-4 font-medium text-right">Logged Days</th>
                          <th className="py-2.5 px-4 font-medium text-right">Total Calories</th>
                          <th className="py-2.5 px-4 font-medium text-right">Daily Avg</th>
                          <th className="py-2.5 px-4 font-medium text-right">Total Protein</th>
                          <th className="py-2.5 px-4 font-medium text-right">Total Carbs</th>
                          <th className="py-2.5 px-4 font-medium text-right">Total Fat</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                        {monthlyWeeks.map((week) => {
                          const avg =
                            week.activeDays > 0
                              ? Math.round(week.totals.calories / week.activeDays)
                              : 0;
                          return (
                            <tr key={week.label} className="hover:bg-slate-50/70">
                              <td className="py-2.5 px-4 font-sans font-medium text-slate-800 whitespace-nowrap">
                                {week.label}
                              </td>
                              <td className="py-2.5 px-4 text-right text-slate-600">
                                {week.activeDays}
                              </td>
                              <td className="py-2.5 px-4 text-right font-medium text-slate-900">
                                {week.totals.calories.toLocaleString()} kcal
                              </td>
                              <td className="py-2.5 px-4 text-right text-slate-700">
                                {avg.toLocaleString()} kcal
                              </td>
                              <td className="py-2.5 px-4 text-right text-slate-600">
                                {week.totals.protein}g
                              </td>
                              <td className="py-2.5 px-4 text-right text-slate-600">
                                {week.totals.carbs}g
                              </td>
                              <td className="py-2.5 px-4 text-right text-slate-600">
                                {week.totals.fat}g
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
