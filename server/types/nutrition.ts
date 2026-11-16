export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type MealSource = 'text' | 'image';

export interface NutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface ChatHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface MealAnalysisRaw {
  foods: string[];
  portions: string;
  meal_type: MealType;
  nutrition: NutritionTotals;
  confidence: number;
  clarification_question?: string;
  clarification_options?: string[];
  assistant_summary?: string;
  sources?: string[];
}

export interface ValidatedMealAnalysis {
  foods: string[];
  portions: string;
  meal_type: MealType;
  nutrition: NutritionTotals;
  confidence: number;
  meal_logged: boolean;
  reply: string;
  clarification_options: string[];
  sources: string[];
  source: MealSource;
}

export interface TodaySummaryRecord {
  dateKey: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  daily_calorie_goal: number;
  remaining: number;
}
