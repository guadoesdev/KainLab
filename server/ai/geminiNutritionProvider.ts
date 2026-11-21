import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type {
  ImageMealAnalysisInput,
  NutritionAIProvider,
  TextMealAnalysisInput,
} from './provider.ts';
import type { ChatHistoryTurn, MealAnalysisRaw, MealType } from '../types/nutrition.ts';

const SYSTEM_INSTRUCTION = `You are a nutrition analysis assistant. Analyze meal text or food photos, using reliable nutrition knowledge and available references (prefer USDA FoodData Central) when helpful. Output ONLY one JSON object matching this exact shape (no markdown commentary outside JSON):
{
  "foods": ["string"],
  "portions": "string",
  "meal_type": "breakfast" | "lunch" | "dinner" | "snack",
  "nutrition": { "calories": number, "protein": number, "carbs": number, "fat": number },
  "confidence": number,
  "clarification_question": "string (when confidence < 0.80)",
  "clarification_options": ["string"],
  "assistant_summary": "string (when confidence >= 0.80)"
}`;

function extractJsonObject(rawText: string): MealAnalysisRaw {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('AI response did not contain structured nutrition JSON.');
  }

  const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as Partial<MealAnalysisRaw>;
  const validMealTypes: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
  const mealType: MealType = validMealTypes.includes(parsed.meal_type as MealType)
    ? (parsed.meal_type as MealType)
    : 'snack';

  return {
    foods: Array.isArray(parsed.foods) ? parsed.foods.map(String) : [],
    portions: typeof parsed.portions === 'string' ? parsed.portions : '',
    meal_type: mealType,
    nutrition: {
      calories: Number(parsed.nutrition?.calories ?? 0),
      protein: Number(parsed.nutrition?.protein ?? 0),
      carbs: Number(parsed.nutrition?.carbs ?? 0),
      fat: Number(parsed.nutrition?.fat ?? 0),
    },
    confidence: Number(parsed.confidence ?? 0.5),
    clarification_question:
      typeof parsed.clarification_question === 'string'
        ? parsed.clarification_question
        : undefined,
    clarification_options: Array.isArray(parsed.clarification_options)
      ? parsed.clarification_options.map(String)
      : undefined,
    assistant_summary:
      typeof parsed.assistant_summary === 'string' ? parsed.assistant_summary : undefined,
    sources: [],
  };
}

function extractGroundingUrls(
  chunks: Array<{ web?: { uri?: string; title?: string } }> | undefined
): string[] {
  if (!Array.isArray(chunks)) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const chunk of chunks) {
    const uri = chunk?.web?.uri;
    if (uri && (uri.startsWith('https://') || uri.startsWith('http://')) && !seen.has(uri)) {
      seen.add(uri);
      urls.push(uri.slice(0, 300));
      if (urls.length >= 5) break;
    }
  }
  return urls;
}

function formatHistoryContext(history: ChatHistoryTurn[]): string {
  if (!history.length) return 'No prior turns in this conversation.';
  return history
    .slice(-6)
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`)
    .join('\n');
}

export class GeminiNutritionProvider implements NutritionAIProvider {
  public readonly providerName = 'gemini';
  private readonly model: string;
  private readonly useGoogleSearch: boolean;
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string, model = process.env.GEMINI_MODEL?.trim() || 'gemini-4-hydrogen') {
    this.model = model.trim() || 'gemini-4-hydrogen';
    this.useGoogleSearch = process.env.GEMINI_USE_SEARCH?.trim().toLowerCase() !== 'false';
    this.ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  async analyzeTextMeal(input: TextMealAnalysisInput): Promise<MealAnalysisRaw> {
    const prompt = [
      `Current local timestamp: ${input.currentTimeIso}`,
      //'Recent conversation context:',
      //formatHistoryContext(input.history),
      //'',
      `Latest user message: "${input.message}"`,
      this.useGoogleSearch
        ? 'Use Google Search to check USDA FoodData Central / trusted nutrition figures when helpful, then respond with JSON only.'
        : 'Use your nutrition knowledge and respond with JSON only.',
    ].join('\n');

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        ...(this.useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}),
        ...(/^gemini-[34]/i.test(this.model)
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : {}),
      },
    });

    const parsed = extractJsonObject(response.text ?? '');
    const sources = extractGroundingUrls(
      response.candidates?.[0]?.groundingMetadata?.groundingChunks
    );
    return { ...parsed, sources };
  }

  async analyzeFoodImage(input: ImageMealAnalysisInput): Promise<MealAnalysisRaw> {
    const prompt = [
      `Current local timestamp: ${input.currentTimeIso}`,
      //  'Recent conversation context:',
      //  formatHistoryContext(input.history),
      input.caption
        ? `User note with photo: "${input.caption}"`
        : 'User uploaded a food photo for meal logging.',
      this.useGoogleSearch
        ? 'Identify the foods visible in the image, estimate realistic portions, research USDA FoodData Central / trusted nutrition data via Google Search if needed, and return JSON only.'
        : 'Identify the foods visible in the image, estimate realistic portions, and return JSON only.',
    ].join('\n');

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: input.mimeType,
              data: input.imageBase64,
            },
          },
          { text: prompt },
        ],
      },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        ...(this.useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}),
        ...(/^gemini-[34]/i.test(this.model)
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : {}),
      },
    });

    const parsed = extractJsonObject(response.text ?? '');
    const sources = extractGroundingUrls(
      response.candidates?.[0]?.groundingMetadata?.groundingChunks
    );
    return { ...parsed, sources };
  }
}
