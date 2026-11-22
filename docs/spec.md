# KainLab Product and Technical Specification

## 1. Purpose

KainLab is a web application for tracking meals and nutrition. Users can describe a meal in text or upload a food image for AI-assisted food and portion estimates. The application records meals, tracks daily nutrition goals, and presents historical summaries.

## 2. Users and Authentication

- Users can register and sign in with Supabase Auth, including email/password and Google OAuth.
- Password recovery and email verification are supported.
- Authenticated API requests use a Supabase JWT.
- User profile synchronization and cloud persistence require a verified email. Unverified users may use the app with the configured in-memory storage behavior.
- Each user's profile, meals, chat messages, and summaries must remain scoped to that user.

## 3. User-Facing Features

### 3.1 Today

- Display daily calories and macronutrients against the user's goals.
- Show meal history for the selected day.
- Allow creating, editing, and deleting meal entries.
- Provide a conversational nutrition assistant for meal descriptions and food images.
- Automatically save AI-analyzed meals when the response contains foods and has confidence of at least `0.8`.
- For lower-confidence responses, ask the user to clarify rather than automatically logging the meal.
- Display source links when the AI response includes valid grounding URLs.

### 3.2 Summary

- Show calorie history and trends over recent days.
- Support summary views for longer reporting periods.
- Allow exporting meal data as CSV.

### 3.3 Profile

- Store profile and nutrition-goal settings.
- Support daily calorie, protein, carbohydrate, and fat targets.

## 4. AI Nutrition Analysis

- The AI provider is Google Gemini, called only from the Express server.
- Text prompts contain the current message and timestamp; chat history is not included in the Gemini prompt.
- Image analysis accepts an uploaded image and optional caption.
- AI output is parsed as structured JSON, normalized, and validated before it is returned or persisted.
- Nutrition values are bounded and normalized by the nutrition service.
- Google Search grounding is included only when `GEMINI_USE_SEARCH` is exactly `true`.
- The primary model is configured by `GEMINI_MODEL` (default: `gemini-4-hydrogen`).
- Fallback model IDs are configured as a comma-separated `GEMINI_FALLBACK_MODELS` list.
- A per-request model override, when supplied, is tried before the configured model list.
- On HTTP 429, the provider immediately tries the next model. On HTTP 500, 503, or 504, it retries that model once before continuing. Other errors are rethrown.
- Gemini HTTP requests have a 30-second timeout.
- `thinkingConfig` is sent only for model IDs matching `/^gemini-[34]/`.

## 5. Data and Persistence

Core records include:

- **Profile**: user settings and nutrition goals.
- **Meal**: date, meal type, foods, portions, nutrition totals, confidence, source type, and optional source URLs.
- **Chat message**: role, content, timestamp, and optional meal/image metadata.
- **Daily summary**: daily calorie and macro totals and goal values.

Supabase PostgreSQL is the configured cloud persistence provider. An in-memory implementation is available for local or unconfigured operation. Meal totals and summary data must remain consistent with the user's meal records.

## 6. HTTP API

All user-specific API routes require Supabase JWT authentication unless noted.

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Service health status |
| `GET /api/config/auth` | Public authentication configuration status |
| `GET /api/config/storage` | Active storage provider |
| `POST /api/profile/sync` | Synchronize the verified user's profile |
| `PATCH /api/profile/goal` | Update calorie goal |
| `PATCH /api/profile/goals` | Update nutrition goals |
| `GET /api/meals`, `POST /api/meals` | List or create meals |
| `PATCH /api/meals/:id`, `DELETE /api/meals/:id` | Update or remove a meal |
| `GET /api/meals-range` | List meals across a date range |
| `GET /api/chat-messages`, `POST /api/chat-messages`, `DELETE /api/chat-messages` | Read, save, or clear chat history |
| `POST /api/chat` | Analyze a text meal |
| `POST /api/analyze-image` | Analyze an uploaded food image |
| `GET /api/calories-history` | Retrieve calorie history |
| `GET /api/today-summary` | Retrieve daily nutrition summary |
| `POST /api/today-summary/sync` | Synchronize daily summary data |

AI analysis routes are rate-limited. Image uploads are limited to 8 MB and accepted image MIME types.

## 7. Configuration

Required or supported server environment variables:

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Server-side Gemini API key |
| `GEMINI_MODEL` | Primary Gemini model |
| `GEMINI_FALLBACK_MODELS` | Optional comma-separated fallback models |
| `GEMINI_USE_SEARCH` | Enable Search grounding only when exactly `true` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Client-safe Supabase Auth key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service key |
| `DATABASE_PROVIDER` | Persistence provider selection |
| `APP_URL` | Public application URL |
| `PORT` | HTTP server port; defaults to `3000` |

Local development loads `.env` through `dotenv/config`. Secrets must not be committed to source control or exposed to the browser.

## 8. Technology and Runtime

- Frontend: React, TypeScript, Vite, Tailwind CSS.
- Backend: Node.js and Express.
- Authentication and cloud persistence: Supabase.
- AI integration: `@google/genai`.
- Runtime requirement: Node.js `22.14.0` or newer.
- Production deployment: Render Blueprint or equivalent Node.js hosting.

## 9. Quality and Security Requirements

- Validate request data before processing or persistence.
- Authenticate and authorize all user-specific API operations.
- Never expose Gemini or Supabase service-role credentials to client code.
- Apply ownership boundaries to profile, meal, chat, and summary records.
- Return explicit errors for invalid, unauthorized, rate-limited, or failed AI requests.
- Preserve test coverage for Gemini model selection, retry/fallback behavior, search configuration, prompt contents, and text/image analysis.

## 10. Verification

- Run `npm test` for the Node test suite.
- Run `npm run lint` for TypeScript checking.
- Run `npm run build` to verify the production frontend build.
- Verify `GET /api/health`, auth configuration, and storage configuration in a local or deployed environment.
