import type { Timestamp } from 'firebase/firestore';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type MealSource = 'text' | 'image';

export interface NutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface MealEntry {
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
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}

export interface ChatMessageItem {
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
  localImagePreview?: string;
  timestamp?: Timestamp | Date;
}

export interface NutritionAnalysisResponse {
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

export interface DailyCaloriePoint {
  dateKey: string;
  shortLabel: string;
  fullLabel: string;
  calories: number;
  isToday: boolean;
}
