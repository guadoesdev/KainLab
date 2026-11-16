import type { NutritionAIProvider } from '../ai/provider.ts';
import type {
  ChatHistoryTurn,
  MealAnalysisRaw,
  MealSource,
  MealType,
  ValidatedMealAnalysis,
} from '../types/nutrition.ts';

const CONFIDENCE_AUTO_LOG_THRESHOLD = 0.8;

function clampNumber(value: number, min: number, max: number, round = true): number {
  if (!Number.isFinite(value)) return min;
  const clamped = Math.min(max, Math.max(min, value));
  return round ? Math.round(clamped) : Number(clamped.toFixed(2));
}

function inferMealTypeFromIso(iso: string): MealType {
  const parsed = new Date(iso);
  const hour = Number.isNaN(parsed.getTime()) ? 12 : parsed.getHours();
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 17 && hour < 22) return 'dinner';
  return 'snack';
}

function validateAndNormalizeAnalysis(
  raw: MealAnalysisRaw,
  source: MealSource,
  currentTimeIso: string
): ValidatedMealAnalysis {
  const foods = (raw.foods || [])
    .map((item) => item.trim().slice(0, 120))
    .filter((item) => item.length > 0)
    .slice(0, 20);

  const confidence = clampNumber(raw.confidence, 0, 1, false);
  const validMealTypes: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
  const mealType: MealType = validMealTypes.includes(raw.meal_type)
    ? raw.meal_type
    : inferMealTypeFromIso(currentTimeIso);

  const calories = clampNumber(raw.nutrition.calories, 0, 10000, true);
  const protein = clampNumber(raw.nutrition.protein, 0, 1000, true);
  const carbs = clampNumber(raw.nutrition.carbs, 0, 1000, true);
  const fat = clampNumber(raw.nutrition.fat, 0, 1000, true);

  const portions =
    raw.portions && raw.portions.trim().length > 0
      ? raw.portions.trim().slice(0, 500)
      : foods.join(', ') || 'Standard single serving';

  const sources = (raw.sources || [])
    .map((u) => u.trim().slice(0, 300))
    .filter((u) => u.startsWith('http'))
    .slice(0, 5);

  const clarificationOptions = (raw.clarification_options || [])
    .map((opt) => opt.trim().slice(0, 80))
    .filter((opt) => opt.length > 0)
    .slice(0, 6);

  const hasValidFoods = foods.length > 0;
  const shouldLog = hasValidFoods && confidence >= CONFIDENCE_AUTO_LOG_THRESHOLD;

  if (shouldLog) {
    const bulletLines = foods.map((f) => `- ${f}`).join('\n');
    const defaultSummary = `Logged:\n${bulletLines}\n\nCalories: ${calories}\nProtein: ${protein}g`;
    return {
      foods,
      portions,
      meal_type: mealType,
      nutrition: { calories, protein, carbs, fat },
      confidence,
      meal_logged: true,
      reply:
        raw.assistant_summary && raw.assistant_summary.trim().length > 0
          ? raw.assistant_summary.trim().slice(0, 2000)
          : defaultSummary,
      clarification_options: [],
      sources,
      source,
    };
  }

  const options =
    clarificationOptions.length >= 2
      ? clarificationOptions
      : ['Small portion', 'Standard portion', 'Large portion', 'Other'];

  const fallbackQuestion =
    source === 'image'
      ? 'I spotted a few possible items in your photo. Could you clarify what dish or portion size this is before I log it?'
      : 'Could you clarify the ingredients or preparation style before I log this meal?';

  return {
    foods: hasValidFoods ? foods : ['Unconfirmed Meal'],
    portions,
    meal_type: mealType,
    nutrition: { calories, protein, carbs, fat },
    confidence,
    meal_logged: false,
    reply:
      raw.clarification_question && raw.clarification_question.trim().length > 0
        ? raw.clarification_question.trim().slice(0, 1200)
        : fallbackQuestion,
    clarification_options: options,
    sources,
    source,
  };
}

export class NutritionService {
  private readonly provider: NutritionAIProvider;

  constructor(provider: NutritionAIProvider) {
    this.provider = provider;
  }

  async processTextMeal(
    message: string,
    history: ChatHistoryTurn[],
    currentTimeIso: string
  ): Promise<ValidatedMealAnalysis> {
    const trimmed = message.trim();
    if (!trimmed) {
      throw new Error('Meal message cannot be empty.');
    }

    const raw = await this.provider.analyzeTextMeal({
      message: trimmed,
      history,
      currentTimeIso,
    });

    return validateAndNormalizeAnalysis(raw, 'text', currentTimeIso);
  }

  async processImageMeal(
    imageBase64: string,
    mimeType: string,
    caption: string | undefined,
    history: ChatHistoryTurn[],
    currentTimeIso: string
  ): Promise<ValidatedMealAnalysis> {
    if (!imageBase64) {
      throw new Error('Food image data is required.');
    }

    const raw = await this.provider.analyzeFoodImage({
      imageBase64,
      mimeType,
      caption,
      history,
      currentTimeIso,
    });

    return validateAndNormalizeAnalysis(raw, 'image', currentTimeIso);
  }
}
