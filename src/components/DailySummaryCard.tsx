import { useState, type FormEvent } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import type { NutritionTotals } from '../types/nutrition';

interface DailySummaryCardProps {
  totals: NutritionTotals;
  dailyCalorieGoal: number;
  proteinGoal?: number;
  carbsGoal?: number;
  fatGoal?: number;
  mealCount: number;
  onUpdateCalorieGoal: (nextGoal: number) => Promise<void>;
}

export function DailySummaryCard({
  totals,
  dailyCalorieGoal,
  proteinGoal,
  carbsGoal,
  fatGoal,
  mealCount,
  onUpdateCalorieGoal,
}: DailySummaryCardProps) {
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState(String(dailyCalorieGoal));
  const [goalError, setGoalError] = useState<string | null>(null);
  const [isSavingGoal, setIsSavingGoal] = useState(false);

  const remaining = dailyCalorieGoal - totals.calories;
  const isOverGoal = remaining < 0;
  const progressRatio = Math.min(1, Math.max(0, totals.calories / Math.max(1, dailyCalorieGoal)));
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progressRatio);

  // Use custom macro goals from Profile when set, or proportional defaults (30% protein, 45% carbs, 25% fat)
  const proteinTarget = proteinGoal ?? Math.max(40, Math.round((dailyCalorieGoal * 0.3) / 4));
  const carbsTarget = carbsGoal ?? Math.max(50, Math.round((dailyCalorieGoal * 0.45) / 4));
  const fatTarget = fatGoal ?? Math.max(25, Math.round((dailyCalorieGoal * 0.25) / 9));

  async function handleSaveGoal(event: FormEvent) {
    event.preventDefault();
    setGoalError(null);
    const parsed = Number(goalInput);
    if (!Number.isFinite(parsed) || parsed < 800 || parsed > 10000) {
      setGoalError('Enter a goal between 800 and 10,000 kcal.');
      return;
    }
    setIsSavingGoal(true);
    try {
      await onUpdateCalorieGoal(Math.round(parsed));
      setIsEditingGoal(false);
    } catch (error) {
      setGoalError(error instanceof Error ? error.message : 'Unable to save goal.');
    } finally {
      setIsSavingGoal(false);
    }
  }

  const macroRows = [
    {
      label: 'Protein',
      value: totals.protein,
      target: proteinTarget,
      barColor: 'bg-emerald-600',
    },
    {
      label: 'Carbohydrates',
      value: totals.carbs,
      target: carbsTarget,
      barColor: 'bg-blue-700',
    },
    {
      label: 'Fat',
      value: totals.fat,
      target: fatTarget,
      barColor: 'bg-amber-600',
    },
  ];

  return (
    <section
      aria-label="Daily Nutrition Summary"
      className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Daily Nutrition Summary
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            {mealCount === 0
              ? 'No meals logged yet today'
              : `${mealCount} ${mealCount === 1 ? 'meal' : 'meals'} logged today`}
          </p>
        </div>

        {!isEditingGoal ? (
          <button
            type="button"
            onClick={() => {
              setGoalInput(String(dailyCalorieGoal));
              setGoalError(null);
              setIsEditingGoal(true);
            }}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="tabular-nums">Goal: {dailyCalorieGoal.toLocaleString()} kcal</span>
          </button>
        ) : (
          <form onSubmit={handleSaveGoal} className="flex items-center gap-2">
            <label htmlFor="daily-goal-input" className="sr-only">
              Daily calorie goal
            </label>
            <input
              id="daily-goal-input"
              type="number"
              min={800}
              max={10000}
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              className="w-28 min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
            />
            <button
              type="submit"
              disabled={isSavingGoal}
              aria-label="Save calorie goal"
              className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 transition-colors disabled:opacity-60"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => {
                setIsEditingGoal(false);
                setGoalError(null);
              }}
              aria-label="Cancel editing goal"
              className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
        )}
      </div>

      {goalError && (
        <p role="alert" className="text-xs text-red-700">
          {goalError}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-center pt-1">
        <div className="sm:col-span-5 flex items-center gap-4">
          <div className="relative h-28 w-28 shrink-0 flex items-center justify-center">
            <svg className="h-28 w-28 -rotate-90" viewBox="0 0 108 108" aria-hidden="true">
              <circle
                cx="54"
                cy="54"
                r={radius}
                fill="none"
                stroke="#E2E8F0"
                strokeWidth="10"
              />
              <circle
                cx="54"
                cy="54"
                r={radius}
                fill="none"
                stroke={isOverGoal ? '#DC2626' : '#059669'}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                className="transition-[stroke-dashoffset] duration-200 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="font-mono text-xl font-semibold text-slate-900 tabular-nums leading-none">
                {totals.calories.toLocaleString()}
              </span>
              <span className="text-[11px] text-slate-500 mt-1">kcal</span>
            </div>
          </div>

          <div className="min-w-0 space-y-2.5 flex-1">
            <div>
              <p className="text-xs text-slate-500">Remaining</p>
              <p
                className={`font-mono text-lg font-semibold tabular-nums ${
                  isOverGoal ? 'text-red-700' : 'text-emerald-800'
                }`}
              >
                {isOverGoal
                  ? `-${Math.abs(remaining).toLocaleString()} kcal`
                  : `${remaining.toLocaleString()} kcal`}
              </p>
              <p className="text-[11px] text-slate-500">
                {isOverGoal ? 'Over daily goal' : 'Left for today'}
              </p>
            </div>
            <div className="pt-1 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-500">Consumed</span>
              <span className="font-mono font-medium text-slate-800 tabular-nums">
                {Math.round(progressRatio * 100)}% of goal
              </span>
            </div>
          </div>
        </div>

        <div className="sm:col-span-7 grid grid-cols-3 gap-3">
          {macroRows.map((macro) => {
            const pct = Math.min(100, Math.round((macro.value / macro.target) * 100));
            return (
              <div
                key={macro.label}
                className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2"
              >
                <p className="text-xs font-medium text-slate-600 truncate">{macro.label}</p>
                <p className="font-mono text-lg font-semibold text-slate-900 tabular-nums leading-tight">
                  {macro.value}
                  <span className="text-xs font-normal text-slate-500 ml-0.5">g</span>
                </p>
                <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden" aria-hidden="true">
                  <div
                    className={`h-full rounded-full transition-all duration-200 ${macro.barColor}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                  /{macro.target}g goal
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
