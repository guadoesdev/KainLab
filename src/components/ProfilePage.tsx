import { useEffect, useState, type FormEvent } from 'react';
import type { AppAuthUser } from '../lib/supabaseAuth';
import { CheckCircle2, Loader2, Save } from 'lucide-react';
import {
  DEFAULT_DAILY_CALORIE_GOAL,
  deriveDefaultMacroGoals,
  updateNutritionGoals,
  type UserProfileRecord,
} from '../lib/profileService';

interface ProfilePageProps {
  user: AppAuthUser;
  profile: UserProfileRecord | null;
  localGoals: {
    dailyCalorieGoal: number;
    proteinGoal: number;
    carbsGoal: number;
    fatGoal: number;
  };
  onProfileUpdated: (nextProfile: UserProfileRecord) => void;
  onLocalGoalsUpdated: (nextGoals: {
    dailyCalorieGoal: number;
    proteinGoal: number;
    carbsGoal: number;
    fatGoal: number;
  }) => void;
}

const MACRO_PRESETS = [
  { label: 'Balanced (30/45/25)', proteinPct: 0.3, carbsPct: 0.45, fatPct: 0.25 },
  { label: 'High Protein (35/40/25)', proteinPct: 0.35, carbsPct: 0.4, fatPct: 0.25 },
  { label: 'Lower Carb (30/25/45)', proteinPct: 0.3, carbsPct: 0.25, fatPct: 0.45 },
] as const;

export function ProfilePage({
  user,
  profile,
  localGoals,
  onProfileUpdated,
  onLocalGoalsUpdated,
}: ProfilePageProps) {
  const activeCalories = profile?.dailyCalorieGoal ?? localGoals.dailyCalorieGoal ?? DEFAULT_DAILY_CALORIE_GOAL;
  const fallbackMacros = deriveDefaultMacroGoals(activeCalories);
  const activeProtein = profile?.proteinGoal ?? localGoals.proteinGoal ?? fallbackMacros.proteinGoal;
  const activeCarbs = profile?.carbsGoal ?? localGoals.carbsGoal ?? fallbackMacros.carbsGoal;
  const activeFat = profile?.fatGoal ?? localGoals.fatGoal ?? fallbackMacros.fatGoal;

  const [displayName, setDisplayName] = useState(
    profile?.displayName || user.displayName || user.email?.split('@')[0] || 'Member'
  );
  const [caloriesInput, setCaloriesInput] = useState(String(activeCalories));
  const [proteinInput, setProteinInput] = useState(String(activeProtein));
  const [carbsInput, setCarbsInput] = useState(String(activeCarbs));
  const [fatInput, setFatInput] = useState(String(activeFat));

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(
      profile?.displayName || user.displayName || user.email?.split('@')[0] || 'Member'
    );
    setCaloriesInput(String(activeCalories));
    setProteinInput(String(activeProtein));
    setCarbsInput(String(activeCarbs));
    setFatInput(String(activeFat));
  }, [profile, user.displayName, user.email, activeCalories, activeProtein, activeCarbs, activeFat]);

  function applyMacroPreset(proteinPct: number, carbsPct: number, fatPct: number) {
    setSavedNotice(null);
    setErrorMessage(null);
    const cal = Math.min(10000, Math.max(800, Number(caloriesInput) || DEFAULT_DAILY_CALORIE_GOAL));
    setCaloriesInput(String(Math.round(cal)));
    setProteinInput(String(Math.min(500, Math.max(20, Math.round((cal * proteinPct) / 4)))));
    setCarbsInput(String(Math.min(1000, Math.max(20, Math.round((cal * carbsPct) / 4)))));
    setFatInput(String(Math.min(400, Math.max(10, Math.round((cal * fatPct) / 9)))));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setSavedNotice(null);

    const dailyCalorieGoal = Number(caloriesInput);
    const proteinGoal = Number(proteinInput);
    const carbsGoal = Number(carbsInput);
    const fatGoal = Number(fatInput);

    if (!Number.isFinite(dailyCalorieGoal) || dailyCalorieGoal < 800 || dailyCalorieGoal > 10000) {
      setErrorMessage('Daily calorie goal must be between 800 and 10,000 kcal.');
      return;
    }
    if (!Number.isFinite(proteinGoal) || proteinGoal < 20 || proteinGoal > 500) {
      setErrorMessage('Protein goal must be between 20g and 500g.');
      return;
    }
    if (!Number.isFinite(carbsGoal) || carbsGoal < 20 || carbsGoal > 1000) {
      setErrorMessage('Carbohydrates goal must be between 20g and 1,000g.');
      return;
    }
    if (!Number.isFinite(fatGoal) || fatGoal < 10 || fatGoal > 400) {
      setErrorMessage('Fat goal must be between 10g and 400g.');
      return;
    }

    const cleanName = displayName.trim();
    if (!cleanName || cleanName.length > 80) {
      setErrorMessage('Display name must be between 1 and 80 characters.');
      return;
    }

    setIsSaving(true);
    try {
      if (!user.emailVerified) {
        onLocalGoalsUpdated({
          dailyCalorieGoal: Math.round(dailyCalorieGoal),
          proteinGoal: Math.round(proteinGoal),
          carbsGoal: Math.round(carbsGoal),
          fatGoal: Math.round(fatGoal),
        });
        setSavedNotice('Nutrition goals updated for this session. Verify your email to persist across devices.');
        return;
      }

      const saved = await updateNutritionGoals(user, {
        displayName: cleanName,
        dailyCalorieGoal,
        proteinGoal,
        carbsGoal,
        fatGoal,
      });

      if (profile) {
        onProfileUpdated({
          ...profile,
          displayName: saved.displayName || cleanName,
          dailyCalorieGoal: saved.dailyCalorieGoal,
          proteinGoal: saved.proteinGoal,
          carbsGoal: saved.carbsGoal,
          fatGoal: saved.fatGoal,
        });
      } else {
        onLocalGoalsUpdated({
          dailyCalorieGoal: saved.dailyCalorieGoal,
          proteinGoal: saved.proteinGoal,
          carbsGoal: saved.carbsGoal,
          fatGoal: saved.fatGoal,
        });
      }

      setSavedNotice('Nutrition goals saved. Your Today and Summary dashboards now reflect these targets.');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to save nutrition goals.'
      );
    } finally {
      setIsSaving(false);
    }
  }

  const parsedProtein = Math.max(0, Number(proteinInput) || 0);
  const parsedCarbs = Math.max(0, Number(carbsInput) || 0);
  const parsedFat = Math.max(0, Number(fatInput) || 0);
  const macroEnergySum = parsedProtein * 4 + parsedCarbs * 4 + parsedFat * 9;
  const pPct = macroEnergySum > 0 ? Math.round(((parsedProtein * 4) / macroEnergySum) * 100) : 0;
  const cPct = macroEnergySum > 0 ? Math.round(((parsedCarbs * 4) / macroEnergySum) * 100) : 0;
  const fPct = macroEnergySum > 0 ? Math.max(0, 100 - pPct - cPct) : 0;

  const initials = (displayName || user.email || 'U')
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Account Summary Card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt={displayName}
            referrerPolicy="no-referrer"
            className="h-14 w-14 rounded-full object-cover border border-slate-200 shrink-0"
          />
        ) : (
          <div className="h-14 w-14 rounded-full bg-emerald-700 text-white font-display font-semibold text-lg flex items-center justify-center shrink-0">
            {initials}
          </div>
        )}

        <div className="min-w-0 space-y-1">
          <h2 className="font-display text-lg font-semibold text-slate-900 truncate">
            {displayName}
          </h2>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            {profile?.username && <span>@{profile.username}</span>}
            {profile?.username && user.email && <span aria-hidden="true">·</span>}
            {user.email && <span className="truncate">{user.email}</span>}
            <span aria-hidden="true">·</span>
            <span>{user.emailVerified ? 'Verified account' : 'Email verification pending'}</span>
          </div>
        </div>
      </section>

      {/* Nutrition Goals Form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-6"
      >
        <div>
          <h3 className="font-display text-lg font-semibold text-slate-900">
            Daily Nutrition Goals
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Set your daily calorie budget and macronutrient targets used across Today and Summary views
          </p>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800"
          >
            {errorMessage}
          </div>
        )}

        {savedNotice && (
          <div
            role="status"
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 flex items-center gap-2"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
            <span>{savedNotice}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="profile-display-name" className="block text-xs font-medium text-slate-700">
            Display Name
          </label>
          <input
            id="profile-display-name"
            type="text"
            maxLength={80}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
          />
        </div>

        <div className="space-y-3 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-700">Quick Macro Ratio Presets</span>
            <div className="flex flex-wrap items-center gap-2">
              {MACRO_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() =>
                    applyMacroPreset(preset.proteinPct, preset.carbsPct, preset.fatPct)
                  }
                  className="min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div className="space-y-1.5">
              <label htmlFor="goal-calories" className="block text-xs font-medium text-slate-700">
                Daily Calorie Goal (kcal)
              </label>
              <input
                id="goal-calories"
                type="number"
                min={800}
                max={10000}
                value={caloriesInput}
                onChange={(e) => setCaloriesInput(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm tabular-nums text-slate-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
              />
              <p className="text-[11px] text-slate-500">Range: 800 – 10,000 kcal</p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="goal-protein" className="block text-xs font-medium text-slate-700">
                Protein Goal (g)
              </label>
              <input
                id="goal-protein"
                type="number"
                min={20}
                max={500}
                value={proteinInput}
                onChange={(e) => setProteinInput(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm tabular-nums text-slate-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
              />
              <p className="text-[11px] text-slate-500">Range: 20 – 500 g (4 kcal/g)</p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="goal-carbs" className="block text-xs font-medium text-slate-700">
                Carbohydrates Goal (g)
              </label>
              <input
                id="goal-carbs"
                type="number"
                min={20}
                max={1000}
                value={carbsInput}
                onChange={(e) => setCarbsInput(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm tabular-nums text-slate-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
              />
              <p className="text-[11px] text-slate-500">Range: 20 – 1,000 g (4 kcal/g)</p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="goal-fat" className="block text-xs font-medium text-slate-700">
                Fat Goal (g)
              </label>
              <input
                id="goal-fat"
                type="number"
                min={10}
                max={400}
                value={fatInput}
                onChange={(e) => setFatInput(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm tabular-nums text-slate-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
              />
              <p className="text-[11px] text-slate-500">Range: 10 – 400 g (9 kcal/g)</p>
            </div>
          </div>

          <div className="pt-2 text-xs text-slate-600 font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Macro energy estimate: {macroEnergySum.toLocaleString()} kcal</span>
            <span aria-hidden="true">·</span>
            <span>
              Split: {pPct}% P / {cPct}% C / {fPct}% F
            </span>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 flex items-center justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="min-h-[44px] px-5 py-2 inline-flex items-center gap-2 rounded-xl bg-emerald-700 text-sm font-medium text-white hover:bg-emerald-800 transition-colors disabled:opacity-60 whitespace-nowrap"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{isSaving ? 'Saving goals...' : 'Save Nutrition Goals'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
