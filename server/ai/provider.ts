import type { ChatHistoryTurn, MealAnalysisRaw } from '../types/nutrition.ts';

export interface TextMealAnalysisInput {
  message: string;
  history: ChatHistoryTurn[];
  currentTimeIso: string;
}

export interface ImageMealAnalysisInput {
  imageBase64: string;
  mimeType: string;
  caption?: string;
  history: ChatHistoryTurn[];
  currentTimeIso: string;
}

export interface NutritionAIProvider {
  readonly providerName: string;
  analyzeTextMeal(input: TextMealAnalysisInput): Promise<MealAnalysisRaw>;
  analyzeFoodImage(input: ImageMealAnalysisInput): Promise<MealAnalysisRaw>;
}
