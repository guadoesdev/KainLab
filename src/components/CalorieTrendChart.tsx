import { useId, useMemo, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import type { DailyCaloriePoint } from '../types/nutrition';

interface CalorieTrendChartProps {
  points: DailyCaloriePoint[];
  dailyCalorieGoal: number;
  isLoading: boolean;
  errorMessage: string | null;
  onRetry: () => void;
}

const CHART_WIDTH = 640;
const CHART_HEIGHT = 216;
const MARGIN = { top: 20, right: 20, bottom: 34, left: 48 };
const PLOT_WIDTH = CHART_WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

export function CalorieTrendChart({
  points,
  dailyCalorieGoal,
  isLoading,
  errorMessage,
  onRetry,
}: CalorieTrendChartProps) {
  const gradientId = useId();
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);

  const todayKey = points[points.length - 1]?.dateKey ?? null;
  const activeKey = selectedDateKey ?? todayKey;
  const activePoint =
    points.find((p) => p.dateKey === activeKey) ?? points[points.length - 1] ?? null;

  const { yMax, yTicks, loggedDaysCount, averageCalories } = useMemo(() => {
    const maxCalories = points.reduce((max, p) => Math.max(max, p.calories), 0);
    const rawMax = Math.max(dailyCalorieGoal * 1.15, maxCalories * 1.15, 1000);
    const roundedMax = Math.ceil(rawMax / 500) * 500;
    const mid = Math.round(roundedMax / 2);

    const activeDays = points.filter((p) => p.calories > 0);
    const total = activeDays.reduce((sum, p) => sum + p.calories, 0);
    const avg = activeDays.length > 0 ? Math.round(total / activeDays.length) : 0;

    return {
      yMax: roundedMax,
      yTicks: [0, mid, roundedMax],
      loggedDaysCount: activeDays.length,
      averageCalories: avg,
    };
  }, [points, dailyCalorieGoal]);

  const coords = useMemo(() => {
    const count = Math.max(1, points.length);
    return points.map((point, index) => {
      const x =
        count === 1
          ? MARGIN.left + PLOT_WIDTH / 2
          : MARGIN.left + (index / (count - 1)) * PLOT_WIDTH;
      const ratio = Math.min(1, Math.max(0, point.calories / Math.max(1, yMax)));
      const y = MARGIN.top + PLOT_HEIGHT * (1 - ratio);
      return { ...point, x, y };
    });
  }, [points, yMax]);

  const linePath = useMemo(() => {
    if (coords.length === 0) return '';
    return coords
      .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
      .join(' ');
  }, [coords]);

  const areaPath = useMemo(() => {
    if (coords.length === 0) return '';
    const baselineY = (MARGIN.top + PLOT_HEIGHT).toFixed(1);
    const firstX = coords[0].x.toFixed(1);
    const lastX = coords[coords.length - 1].x.toFixed(1);
    return `${linePath} L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`;
  }, [coords, linePath]);

  const goalRatio = Math.min(1, Math.max(0, dailyCalorieGoal / Math.max(1, yMax)));
  const goalY = MARGIN.top + PLOT_HEIGHT * (1 - goalRatio);

  const deltaFromGoal = activePoint ? dailyCalorieGoal - activePoint.calories : 0;
  const activeOverGoal = activePoint ? activePoint.calories > dailyCalorieGoal : false;

  return (
    <section
      aria-label="7-Day Calorie Trend"
      className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Last 7 Days Calories
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 font-mono tabular-nums">
            <span>
              {loggedDaysCount > 0
                ? `${loggedDaysCount}-day avg: ${averageCalories.toLocaleString()} kcal`
                : 'No calories logged in past 7 days'}
            </span>
            <span aria-hidden="true">·</span>
            <span>Goal: {dailyCalorieGoal.toLocaleString()} kcal</span>
          </div>
        </div>

        {activePoint && !isLoading && (
          <div className="text-left sm:text-right">
            <p className="text-xs font-medium text-slate-600">
              {activePoint.fullLabel}
              {activePoint.isToday ? ' (Today)' : ''}
            </p>
            <div className="flex sm:justify-end items-baseline gap-2 mt-0.5">
              <span className="font-mono text-base font-semibold text-slate-900 tabular-nums">
                {activePoint.calories.toLocaleString()} kcal
              </span>
              <span
                className={`text-xs font-medium tabular-nums ${
                  activePoint.calories === 0
                    ? 'text-slate-500'
                    : activeOverGoal
                      ? 'text-red-700'
                      : 'text-emerald-800'
                }`}
              >
                {activePoint.calories === 0
                  ? 'No entries'
                  : activeOverGoal
                    ? `+${Math.abs(deltaFromGoal).toLocaleString()} over goal`
                    : `${deltaFromGoal.toLocaleString()} under goal`}
              </span>
            </div>
          </div>
        )}
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[32px] inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 whitespace-nowrap shrink-0"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {isLoading ? (
        <div
          aria-busy="true"
          aria-label="Loading 7-day calorie chart"
          className="h-[216px] w-full rounded-xl bg-slate-100 animate-pulse"
        />
      ) : (
        <div className="w-full overflow-hidden">
          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            role="img"
            aria-label="Line chart of daily calorie intake over the last 7 days"
            className="w-full h-auto select-none overflow-visible"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#059669" stopOpacity="0.16" />
                <stop offset="100%" stopColor="#059669" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal Y-axis gridlines */}
            {yTicks.map((tickValue) => {
              const ratio = tickValue / Math.max(1, yMax);
              const y = MARGIN.top + PLOT_HEIGHT * (1 - ratio);
              return (
                <g key={tickValue}>
                  <line
                    x1={MARGIN.left}
                    y1={y}
                    x2={CHART_WIDTH - MARGIN.right}
                    y2={y}
                    stroke="#E2E8F0"
                    strokeWidth="1"
                  />
                  <text
                    x={MARGIN.left - 8}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-slate-400 font-mono text-[10px]"
                  >
                    {tickValue.toLocaleString()}
                  </text>
                </g>
              );
            })}

            {/* Daily Calorie Goal Reference Line */}
            <line
              x1={MARGIN.left}
              y1={goalY}
              x2={CHART_WIDTH - MARGIN.right}
              y2={goalY}
              stroke="#94A3B8"
              strokeWidth="1.25"
              strokeDasharray="4 4"
            />
            <text
              x={CHART_WIDTH - MARGIN.right}
              y={Math.max(MARGIN.top + 10, goalY - 5)}
              textAnchor="end"
              className="fill-slate-500 font-mono text-[10px] font-medium"
            >
              Goal
            </text>

            {/* Area Fill & Calorie Trend Line */}
            {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
            {linePath && (
              <path
                d={linePath}
                fill="none"
                stroke="#059669"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Day Data Points & X-axis Labels */}
            {coords.map((pt) => {
              const isSelected = activePoint?.dateKey === pt.dateKey;
              const isOver = pt.calories > dailyCalorieGoal;
              const dotStroke = isOver ? '#DC2626' : pt.calories > 0 ? '#059669' : '#94A3B8';
              const dotFill = isSelected ? dotStroke : '#FFFFFF';

              return (
                <g key={pt.dateKey}>
                  {isSelected && (
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={10}
                      fill={isOver ? '#FEE2E2' : '#D1FAE5'}
                      opacity={0.75}
                    />
                  )}
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={isSelected ? 5.5 : 4}
                    fill={dotFill}
                    stroke={dotStroke}
                    strokeWidth="2.5"
                    className="transition-all duration-150"
                  />

                  {/* Accessible 44px touch/hover/focus hit area */}
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={22}
                    fill="transparent"
                    role="button"
                    tabIndex={0}
                    aria-label={`${pt.fullLabel}: ${pt.calories.toLocaleString()} kcal`}
                    onMouseEnter={() => setSelectedDateKey(pt.dateKey)}
                    onFocus={() => setSelectedDateKey(pt.dateKey)}
                    onClick={() => setSelectedDateKey(pt.dateKey)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedDateKey(pt.dateKey);
                      }
                    }}
                    className="cursor-pointer focus:outline-none"
                  />

                  <text
                    x={pt.x}
                    y={CHART_HEIGHT - 10}
                    textAnchor="middle"
                    className={`text-[11px] ${
                      isSelected
                        ? 'fill-slate-900 font-semibold'
                        : pt.isToday
                          ? 'fill-emerald-800 font-medium'
                          : 'fill-slate-500'
                    }`}
                  >
                    {pt.shortLabel}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {!isLoading && loggedDaysCount <= 1 && (
        <p className="text-xs text-slate-500">
          Log meals across the week to watch your 7-day calorie trend update automatically.
        </p>
      )}
    </section>
  );
}
