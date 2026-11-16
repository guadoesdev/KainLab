import { useState } from 'react';
import { Utensils } from 'lucide-react';

const EDITORIAL_IMAGE_PATH = '/src/assets/images/nutrition_tracker_editorial_1794837926761.jpg';

export function AuthShowcasePanel() {
  const [imageError, setImageError] = useState(false);

  return (
    <aside className="relative hidden lg:flex lg:col-span-6 flex-col justify-between overflow-hidden bg-slate-950 text-slate-100 p-10 xl:p-14">
      <div className="absolute inset-0">
        {!imageError ? (
          <img
            src={EDITORIAL_IMAGE_PATH}
            alt="Grilled herb salmon bowl with quinoa, avocado, and broccolini on dark slate"
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
            className="h-full w-full object-cover object-center opacity-50"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 flex items-center justify-center">
            <Utensils className="h-16 w-16 text-slate-700" aria-hidden="true" />
          </div>
        )}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/75 to-slate-950/55"
        />
      </div>

      <div className="relative z-10">
        <a
          href="/"
          className="inline-block font-display text-xl font-bold tracking-tight text-white whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded-sm"
        >
          AI Nutrition Tracker
        </a>
      </div>

      <div className="relative z-10 max-w-lg space-y-8 my-auto py-12">
        <div className="space-y-4">
          <p className="text-sm font-medium text-emerald-300">
            Conversational Meal &amp; Photo Logging
          </p>
          <h1 className="font-display text-3xl xl:text-4xl font-semibold tracking-tight text-white leading-[1.15] [text-wrap:balance]">
            Track every meal through conversation, not food databases.
          </h1>
          <p className="text-base text-slate-300 leading-relaxed max-w-md">
            Describe what you ate in plain language or upload a food photo. Your nutrition assistant estimates portions, checks trusted food data, and updates your daily totals automatically.
          </p>
        </div>

        <dl className="divide-y divide-white/10 border-t border-b border-white/10">
          <div className="py-4 flex items-baseline justify-between gap-6">
            <dt className="text-sm font-medium text-white shrink-0">Natural language</dt>
            <dd className="text-sm text-slate-300 text-right">
              Log meals in one sentence with follow-up clarifications
            </dd>
          </div>
          <div className="py-4 flex items-baseline justify-between gap-6">
            <dt className="text-sm font-medium text-white shrink-0">Photo recognition</dt>
            <dd className="text-sm text-slate-300 text-right">
              Upload meal photos directly inside the Today chat
            </dd>
          </div>
          <div className="py-4 flex items-baseline justify-between gap-6">
            <dt className="text-sm font-medium text-white shrink-0">Live daily totals</dt>
            <dd className="text-sm text-slate-300 text-right">
              Calories, protein, carbs, and fat synced in real time
            </dd>
          </div>
        </dl>
      </div>

      <div className="relative z-10 flex items-center justify-between gap-4 text-xs text-slate-400">
        <span>AI Nutrition Tracker</span>
        <span aria-hidden="true">·</span>
        <span>USDA &amp; Public Nutrition Grounding</span>
      </div>
    </aside>
  );
}
