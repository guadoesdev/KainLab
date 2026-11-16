import { MailCheck, X } from 'lucide-react';

export interface RegistrationNotice {
  email: string;
  username?: string;
  verificationEmailSent: boolean;
}

interface VerificationBannerProps {
  notice: RegistrationNotice;
  onDismiss: () => void;
}

export function VerificationBanner({ notice, onDismiss }: VerificationBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"
    >
      <div className="flex items-start gap-3">
        <MailCheck
          className="h-5 w-5 text-emerald-700 mt-0.5 shrink-0"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold text-emerald-950">
            Account created — check your inbox
          </p>
          <p className="text-emerald-900 leading-relaxed">
            {notice.verificationEmailSent ? (
              <>
                A verification email has been sent to{' '}
                <span className="font-medium break-all">{notice.email}</span>. Open the
                link in your inbox (or spam folder) to verify your account, then sign in
                below.
              </>
            ) : (
              <>
                Your account for{' '}
                <span className="font-medium break-all">{notice.email}</span> is ready.
                Please sign in below to request a verification email and complete setup.
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss verification notice"
          className="h-8 w-8 -mr-1 -mt-1 inline-flex items-center justify-center rounded-md text-emerald-800 hover:bg-emerald-100 hover:text-emerald-950 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
