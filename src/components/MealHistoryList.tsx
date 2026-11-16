import { useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Camera,
  ChevronRight,
  ExternalLink,
  Loader2,
  MessageSquareText,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import type { MealEntry, MealType } from '../types/nutrition';

interface MealHistoryListProps {
  meals: MealEntry[];
  onUpdateMeal: (
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
  ) => Promise<void>;
  onDeleteMeal: (mealId: string) => Promise<void>;
}

const MEAL_TYPE_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
};

function formatMealTime(createdAt: MealEntry['createdAt']): string {
  if (!createdAt) return 'Just now';
  if (createdAt instanceof Date) {
    return createdAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (typeof createdAt === 'object' && 'toDate' in createdAt && typeof createdAt.toDate === 'function') {
    return createdAt.toDate().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return 'Today';
}

export function MealHistoryList({
  meals,
  onUpdateMeal,
  onDeleteMeal,
}: MealHistoryListProps) {
  const [selectedMeal, setSelectedMeal] = useState<MealEntry | null>(null);
  const [editingMeal, setEditingMeal] = useState<MealEntry | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Edit form fields
  const [editMealType, setEditMealType] = useState<MealType>('lunch');
  const [editFoodsText, setEditFoodsText] = useState('');
  const [editPortions, setEditPortions] = useState('');
  const [editCalories, setEditCalories] = useState('0');
  const [editProtein, setEditProtein] = useState('0');
  const [editCarbs, setEditCarbs] = useState('0');
  const [editFat, setEditFat] = useState('0');

  function openEditModal(meal: MealEntry) {
    setSelectedMeal(null);
    setEditError(null);
    setEditingMeal(meal);
    setEditMealType(meal.mealType);
    setEditFoodsText(meal.foods.join(', '));
    setEditPortions(meal.portions);
    setEditCalories(String(meal.calories));
    setEditProtein(String(meal.protein));
    setEditCarbs(String(meal.carbs));
    setEditFat(String(meal.fat));
  }

  async function handleEditSubmit(event: FormEvent) {
    event.preventDefault();
    if (!editingMeal) return;
    setEditError(null);

    const foods = editFoodsText
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (foods.length === 0) {
      setEditError('Include at least one food item.');
      return;
    }

    const calories = Number(editCalories);
    const protein = Number(editProtein);
    const carbs = Number(editCarbs);
    const fat = Number(editFat);

    if (
      !Number.isFinite(calories) ||
      calories < 0 ||
      !Number.isFinite(protein) ||
      protein < 0 ||
      !Number.isFinite(carbs) ||
      carbs < 0 ||
      !Number.isFinite(fat) ||
      fat < 0
    ) {
      setEditError('Nutrition values must be valid non-negative numbers.');
      return;
    }

    setIsMutating(true);
    try {
      await onUpdateMeal(editingMeal.id, {
        mealType: editMealType,
        foods,
        portions: editPortions.trim() || foods.join(', '),
        calories: Math.round(calories),
        protein: Math.round(protein),
        carbs: Math.round(carbs),
        fat: Math.round(fat),
      });
      setEditingMeal(null);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Unable to save meal changes.');
    } finally {
      setIsMutating(false);
    }
  }

  async function handleConfirmDelete(mealId: string) {
    setActionError(null);
    setIsMutating(true);
    try {
      await onDeleteMeal(mealId);
      setConfirmDeleteId(null);
      if (selectedMeal?.id === mealId) {
        setSelectedMeal(null);
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Unable to delete meal entry.'
      );
    } finally {
      setIsMutating(false);
    }
  }

  const groupedMeals = MEAL_TYPE_ORDER.map((type) => ({
    type,
    label: MEAL_TYPE_LABELS[type],
    items: meals.filter((m) => m.mealType === type),
  })).filter((group) => group.items.length > 0);

  return (
    <section
      aria-label="Today's Meal History"
      className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-5"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Today&apos;s Meal History
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Chronological log · Inspect, edit, or delete any entry
          </p>
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" aria-hidden="true" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="Dismiss error"
            className="text-red-700 hover:text-red-900 p-1"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {meals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center space-y-1.5">
          <p className="text-sm font-medium text-slate-800">
            Your meal log for today is empty
          </p>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Describe what you ate or upload a meal photo in the AI Nutrition Assistant to record your first entry.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedMeals.map((group) => (
            <div key={group.type} className="space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 className="text-sm font-semibold text-slate-800">{group.label}</h3>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {group.items.reduce((sum, item) => sum + item.calories, 0).toLocaleString()} kcal
                </span>
              </div>

              <ul className="divide-y divide-slate-100">
                {group.items.map((meal) => (
                  <li key={meal.id} className="py-3 first:pt-1 last:pb-1">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedMeal(meal)}
                        className="min-w-0 flex-1 text-left group rounded-lg p-1 -m-1 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-900 group-hover:text-emerald-800 truncate">
                            {meal.foods.join(', ')}
                          </span>
                          <ChevronRight
                            className="h-4 w-4 text-slate-400 group-hover:text-emerald-700 shrink-0"
                            aria-hidden="true"
                          />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 font-mono tabular-nums">
                          <span>{formatMealTime(meal.createdAt)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 font-sans">
                            {meal.source === 'image' ? (
                              <>
                                <Camera className="h-3 w-3" aria-hidden="true" />
                                Photo
                              </>
                            ) : (
                              <>
                                <MessageSquareText className="h-3 w-3" aria-hidden="true" />
                                Chat
                              </>
                            )}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-700 font-medium">{meal.calories} kcal</span>
                          <span aria-hidden="true">·</span>
                          <span>P {meal.protein}g</span>
                          <span aria-hidden="true">·</span>
                          <span>C {meal.carbs}g</span>
                          <span aria-hidden="true">·</span>
                          <span>F {meal.fat}g</span>
                        </div>
                      </button>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={isMutating}
                          onClick={() => openEditModal(meal)}
                          aria-label={`Edit ${meal.foods.join(', ')}`}
                          className="min-h-[40px] px-2.5 py-1.5 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Edit</span>
                        </button>

                        {confirmDeleteId === meal.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isMutating}
                              onClick={() => handleConfirmDelete(meal.id)}
                              className="min-h-[40px] px-3 py-1.5 inline-flex items-center gap-1.5 rounded-lg bg-red-600 text-xs font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-60 whitespace-nowrap shrink-0"
                            >
                              {isMutating && (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              )}
                              <span>Confirm</span>
                            </button>
                            <button
                              type="button"
                              disabled={isMutating}
                              onClick={() => setConfirmDeleteId(null)}
                              className="min-h-[40px] px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap shrink-0"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={isMutating}
                            onClick={() => setConfirmDeleteId(meal.id)}
                            aria-label={`Delete ${meal.foods.join(', ')}`}
                            className="min-h-[40px] px-2.5 py-1.5 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-red-50 hover:border-red-200 hover:text-red-700 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {selectedMeal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="meal-detail-title"
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white border border-slate-200 p-6 space-y-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-emerald-800">
                  {MEAL_TYPE_LABELS[selectedMeal.mealType]} · {formatMealTime(selectedMeal.createdAt)}
                </p>
                <h3 id="meal-detail-title" className="font-display text-xl font-semibold text-slate-900 mt-1">
                  Meal Details
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMeal(null)}
                aria-label="Close meal details"
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-slate-500">Foods identified</p>
                <ul className="mt-1.5 space-y-1 text-sm text-slate-900">
                  {selectedMeal.foods.map((food, idx) => (
                    <li key={`${food}-${idx}`}>· {food}</li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500">Estimated portions</p>
                <p className="mt-1 text-sm text-slate-800">{selectedMeal.portions}</p>
              </div>

              <div className="grid grid-cols-4 gap-2 pt-1">
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <p className="text-[11px] text-slate-500">Calories</p>
                  <p className="font-mono text-base font-semibold text-slate-900 tabular-nums mt-0.5">
                    {selectedMeal.calories}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <p className="text-[11px] text-slate-500">Protein</p>
                  <p className="font-mono text-base font-semibold text-slate-900 tabular-nums mt-0.5">
                    {selectedMeal.protein}g
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <p className="text-[11px] text-slate-500">Carbs</p>
                  <p className="font-mono text-base font-semibold text-slate-900 tabular-nums mt-0.5">
                    {selectedMeal.carbs}g
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <p className="text-[11px] text-slate-500">Fat</p>
                  <p className="font-mono text-base font-semibold text-slate-900 tabular-nums mt-0.5">
                    {selectedMeal.fat}g
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                <span>Source: {selectedMeal.source === 'image' ? 'Food Photo' : 'AI Chat'}</span>
                <span className="font-mono tabular-nums">
                  AI Confidence: {Math.round(selectedMeal.confidence * 100)}%
                </span>
              </div>

              {selectedMeal.sources && selectedMeal.sources.length > 0 && (
                <div className="pt-2 border-t border-slate-100 space-y-1">
                  <p className="text-xs font-medium text-slate-500">Nutrition sources</p>
                  <div className="flex flex-wrap gap-3 text-xs">
                    {selectedMeal.sources.map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-700 hover:underline underline-offset-2"
                      >
                        <span className="truncate max-w-[220px]">{url}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={isMutating}
                onClick={() => handleConfirmDelete(selectedMeal.id)}
                className="min-h-[44px] px-4 py-2 inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 text-sm font-medium text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                <span>Delete</span>
              </button>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => openEditModal(selectedMeal)}
                  className="min-h-[44px] px-4 py-2 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-800 hover:bg-slate-50 transition-colors"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedMeal(null)}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-slate-900 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingMeal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="meal-edit-title"
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <form
            onSubmit={handleEditSubmit}
            className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white border border-slate-200 p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-4">
              <h3 id="meal-edit-title" className="font-display text-lg font-semibold text-slate-900">
                Edit Meal
              </h3>
              <button
                type="button"
                onClick={() => setEditingMeal(null)}
                aria-label="Close edit meal dialog"
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {editError && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {editError}
              </p>
            )}

            <div className="space-y-1.5">
              <label htmlFor="edit-meal-type" className="block text-xs font-medium text-slate-700">
                Meal type
              </label>
              <select
                id="edit-meal-type"
                value={editMealType}
                onChange={(e) => setEditMealType(e.target.value as MealType)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
              >
                <option value="breakfast">Breakfast</option>
                <option value="lunch">Lunch</option>
                <option value="dinner">Dinner</option>
                <option value="snack">Snack</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="edit-meal-foods" className="block text-xs font-medium text-slate-700">
                Food items (comma-separated)
              </label>
              <input
                id="edit-meal-foods"
                type="text"
                value={editFoodsText}
                onChange={(e) => setEditFoodsText(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="edit-meal-portions" className="block text-xs font-medium text-slate-700">
                Portion details
              </label>
              <input
                id="edit-meal-portions"
                type="text"
                maxLength={500}
                value={editPortions}
                onChange={(e) => setEditPortions(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label htmlFor="edit-cal" className="block text-xs font-medium text-slate-700">
                  Calories
                </label>
                <input
                  id="edit-cal"
                  type="number"
                  min={0}
                  max={10000}
                  value={editCalories}
                  onChange={(e) => setEditCalories(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="edit-prot" className="block text-xs font-medium text-slate-700">
                  Protein (g)
                </label>
                <input
                  id="edit-prot"
                  type="number"
                  min={0}
                  max={1000}
                  value={editProtein}
                  onChange={(e) => setEditProtein(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="edit-carbs" className="block text-xs font-medium text-slate-700">
                  Carbs (g)
                </label>
                <input
                  id="edit-carbs"
                  type="number"
                  min={0}
                  max={1000}
                  value={editCarbs}
                  onChange={(e) => setEditCarbs(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="edit-fat" className="block text-xs font-medium text-slate-700">
                  Fat (g)
                </label>
                <input
                  id="edit-fat"
                  type="number"
                  min={0}
                  max={1000}
                  value={editFat}
                  onChange={(e) => setEditFat(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingMeal(null)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isMutating}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-emerald-700 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
              >
                {isMutating ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
