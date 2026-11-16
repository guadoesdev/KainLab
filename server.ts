import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { GeminiNutritionProvider } from './server/ai/geminiNutritionProvider.ts';
import { NutritionService } from './server/services/nutritionService.ts';
import { InMemoryDailyLedgerRepository, type MealRepository } from './server/repositories/mealRepository.ts';
import {
  clearChatMessagesInSupabase,
  createMealInSupabase,
  deleteMealInSupabase,
  getSevenDayCaloriesInSupabase,
  isSupabaseConfigured,
  listChatMessagesInSupabase,
  listMealsInSupabase,
  listMealsRangeInSupabase,
  saveChatMessageInSupabase,
  SupabaseDailyLedgerRepository,
  syncProfileInSupabase,
  updateCalorieGoalInSupabase,
  updateMealInSupabase,
  updateNutritionGoalsInSupabase,
} from './server/repositories/supabaseNutritionRepository.ts';
import {
  clearChatMessagesInMemory,
  createMealInMemory,
  deleteMealInMemory,
  getSevenDayCaloriesInMemory,
  listChatMessagesInMemory,
  listMealsInMemory,
  listMealsRangeInMemory,
  saveChatMessageInMemory,
  syncProfileInMemory,
  updateCalorieGoalInMemory,
  updateMealInMemory,
  updateNutritionGoalsInMemory,
} from './server/repositories/memoryNutritionStore.ts';
import {
  getSupabasePublicConfig,
  requireSupabaseJwt,
  type AuthenticatedRequest,
} from './server/middleware/auth.ts';
import { createAiRateLimiter } from './server/middleware/rateLimit.ts';
import type { ChatHistoryTurn, MealSource, MealType } from './server/types/nutrition.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024, // 8 MB max upload
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIMES.has(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported image format. Please upload JPEG, PNG, or WebP.'));
    }
  },
});

const useSupabase = isSupabaseConfigured();
const mealRepository: MealRepository = useSupabase
  ? new SupabaseDailyLedgerRepository()
  : new InMemoryDailyLedgerRepository();

function getNutritionService(): NutritionService {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in server environment.');
  }
  const model = process.env.GEMINI_MODEL?.trim() || undefined;
  const provider = new GeminiNutritionProvider(apiKey, model);
  return new NutritionService(provider);
}

function getLocalDateKey(inputDateKey?: unknown): string {
  if (typeof inputDateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(inputDateKey)) {
    return inputDateKey;
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function sanitizeHistory(raw: unknown): ChatHistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatHistoryTurn[] = [];
  for (const item of raw.slice(-8)) {
    if (
      typeof item === 'object' &&
      item !== null &&
      'role' in item &&
      'content' in item &&
      (item.role === 'user' || item.role === 'assistant') &&
      typeof item.content === 'string'
    ) {
      turns.push({
        role: item.role,
        content: item.content.slice(0, 1000),
      });
    }
  }
  return turns;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const aiRateLimiter = createAiRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 25,
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'kainlab', timestamp: new Date().toISOString() });
  });

  app.get('/api/config/auth', (_req: Request, res: Response) => {
    res.json({
      provider: 'supabase',
      ...getSupabasePublicConfig(),
    });
  });

  app.get('/api/config/storage', (_req: Request, res: Response) => {
    res.json({ provider: useSupabase ? 'supabase' : 'memory' });
  });

  app.post('/api/profile/sync', requireSupabaseJwt, async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const payload = {
      uid,
      email: req.authUser?.email || (typeof req.body?.email === 'string' ? req.body.email : undefined),
      displayName: typeof req.body?.displayName === 'string' ? req.body.displayName : undefined,
      photoURL: typeof req.body?.photoURL === 'string' ? req.body.photoURL : undefined,
      provider: (req.body?.provider === 'google.com' ? 'google.com' : 'password') as
        | 'google.com'
        | 'password',
      preferredUsername:
        typeof req.body?.preferredUsername === 'string' ? req.body.preferredUsername : undefined,
    };
    try {
      const profile = useSupabase
        ? await syncProfileInSupabase(payload)
        : syncProfileInMemory(payload);
      res.json(profile);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to sync profile.',
      });
    }
  });

  app.patch('/api/profile/goal', requireSupabaseJwt, async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const goal = Number(req.body?.dailyCalorieGoal ?? 2000);
    try {
      const dailyCalorieGoal = useSupabase
        ? await updateCalorieGoalInSupabase(uid, goal)
        : updateCalorieGoalInMemory(uid, goal);
      res.json({ dailyCalorieGoal });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to update calorie goal.',
      });
    }
  });

  app.patch('/api/profile/goals', requireSupabaseJwt, async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const goalsPayload = {
      displayName: typeof req.body?.displayName === 'string' ? req.body.displayName : undefined,
      dailyCalorieGoal: Number(req.body?.dailyCalorieGoal ?? 2000),
      proteinGoal: Number(req.body?.proteinGoal ?? 150),
      carbsGoal: Number(req.body?.carbsGoal ?? 225),
      fatGoal: Number(req.body?.fatGoal ?? 56),
    };
    try {
      const updated = useSupabase
        ? await updateNutritionGoalsInSupabase(uid, goalsPayload)
        : updateNutritionGoalsInMemory(uid, goalsPayload);
      res.json(updated);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to update nutrition goals.',
      });
    }
  });

  app.get('/api/meals-range', requireSupabaseJwt, async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const startDateKey = typeof req.query?.startDateKey === 'string' ? req.query.startDateKey.trim() : '';
    const endDateKey = typeof req.query?.endDateKey === 'string' ? req.query.endDateKey.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateKey) || !/^\d{4}-\d{2}-\d{2}$/.test(endDateKey)) {
      res.status(400).json({ error: 'Provide valid startDateKey and endDateKey in YYYY-MM-DD format.' });
      return;
    }
    try {
      const meals = useSupabase
        ? await listMealsRangeInSupabase(uid, startDateKey, endDateKey)
        : listMealsRangeInMemory(uid, startDateKey, endDateKey);
      res.json({ meals });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to load meals range.',
      });
    }
  });

  app.get('/api/meals', requireSupabaseJwt, async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const dateKey = getLocalDateKey(req.query?.dateKey);
    try {
      const meals = useSupabase
        ? await listMealsInSupabase(uid, dateKey)
        : listMealsInMemory(uid, dateKey);
      res.json({ meals });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to load meals.',
      });
    }
  });

  app.post('/api/meals', requireSupabaseJwt, async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const allowedMealTypes = new Set<MealType>(['breakfast', 'lunch', 'dinner', 'snack']);
    const rawMealType = req.body?.mealType;
    const mealType: MealType = allowedMealTypes.has(rawMealType) ? rawMealType : 'snack';
    const source: MealSource = req.body?.source === 'image' ? 'image' : 'text';
    const mealPayload = {
      id: typeof req.body?.id === 'string' && req.body.id ? req.body.id : `meal_${Date.now()}`,
      dateKey: getLocalDateKey(req.body?.dateKey),
      mealType,
      foods: Array.isArray(req.body?.foods) ? req.body.foods.map(String) : [],
      portions: typeof req.body?.portions === 'string' ? req.body.portions : '',
      calories: Number(req.body?.calories ?? 0),
      protein: Number(req.body?.protein ?? 0),
      carbs: Number(req.body?.carbs ?? 0),
      fat: Number(req.body?.fat ?? 0),
      confidence: Number(req.body?.confidence ?? 0.9),
      source,
      sources: Array.isArray(req.body?.sources) ? req.body.sources.map(String) : [],
    };
    try {
      const meal = useSupabase
        ? await createMealInSupabase(uid, mealPayload)
        : createMealInMemory(uid, mealPayload);
      res.status(201).json({ meal });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Unable to save meal.',
      });
    }
  });

  app.patch('/api/meals/:id', requireSupabaseJwt, async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const allowedMealTypes = new Set<MealType>(['breakfast', 'lunch', 'dinner', 'snack']);
    const rawMealType = req.body?.mealType;
    const mealType: MealType = allowedMealTypes.has(rawMealType) ? rawMealType : 'lunch';
    const updates = {
      mealType,
      foods: Array.isArray(req.body?.foods) ? req.body.foods.map(String) : [],
      portions: typeof req.body?.portions === 'string' ? req.body.portions : '',
      calories: Number(req.body?.calories ?? 0),
      protein: Number(req.body?.protein ?? 0),
      carbs: Number(req.body?.carbs ?? 0),
      fat: Number(req.body?.fat ?? 0),
    };
    try {
      if (useSupabase) {
        await updateMealInSupabase(uid, String(req.params.id), updates);
      } else {
        updateMealInMemory(uid, String(req.params.id), updates);
      }
      res.json({ updated: true });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Unable to update meal.',
      });
    }
  });

  app.delete('/api/meals/:id', requireSupabaseJwt, async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      if (useSupabase) {
        await deleteMealInSupabase(uid, String(req.params.id));
      } else {
        deleteMealInMemory(uid, String(req.params.id));
      }
      res.json({ deleted: true });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to delete meal.',
      });
    }
  });

  app.get('/api/chat-messages', requireSupabaseJwt, async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const dateKey = getLocalDateKey(req.query?.dateKey);
    try {
      const messages = useSupabase
        ? await listChatMessagesInSupabase(uid, dateKey)
        : listChatMessagesInMemory(uid, dateKey);
      res.json({ messages });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to load chat messages.',
      });
    }
  });

  app.post('/api/chat-messages', requireSupabaseJwt, async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const chatPayload = {
      id: typeof req.body?.id === 'string' && req.body.id ? req.body.id : `msg_${Date.now()}`,
      dateKey: getLocalDateKey(req.body?.dateKey),
      role: (req.body?.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: typeof req.body?.content === 'string' ? req.body.content : '...',
      mealId: typeof req.body?.mealId === 'string' ? req.body.mealId : undefined,
      confidence: typeof req.body?.confidence === 'number' ? req.body.confidence : undefined,
      clarificationOptions: Array.isArray(req.body?.clarificationOptions)
        ? req.body.clarificationOptions.map(String)
        : undefined,
      sources: Array.isArray(req.body?.sources) ? req.body.sources.map(String) : undefined,
      nutritionSnapshot:
        req.body?.nutritionSnapshot && typeof req.body.nutritionSnapshot === 'object'
          ? {
              calories: Number(req.body.nutritionSnapshot.calories ?? 0),
              protein: Number(req.body.nutritionSnapshot.protein ?? 0),
              carbs: Number(req.body.nutritionSnapshot.carbs ?? 0),
              fat: Number(req.body.nutritionSnapshot.fat ?? 0),
            }
          : undefined,
      hasImage: Boolean(req.body?.hasImage),
    };
    try {
      const message = useSupabase
        ? await saveChatMessageInSupabase(uid, chatPayload)
        : saveChatMessageInMemory(uid, chatPayload);
      res.status(201).json({ message });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Unable to save chat message.',
      });
    }
  });

  app.delete('/api/chat-messages', requireSupabaseJwt, async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const dateKey = getLocalDateKey(req.query?.dateKey);
    try {
      if (useSupabase) {
        await clearChatMessagesInSupabase(uid, dateKey);
      } else {
        clearChatMessagesInMemory(uid, dateKey);
      }
      res.json({ cleared: true });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to clear chat messages.',
      });
    }
  });

  app.get('/api/calories-history', requireSupabaseJwt, async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const rawKeys = typeof req.query?.dateKeys === 'string' ? req.query.dateKeys : '';
    const dateKeys = rawKeys
      .split(',')
      .map((k) => k.trim())
      .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
      .slice(0, 14);

    if (dateKeys.length === 0) {
      res.status(400).json({ error: 'Provide at least one valid YYYY-MM-DD date key.' });
      return;
    }

    try {
      const totalsByDate = useSupabase
        ? await getSevenDayCaloriesInSupabase(uid, dateKeys)
        : getSevenDayCaloriesInMemory(uid, dateKeys);
      res.json({ totalsByDate });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to load calorie history.',
      });
    }
  });

  const handleChat = async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message || message.length > 2000) {
      res.status(400).json({ error: 'Message must be between 1 and 2000 characters.' });
      return;
    }

    const history = sanitizeHistory(req.body?.history);
    const currentTimeIso =
      typeof req.body?.currentTimeIso === 'string'
        ? req.body.currentTimeIso
        : new Date().toISOString();
    const dateKey = getLocalDateKey(req.body?.dateKey);

    try {
      const nutritionService = getNutritionService();
      const result = await nutritionService.processTextMeal(message, history, currentTimeIso);

      if (result.meal_logged) {
        await mealRepository.addMealTotals(uid, dateKey, result.nutrition);
      }

      res.json(result);
    } catch (error) {
      console.error('Chat meal analysis failed:', error);
      res.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : 'Unable to analyze meal right now. Please try again.',
      });
    }
  };

  app.post('/api/chat', requireSupabaseJwt, aiRateLimiter, handleChat);
  app.post('/chat', requireSupabaseJwt, aiRateLimiter, handleChat);

  const handleAnalyzeImage = async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    let imageBase64 = '';
    let mimeType = 'image/jpeg';

    if (req.file) {
      imageBase64 = req.file.buffer.toString('base64');
      mimeType = req.file.mimetype;
    } else if (typeof req.body?.imageBase64 === 'string') {
      const rawData = req.body.imageBase64.trim();
      const dataUrlMatch = rawData.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (dataUrlMatch) {
        mimeType = dataUrlMatch[1];
        imageBase64 = dataUrlMatch[2];
      } else {
        imageBase64 = rawData;
        if (typeof req.body?.mimeType === 'string') {
          mimeType = req.body.mimeType;
        }
      }
    }

    if (!imageBase64) {
      res.status(400).json({ error: 'Please attach a food image for analysis.' });
      return;
    }

    if (!ALLOWED_IMAGE_MIMES.has(mimeType.toLowerCase())) {
      res.status(400).json({ error: 'Unsupported image format. Use JPEG, PNG, or WebP.' });
      return;
    }

    let history: ChatHistoryTurn[] = [];
    if (typeof req.body?.history === 'string') {
      try {
        history = sanitizeHistory(JSON.parse(req.body.history));
      } catch {
        history = [];
      }
    } else {
      history = sanitizeHistory(req.body?.history);
    }

    const caption =
      typeof req.body?.caption === 'string' ? req.body.caption.trim().slice(0, 500) : undefined;
    const currentTimeIso =
      typeof req.body?.currentTimeIso === 'string'
        ? req.body.currentTimeIso
        : new Date().toISOString();
    const dateKey = getLocalDateKey(req.body?.dateKey);

    try {
      const nutritionService = getNutritionService();
      const result = await nutritionService.processImageMeal(
        imageBase64,
        mimeType,
        caption,
        history,
        currentTimeIso
      );

      if (result.meal_logged) {
        await mealRepository.addMealTotals(uid, dateKey, result.nutrition);
      }

      res.json(result);
    } catch (error) {
      console.error('Image meal analysis failed:', error);
      res.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : 'Unable to analyze this photo right now. Please try again.',
      });
    }
  };

  app.post(
    '/api/analyze-image',
    requireSupabaseJwt,
    aiRateLimiter,
    upload.single('image'),
    handleAnalyzeImage
  );
  app.post(
    '/analyze-image',
    requireSupabaseJwt,
    aiRateLimiter,
    upload.single('image'),
    handleAnalyzeImage
  );

  const handleGetSummary = async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const dateKey = getLocalDateKey(req.query?.dateKey);
    const summary = await mealRepository.getTodaySummary(uid, dateKey);
    res.json(summary);
  };

  app.get('/api/today-summary', requireSupabaseJwt, handleGetSummary);
  app.get('/today-summary', requireSupabaseJwt, handleGetSummary);

  app.post('/api/today-summary/sync', requireSupabaseJwt, async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const dateKey = getLocalDateKey(req.body?.dateKey);
    const summary = await mealRepository.replaceDailySummary(
      uid,
      dateKey,
      {
        calories: Number(req.body?.calories ?? 0),
        protein: Number(req.body?.protein ?? 0),
        carbs: Number(req.body?.carbs ?? 0),
        fat: Number(req.body?.fat ?? 0),
      },
      Number(req.body?.daily_calorie_goal ?? 2000)
    );
    res.json(summary);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`KainLab server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
