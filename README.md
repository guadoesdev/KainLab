# KainLab — AI Nutrition Tracker

KainLab is a full-stack conversational nutrition and food-photo tracking application. Users describe meals in natural language or capture/upload food photos directly in the **Today** chat, and the Gemini-powered backend estimates portions, checks nutrition data, saves meals automatically, and updates daily, weekly, and monthly dashboards in real time.

## Architecture Overview

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Motion
- **Backend**: Node.js (`22.14.0`), Express (`server.ts`) serving both API routes (`/api/*`) and the Vite SPA
- **Authentication**: Supabase Auth (Email/Password, email verification, password recovery, and Google OAuth)
- **Database**: Supabase PostgreSQL (`public.profiles`, `public.meals`, `public.chat_messages`, `public.daily_summaries`) with Row Level Security enabled
- **AI Layer**: `@google/genai` server-side (`GEMINI_MODEL`, defaulting to `gemini-4-hydrogen`) with Google Search grounding

---

## Prerequisites

- **Node.js `22.14.0+`** (see `.node-version`) and `npm`
- A **GitHub** repository containing this project (for Render deployment)
- Accounts on:
  - [Google Cloud Console](https://console.cloud.google.com/) (and optionally [Google AI Studio](https://aistudio.google.com/))
  - [Supabase](https://supabase.com/)
  - [Render](https://render.com/)

---

## Part 1: Google Cloud Console (`console.cloud.google.com`) Setup

You will use Google Cloud Console for two purposes:
1. Creating an OAuth 2.0 Client ID/Secret so **Continue with Google** works through Supabase Auth.
2. Enabling the Gemini API and obtaining a `GEMINI_API_KEY` for meal text and food image analysis.

### 1A. Create or Select a Google Cloud Project

1. Open [console.cloud.google.com](https://console.cloud.google.com/) and sign in.
2. Click the project selector dropdown in the top bar and select **New Project** (or pick an existing project).
3. Name the project (for example, `kainlab-prod`) and click **Create**, then make sure it is selected in the top bar.

### 1B. Configure the OAuth Consent Screen

1. In the left navigation menu, go to **APIs & Services → OAuth consent screen** (or **Google Auth Platform → Overview**).
2. Click **Get Started** (or **Configure Consent Screen**):
   - **App name**: `KainLab`
   - **User support email**: your support email address
   - **Audience / User Type**: select **External** (so any Google user can sign in) and click **Next / Create**.
   - **Contact information**: enter your developer email address.
3. Under **Branding / Authorized domains** (if prompted):
   - Add `supabase.co`
   - Add `onrender.com` (if using the default `*.onrender.com` domain) or your custom domain.
4. Under **Data Access / Scopes**, ensure standard OpenID Connect scopes (`openid`, `userinfo.email`, `userinfo.profile`) are included.
5. Under **Audience → Publishing status**, click **Publish App** when ready for public sign-in (or add test emails under **Test users** while in Testing mode).

### 1C. Create OAuth 2.0 Web Client Credentials

> **Tip**: You will need your Supabase Project Reference ID (`<your-project-ref>`) for the redirect URI. If you haven't created your Supabase project yet, complete **Part 2A** first or return to step 5 below once you have your Supabase URL.

1. In Google Cloud Console, go to **APIs & Services → Credentials** (or **Google Auth Platform → Clients**).
2. Click **+ Create Credentials → OAuth client ID**.
3. Set **Application type** to **Web application**.
4. Set **Name** to `KainLab Web Auth`.
5. Under **Authorized JavaScript origins**, add:
   - `http://localhost:3000` (for local development)
   - `https://<your-project-ref>.supabase.co`
   - `https://<your-render-service>.onrender.com` (add/update after deploying on Render)
6. Under **Authorized redirect URIs**, add your Supabase Auth callback URL:
   - `https://<your-project-ref>.supabase.co/auth/v1/callback`
7. Click **Create**.
8. Copy and securely save the **Client ID** and **Client Secret** — you will paste these into Supabase in **Part 2D**.

### 1D. Enable Gemini API & Create `GEMINI_API_KEY`

1. In Google Cloud Console, go to **APIs & Services → Library**.
2. Search for **Generative Language API** (`generativelanguage.googleapis.com`) and click **Enable**.
3. Go to **APIs & Services → Credentials → + Create Credentials → API key** (alternatively, create a key linked to this project in [Google AI Studio](https://aistudio.google.com/apikey)).
4. Click **Edit API key** to restrict it safely:
   - **Application restrictions**: None (because `GEMINI_API_KEY` is used strictly on the Express server, never in the browser; optionally restrict by Render outbound IPs if using static IPs).
   - **API restrictions**: Restrict key → select **Generative Language API**.
5. Save the key as `GEMINI_API_KEY`.

---

## Part 2: Supabase Setup (Database & Authentication)

### 2A. Create the Supabase Project & Collect API Keys

1. Sign in to [supabase.com/dashboard](https://supabase.com/dashboard) and click **New project**.
2. Choose your organization, set **Name** to `kainlab`, enter a strong **Database Password**, select a region close to your Render deployment region, and click **Create new project**.
3. Wait for the project to finish provisioning, then open **Project Settings → API** (or **Settings → Data API / API Keys**):
   - Copy **Project URL** (looks like `https://abcdefghijklmnop.supabase.co`) → this is `SUPABASE_URL`.
   - Copy your client-safe **Publishable key** (or legacy `anon` public key) → this is `SUPABASE_PUBLISHABLE_KEY`.
   - Copy your secret **Service Role key** (`service_role`, or secret key) → this is `SUPABASE_SERVICE_ROLE_KEY`.

> **Security note**: Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser or commit it to Git. Only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are shared with the client via `/api/config/auth`.

### 2B. Run the PostgreSQL Schema (`supabase/schema.sql`)

KainLab stores user profiles, meals, chat history, and daily summaries in Supabase PostgreSQL with Row Level Security (RLS) enabled.

1. In the Supabase Dashboard, open **SQL Editor** in the left sidebar.
2. Click **+ New query**.
3. Copy the entire contents of `supabase/schema.sql` from this repository and paste it into the SQL Editor.
4. Click **Run** (`Cmd/Ctrl + Enter`).
5. Confirm that the query succeeds and creates:
   - `public.profiles`
   - `public.meals`
   - `public.chat_messages`
   - `public.daily_summaries`
6. Open **Table Editor** or **Database → Tables** to verify all four tables exist and have **RLS enabled** (the Express backend verifies Supabase Auth JWTs and accesses these tables server-side via `SUPABASE_SERVICE_ROLE_KEY`).

### 2C. Configure Email Authentication & Redirect URLs

1. In Supabase Dashboard, go to **Authentication → Providers → Email**.
2. Ensure **Enable Email provider** is turned **On**.
   - **Confirm email**: Keep **On** (recommended) so new users receive a verification link and see the verification banner until confirmed.
3. Go to **Authentication → URL Configuration**:
   - **Site URL**: set to `https://<your-render-service>.onrender.com` (or `http://localhost:3000` while testing locally).
   - **Redirect URLs**: add all origins where users may return after email verification, password reset, or Google OAuth:
     - `http://localhost:3000`
     - `http://localhost:3000/**`
     - `https://<your-render-service>.onrender.com`
     - `https://<your-render-service>.onrender.com/**`
4. Click **Save**.

### 2D. Enable Google OAuth in Supabase

1. Go to **Authentication → Sign In / Providers → Google**.
2. Toggle **Enable Sign in with Google** to **On**.
3. Paste the **Client ID** and **Client Secret** created in **Part 1C**.
4. Verify the **Callback URL (for OAuth)** displayed by Supabase matches `https://<your-project-ref>.supabase.co/auth/v1/callback` in Google Cloud Console.
5. Click **Save**.

---

## Part 3: Local Development Setup (Optional Verification)

Before deploying to Render, you can run KainLab locally to verify Supabase Auth, PostgreSQL, and Gemini integration:

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Fill in `.env`:
   ```env
   GEMINI_API_KEY="your_gemini_api_key"
   GEMINI_MODEL="gemini-4-hydrogen"
   APP_URL="http://localhost:3000"
   DATABASE_PROVIDER="supabase"
   SUPABASE_URL="https://<your-project-ref>.supabase.co"
   SUPABASE_PUBLISHABLE_KEY="your_supabase_publishable_or_anon_key"
   SUPABASE_SERVICE_ROLE_KEY="your_supabase_service_role_key"
   ```
3. Install dependencies and start the dev server:
   ```bash
   npm install
   npm run dev
   ```
4. Open `http://localhost:3000` and verify:
   - `GET http://localhost:3000/api/health` returns `{"status":"ok",...}`
   - `GET http://localhost:3000/api/config/auth` returns `"configured": true`
   - `GET http://localhost:3000/api/config/storage` returns `{"provider":"supabase"}`

---

## Part 4: Render (`render.com`) Deployment

This repository includes a `render.yaml` Blueprint configured for Node.js `22.14.0` (`.node-version`), Vite production build, and Express server startup.

### Option A: Deploy with `render.yaml` Blueprint (Recommended)

1. Push your repository to GitHub (make sure `.env` is **not** committed — it is already ignored by `.gitignore`).
2. Sign in to [dashboard.render.com](https://dashboard.render.com/).
3. Click **New + → Blueprint**.
4. Connect your GitHub account/repository and select the branch you want to deploy.
5. Render reads `render.yaml` automatically:
   - **Service Name**: `kainlab`
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/api/health`
6. When prompted for the environment variables marked `sync: false`, enter:
   - `GEMINI_API_KEY` — your Gemini API key from Part 1D
   - `SUPABASE_URL` — your Supabase Project URL from Part 2A
   - `SUPABASE_PUBLISHABLE_KEY` — your Supabase publishable/anon key from Part 2A
   - `SUPABASE_SERVICE_ROLE_KEY` — your Supabase service role key from Part 2A
   - `APP_URL` — leave temporary or set after Render assigns your `https://<service>.onrender.com` URL (update immediately after first deploy)
7. Click **Apply / Create Blueprint** and wait for the build and health check (`/api/health`) to turn **Live**.

### Option B: Manual Render Web Service Setup

If you prefer creating the service manually instead of using a Blueprint:

1. In Render Dashboard, click **New + → Web Service** and connect your repository.
2. Configure the service:
   - **Name**: `kainlab`
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/api/health`
3. Open the **Environment** tab and add all variables listed in the table below.
4. Click **Create Web Service**.

### Environment Variables Reference

| Variable | Required | Description |
| --- | --- | --- |
| `NODE_ENV` | Yes (Render) | Set to `production` so Express serves `dist/` |
| `DATABASE_PROVIDER` | Yes | Set to `supabase` |
| `GEMINI_API_KEY` | Yes | Server-side Gemini API key |
| `GEMINI_MODEL` | Recommended | Gemini model ID (default: `gemini-4-hydrogen`) |
| `SUPABASE_URL` | Yes | Supabase Project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | Client-safe Supabase publishable (or anon) key for Auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only Supabase service role key for PostgreSQL persistence |
| `APP_URL` | Yes | Full public URL of your deployed Render app (`https://<app>.onrender.com`) |

---

## Part 5: Final Post-Deploy Sync (Important)

Once Render finishes deploying and gives you your live URL (for example, `https://kainlab.onrender.com`):

1. **Render → Environment**: Update `APP_URL` to `https://kainlab.onrender.com` and save (Render will redeploy with the updated variable).
2. **Supabase Dashboard → Authentication → URL Configuration**:
   - Set **Site URL** to `https://kainlab.onrender.com`.
   - Ensure `https://kainlab.onrender.com` and `https://kainlab.onrender.com/**` are in **Redirect URLs**.
3. **Google Cloud Console → Credentials → KainLab Web Auth**:
   - Ensure `https://kainlab.onrender.com` is listed under **Authorized JavaScript origins**.
   - Confirm `https://<your-project-ref>.supabase.co/auth/v1/callback` is listed under **Authorized redirect URIs**.

---

## Verification & Troubleshooting

### Quick Health & Config Checks

After deploying, visit these endpoints in your browser or with `curl`:

- `https://<your-app>.onrender.com/api/health` → should return HTTP `200` with `{"status":"ok",...}`
- `https://<your-app>.onrender.com/api/config/auth` → should return `"configured": true` (if `false`, verify `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in Render)
- `https://<your-app>.onrender.com/api/config/storage` → should return `{"provider":"supabase"}` (if `"memory"`, verify `SUPABASE_SERVICE_ROLE_KEY` in Render)

### Common Issues

- **Google OAuth returns `redirect_uri_mismatch`**:
  Check Google Cloud Console → **Authorized redirect URIs** and verify it contains the exact Supabase callback URL `https://<your-project-ref>.supabase.co/auth/v1/callback` (not your Render URL).
- **Email confirmation / password reset redirects to `localhost:3000`**:
  Update **Site URL** and **Redirect URLs** in **Supabase Dashboard → Authentication → URL Configuration** to your live Render URL.
- **Meals disappear after server restart**:
  Check `/api/config/storage`. If it reports `"memory"`, confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in Render and that `supabase/schema.sql` has been executed in Supabase SQL Editor.
- **AI meal logging fails**:
  Verify `GEMINI_API_KEY` is set in Render Environment Variables and that **Generative Language API** is enabled in Google Cloud Console.
