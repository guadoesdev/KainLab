import type { MealEntry, MealType, NutritionTotals } from '../types/nutrition';

export interface DailySummaryCsvBucket {
  dateKey: string;
  fullLabel: string;
  meals: MealEntry[];
  totals: NutritionTotals;
}

export interface DailySummaryCsvGoals {
  dailyCalorieGoal: number;
  proteinGoal: number;
  carbsGoal: number;
  fatGoal: number;
}

const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: string | number): string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '0';
  }

  let safe = String(value ?? '');
  if (FORMULA_PREFIX_RE.test(safe)) {
    safe = `'${safe}`;
  }

  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function formatMealSummaryList(
  meals: MealEntry[],
  mealLabels: Record<MealType, string>
): string {
  if (meals.length === 0) {
    return '';
  }

  return meals
    .map((meal) => {
      const label = mealLabels[meal.mealType] ?? meal.mealType;
      const foods = meal.foods.length > 0 ? meal.foods.join(', ') : 'Meal';
      return `${label}: ${foods} (${Math.round(meal.calories)} kcal)`;
    })
    .join(' | ');
}

export function buildDailySummaryCsv(
  buckets: DailySummaryCsvBucket[],
  goals: DailySummaryCsvGoals,
  mealLabels: Record<MealType, string>
): string {
  const headers = [
    'Date',
    'Day',
    'Meals Logged',
    'Calories (kcal)',
    'Calorie Goal (kcal)',
    'Remaining Calories (kcal)',
    'Protein (g)',
    'Protein Goal (g)',
    'Carbs (g)',
    'Carbs Goal (g)',
    'Fat (g)',
    'Fat Goal (g)',
    'Logged Meals',
  ];

  const rows = buckets.map((bucket) => {
    const calories = Math.round(bucket.totals.calories);
    const protein = Math.round(bucket.totals.protein);
    const carbs = Math.round(bucket.totals.carbs);
    const fat = Math.round(bucket.totals.fat);
    const remainingCalories = Math.round(goals.dailyCalorieGoal) - calories;

    const cells: Array<string | number> = [
      bucket.dateKey,
      bucket.fullLabel,
      bucket.meals.length,
      calories,
      Math.round(goals.dailyCalorieGoal),
      remainingCalories,
      protein,
      Math.round(goals.proteinGoal),
      carbs,
      Math.round(goals.carbsGoal),
      fat,
      Math.round(goals.fatGoal),
      formatMealSummaryList(bucket.meals, mealLabels),
    ];

    return cells.map(escapeCsvCell).join(',');
  });

  return [headers.map(escapeCsvCell).join(','), ...rows].join('\r\n');
}

export function downloadCsvFile(filename: string, csvContent: string): void {
  const blob = new Blob([`\uFEFF${csvContent}`], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
