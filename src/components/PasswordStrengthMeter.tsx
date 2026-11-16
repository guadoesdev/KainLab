import { Check, Minus } from 'lucide-react';
import type { PasswordStrength } from '../lib/authHelpers';

interface PasswordStrengthMeterProps {
  id?: string;
  password: string;
  strength: PasswordStrength;
}

export function PasswordStrengthMeter({
  id = 'signup-password-strength',
  password,
  strength,
}: PasswordStrengthMeterProps) {
  const hasInput = password.length > 0;

  const tone =
    strength.score === 0
      ? {
          bar: 'bg-slate-200',
          label: 'text-slate-500',
        }
      : strength.score === 1
      ? {
          bar: 'bg-red-600',
          label: 'text-red-700',
        }
      : strength.score === 2
      ? {
          bar: 'bg-amber-600',
          label: 'text-amber-700',
        }
      : strength.score === 3
      ? {
          bar: 'bg-blue-700',
          label: 'text-blue-700',
        }
      : {
          bar: 'bg-emerald-600',
          label: 'text-emerald-700',
        };

  const rules = [
    {
      key: 'length',
      label: '8+ characters',
      passed: strength.checks.length,
    },
    {
      key: 'cases',
      label: 'Upper & lowercase',
      passed: strength.checks.uppercase && strength.checks.lowercase,
    },
    {
      key: 'number',
      label: 'At least 1 number',
      passed: strength.checks.number,
    },
    {
      key: 'symbol',
      label: 'Special character',
      passed: strength.checks.symbol,
    },
  ];

  return (
    <div id={id} className="pt-2 space-y-2.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-600">Password strength</span>
        <span
          aria-live="polite"
          className={`font-medium tabular-nums ${tone.label}`}
        >
          {hasInput ? `${strength.label} (${strength.score}/4)` : 'Waiting for input'}
        </span>
      </div>

      <div
        role="progressbar"
        aria-label="Password strength"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={strength.score}
        aria-valuetext={hasInput ? strength.label : 'No password entered'}
        className="grid grid-cols-4 gap-1.5"
      >
        {[1, 2, 3, 4].map((segment) => {
          const active = strength.score >= segment;
          return (
            <div
              key={segment}
              className={`h-1.5 rounded-full transition-colors duration-150 ${
                active ? tone.bar : 'bg-slate-200'
              }`}
            />
          );
        })}
      </div>

      <ul
        aria-label="Password complexity requirements"
        className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-0.5 text-xs"
      >
        {rules.map((rule) => (
          <li
            key={rule.key}
            className={`flex items-center gap-1.5 transition-colors duration-150 ${
              rule.passed
                ? 'text-emerald-800 font-medium'
                : hasInput
                ? 'text-slate-600'
                : 'text-slate-500'
            }`}
          >
            {rule.passed ? (
              <Check className="h-3.5 w-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
            ) : (
              <Minus className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">{rule.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
