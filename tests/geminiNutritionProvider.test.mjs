import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { GeminiNutritionProvider } from '../server/ai/geminiNutritionProvider.ts';

const originalFetch = globalThis.fetch;
const originalEnv = {
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GEMINI_FALLBACK_MODELS: process.env.GEMINI_FALLBACK_MODELS,
  GEMINI_USE_SEARCH: process.env.GEMINI_USE_SEARCH,
};
const originalConsole = {
  info: console.info,
  warn: console.warn,
};

let requests;
let responses;
let logs;

function successResponse({ text = validMealJson, groundingChunks } = {}) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text }] },
          ...(groundingChunks ? { groundingMetadata: { groundingChunks } } : {}),
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function errorResponse(status) {
  return new Response(
    JSON.stringify({
      error: {
        code: status,
        message: `Simulated ${status} response`,
        status: 'UNAVAILABLE',
      },
    }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
}

const validMealJson = JSON.stringify({
  foods: ['Oatmeal'],
  portions: '1 bowl',
  meal_type: 'breakfast',
  nutrition: { calories: 150, protein: 5, carbs: 27, fat: 3 },
  confidence: 0.9,
  assistant_summary: 'Logged oatmeal.',
});

function setup({ primary = 'gemini-primary', fallbacks = 'gemini-fallback', search = 'false' } = {}) {
  process.env.GEMINI_MODEL = primary;
  process.env.GEMINI_FALLBACK_MODELS = fallbacks;
  if (search === undefined) {
    delete process.env.GEMINI_USE_SEARCH;
  } else {
    process.env.GEMINI_USE_SEARCH = search;
  }

  requests = [];
  responses = [];
  logs = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(init.body),
    });
    const response = responses.shift();
    assert.ok(response, 'Unexpected Gemini API request');
    return response;
  };
  console.info = (...args) => logs.push(args.join(' '));
  console.warn = (...args) => logs.push(args.join(' '));
}

beforeEach(() => {
  setup();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
});

function makeProvider() {
  return new GeminiNutritionProvider('test-api-key');
}

function analyzeText(provider, overrides = {}) {
  return provider.analyzeTextMeal({
    message: 'I ate oatmeal',
    history: [{ role: 'user', content: 'Do not include this old turn' }],
    currentTimeIso: '2026-01-02T03:04:05.000Z',
    ...overrides,
  });
}

test('uses the primary model when it succeeds and logs the selected model', async () => {
  responses.push(successResponse());

  const analysis = await analyzeText(makeProvider());

  assert.deepEqual(analysis.foods, ['Oatmeal']);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /models\/gemini-primary:generateContent$/);
  assert.ok(logs.some((entry) => entry.includes('Requesting model "gemini-primary"')));
  assert.ok(logs.some((entry) => entry.includes('Model "gemini-primary" completed')));
});

test('moves immediately to the next model on HTTP 429', async () => {
  responses.push(errorResponse(429), successResponse());

  await analyzeText(makeProvider());

  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /models\/gemini-primary:generateContent$/);
  assert.match(requests[1].url, /models\/gemini-fallback:generateContent$/);
});

test('retries once on HTTP 503 before moving to the fallback model', async () => {
  responses.push(errorResponse(503), errorResponse(503), successResponse());

  await analyzeText(makeProvider());

  assert.equal(requests.length, 3);
  assert.match(requests[0].url, /models\/gemini-primary:generateContent$/);
  assert.match(requests[1].url, /models\/gemini-primary:generateContent$/);
  assert.match(requests[2].url, /models\/gemini-fallback:generateContent$/);
});

test('rethrows non-retryable errors without trying fallback models', async () => {
  responses.push(errorResponse(400));

  await assert.rejects(() => analyzeText(makeProvider()), /Simulated 400 response/);

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /models\/gemini-primary:generateContent$/);
});

test('tries a per-request model override before configured models', async () => {
  responses.push(successResponse());

  await analyzeText(makeProvider(), { model: 'gemini-request-override' });

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /models\/gemini-request-override:generateContent$/);
});

test('only enables Google Search when GEMINI_USE_SEARCH is exactly true', async () => {
  process.env.GEMINI_USE_SEARCH = 'true';
  responses.push(successResponse());
  await analyzeText(makeProvider());
  assert.deepEqual(requests[0].body.tools, [{ googleSearch: {} }]);

  setup({ search: 'TRUE' });
  responses.push(successResponse());
  await analyzeText(makeProvider());
  assert.equal(requests[0].body.tools, undefined);
});

test('includes thinking configuration only for Gemini 3 and 4 model names', async () => {
  process.env.GEMINI_MODEL = 'gemini-4-test';
  process.env.GEMINI_FALLBACK_MODELS = '';
  responses.push(successResponse());
  await analyzeText(makeProvider());
  assert.deepEqual(requests[0].body.generationConfig.thinkingConfig, {
    thinkingLevel: 'LOW',
  });

  setup({ primary: 'gemini-2.5-test', fallbacks: '' });
  responses.push(successResponse());
  await analyzeText(makeProvider());
  assert.equal(requests[0].body.generationConfig.thinkingConfig, undefined);
});

test('builds the prompt from the current message without chat history', async () => {
  responses.push(successResponse());

  await analyzeText(makeProvider());

  const prompt = requests[0].body.contents[0].parts[0].text;
  assert.match(prompt, /I ate oatmeal/);
  assert.doesNotMatch(prompt, /Do not include this old turn/);
});

test('uses the shared generator for image analysis and returns grounding URLs', async () => {
  const sourceUrl = 'https://example.test/food-source';
  responses.push(
    successResponse({
      groundingChunks: [{ web: { uri: sourceUrl, title: 'Food source' } }],
    })
  );

  const result = await makeProvider().analyzeFoodImage({
    imageBase64: 'aW1hZ2U=',
    mimeType: 'image/png',
    caption: 'Oatmeal',
    history: [],
    currentTimeIso: '2026-01-02T03:04:05.000Z',
  });

  assert.deepEqual(result.sources, [sourceUrl]);
  assert.match(requests[0].url, /models\/gemini-primary:generateContent$/);
  assert.equal(requests[0].body.contents[0].parts[0].inlineData.data, 'aW1hZ2U=');
});
