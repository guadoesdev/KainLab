import type { NutritionTotals, TodaySummaryRecord } from '../types/nutrition.ts';

export interface MealRepository {
  getTodaySummary(userId: string, dateKey: string): Promise<TodaySummaryRecord>;
  addMealTotals(
    userId: string,
    dateKey: string,
    nutrition: NutritionTotals
  ): Promise<TodaySummaryRecord>;
  replaceDailySummary(
    userId: string,
    dateKey: string,
    totals: NutritionTotals,
    dailyCalorieGoal: number
  ): Promise<TodaySummaryRecord>;
}

export class InMemoryDailyLedgerRepository implements MealRepository {
  private readonly store = new Map<string, TodaySummaryRecord>();

  private makeKey(userId: string, dateKey: string): string {
    return `${userId}::${dateKey}`;
  }

  async getTodaySummary(userId: string, dateKey: string): Promise<TodaySummaryRecord> {
    const key = this.makeKey(userId, dateKey);
    const existing = this.store.get(key);
    if (existing) {
      return existing;
    }
    const empty: TodaySummaryRecord = {
      dateKey,
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      daily_calorie_goal: 2000,
      remaining: 2000,
    };
    this.store.set(key, empty);
    return empty;
  }

  async addMealTotals(
    userId: string,
    dateKey: string,
    nutrition: NutritionTotals
  ): Promise<TodaySummaryRecord> {
    const current = await this.getTodaySummary(userId, dateKey);
    const calories = current.calories + nutrition.calories;
    const updated: TodaySummaryRecord = {
      dateKey,
      calories,
      protein: current.protein + nutrition.protein,
      carbs: current.carbs + nutrition.carbs,
      fat: current.fat + nutrition.fat,
      daily_calorie_goal: current.daily_calorie_goal,
      remaining: Math.max(0, current.daily_calorie_goal - calories),
    };
    this.store.set(this.makeKey(userId, dateKey), updated);
    return updated;
  }

  async replaceDailySummary(
    userId: string,
    dateKey: string,
    totals: NutritionTotals,
    dailyCalorieGoal: number
  ): Promise<TodaySummaryRecord> {
    const safeGoal = Math.min(10000, Math.max(800, Math.round(dailyCalorieGoal)));
    const calories = Math.max(0, Math.round(totals.calories));
    const updated: TodaySummaryRecord = {
      dateKey,
      calories,
      protein: Math.max(0, Math.round(totals.protein)),
      carbs: Math.max(0, Math.round(totals.carbs)),
      fat: Math.max(0, Math.round(totals.fat)),
      daily_calorie_goal: safeGoal,
      remaining: Math.max(0, safeGoal - calories),
    };
    this.store.set(this.makeKey(userId, dateKey), updated);
    return updated;
  }
}
