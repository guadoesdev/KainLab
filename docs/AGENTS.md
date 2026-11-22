# AGENTS.md — KainLab

Guidance for AI coding agents working in the **KainLab** repository.

---

## 1. Project Overview

**KainLab** is a full-stack conversational AI nutrition and food-photo tracking web application. Users log meals via natural-language chat or uploaded/captured photos in the **Today** workspace, review daily/weekly/monthly analytics and CSV exports in **Summary**, and customize calorie and macronutrient targets in **Profile**.

---

## 2. Tech Stack & Directory Structure

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4 (`@import "tailwindcss";` in `src/index.css`), `motion`, `lucide-react`
- **Backend:** Node.js 22, Express (`server.ts`), `tsx`, `multer` (multipart photo upload), `jose` (JWKS JWT verification)
- **AI Provider:** `@google/genai` (server-side only in `server/ai/geminiNutritionProvider.ts`)
- **Auth & Persistence:** Supabase Auth + PostgreSQL (`supabase/schema.sql`) when configured, with automatic local HMAC auth + in-memory storage fallback (`server/repositories/memoryNutritionStore.ts`) when Supabase env vars are unset

```text
/
├── server.ts                          # Express server + Vite middleware (dev) / static dist (prod) on port 3000
├── server/
│   ├── ai/
│   │   ├── provider.ts                # NutritionAIProvider interface
│   │   └── geminiNutritionProvider.ts # @google/genai text & image analysis + fallback model retry + optional search grounding
│   ├── middleware/
│   │   ├── auth.ts                    # Supabase JWKS/getUser JWT auth + local fallback auth (/api/auth/local/*)
│   │   └── rateLimit.ts               # Sliding-window AI rate limiter (25 req/min)
│   ├── repositories/
│   │   ├── mealRepository.ts          # MealRepository interface + InMemoryDailyLedgerRepository
│   │   ├── memoryNutritionStore.ts    # In-memory fallback store for profiles, meals, chats, summaries
│   │   └── supabaseNutritionRepository.ts # Supabase Postgres persistence via service role key
│   ├── services/
│   │   └── nutritionService.ts        # Validation, clamping, confidence >= 0.80 auto-log gate
│   └── types/
│       └── nutrition.ts               # Server domain types
├── src/
│   ├── App.tsx                        # Auth gate & session lifecycle
│   ├── components/                    # AuthFormPanel, TodayScreen, NutritionChatPanel, CameraCaptureModal,
│   │                                  # DailySummaryCard, CalorieTrendChart, MealHistoryList, SummaryPage, ProfilePage
│   ├── lib/
│   │   ├── supabaseAuth.ts            # Supabase browser auth client + local fallback session adapter
│   │   ├── nutritionRepository.ts     # Frontend API client for meals, chats, AI endpoints, history
│   │   ├── profileService.ts          # Profile sync & goal updates
│   │   ├── authHelpers.ts             # Validation, password strength, error mapping
│   │   ├── csvExport.ts               # Summary CSV export builder
│   │   └── storageBackend.ts          # /api/config/storage helper
│   └── types/
│       └── nutrition.ts               # Frontend domain types
├── supabase/schema.sql                # Postgres schema + RLS policies
├── tests/geminiNutritionProvider.test.mjs # node:test unit suite (mocked fetch)
├── firebase-applet-config.json        # Legacy/reference Firebase config (keep untouched unless migrating)
├── firestore.rules                    # Legacy/reference Firestore rules
└── vite.config.ts                     # Vite config (copies src/assets into dist/src/assets on build)
```

---

## 3. Commands

Always verify changes using these commands:

- **Install dependencies:** `npm install`
- **Run dev server (port 3000, `0.0.0.0`):** `npm run dev`
- **Type-check:** `npm run lint` (`tsc --noEmit`)
- **Build production bundle:** `npm run build` (`vite build`)
- **Run unit tests:** `npm test` (`tsx --test tests/*.test.mjs`)
- **Start production server:** `npm start` (`tsx server.ts` with `NODE_ENV=production`)

---

## 4. Key Architectural Patterns & Invariants

### Auth & Storage Dual-Mode Behavior
- **Supabase Mode (Production):** Active when `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are configured (and `DATABASE_PROVIDER !== 'firestore'`).
  - `server/middleware/auth.ts` verifies Bearer JWTs via Supabase JWKS (`jose`) with fallback to `client.auth.getUser(token)`.
  - `server/repositories/supabaseNutritionRepository.ts` writes server-side using `SUPABASE_SERVICE_ROLE_KEY`.
- **Local Preview Mode:** Automatically active when Supabase env vars are missing.
  - `server/middleware/auth.ts` exposes local HMAC-signed token auth (`/api/auth/local/signup`, `/api/auth/local/signin`, `/api/auth/local/google`) guarded off whenever Supabase is configured.
  - `server.ts` routes data operations to `memoryNutritionStore.ts`.
  - Keep both paths working—never break local preview mode or bypass real Supabase JWT verification when Supabase is configured.

### AI Nutrition Pipeline (`server/services/nutritionService.ts`)
- `GEMINI_API_KEY` must stay **strictly server-side** (never expose it in `VITE_*` variables or client bundles).
- `GeminiNutritionProvider` supports `GEMINI_MODEL` (default `gemini-4-hydrogen`), `GEMINI_FALLBACK_MODELS`, and `GEMINI_USE_SEARCH === 'true'`.
- Auto-logging gate: meals with valid foods and `confidence >= 0.80` set `meal_logged: true`; meals below `0.80` return a clarification question and `clarification_options` without logging yet.
- Image uploads (`POST /api/analyze-image`) are compressed client-side in `NutritionChatPanel.tsx` and capped at 8 MB (`JPEG`, `PNG`, `WebP`, `HEIC`, `HEIF`) via `multer`.

### Validation & Data Bounds
Preserve consistent bounds across frontend (`profileService.ts`, `nutritionRepository.ts`), server (`nutritionService.ts`, `supabaseNutritionRepository.ts`), and SQL (`supabase/schema.sql`):
- `dailyCalorieGoal`: `800..10000`
- `proteinGoal`: `20..500`, `carbsGoal`: `20..1000`, `fatGoal`: `10..400`
- `foods`: `1..20` trimmed strings (max 120 chars each)
- `calories`: `0..10000`; `protein`, `carbs`, `fat`: `0..1000`; `confidence`: `0..1`
- `dateKey`: `YYYY-MM-DD`
- `mealType`: `'breakfast' | 'lunch' | 'dinner' | 'snack'`

---

## 5. Environment Variables

Defined in `.env.example` (never commit `.env` or real secrets):
- `GEMINI_API_KEY` — Server-side Gemini API key (required for `/api/chat` and `/api/analyze-image`)
- `GEMINI_MODEL` — Primary model ID (default: `gemini-4-hydrogen`)
- `GEMINI_FALLBACK_MODELS` — Comma-separated fallback model IDs
- `GEMINI_USE_SEARCH` — Set to `'true'` to enable Google Search grounding
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — Supabase Auth & Postgres
- `DATABASE_PROVIDER` — Optional override (`supabase` or `firestore`)
- `APP_URL` — Public deployment URL

---

## 6. Conventions & Testing Rules

- **TypeScript:** Keep strict, top-level imports and no `tsc --noEmit` errors.
- **Styling:** Use Tailwind CSS v4 utility classes in components and design tokens in `src/index.css`. Honor `prefers-reduced-motion`.
- **Vite & Assets:** Do not remove the `copy-unbundled-src-assets` plugin or `DISABLE_HMR` handling in `vite.config.ts`. Server must bind to `0.0.0.0` on `PORT || 3000`.
- **Testing:** When modifying `server/ai/*` or `server/services/*`, run `npm test` and add unit tests in `tests/*.test.mjs` using `node:test` and mocked `globalThis.fetch` (do not make live Gemini API calls in unit tests).
