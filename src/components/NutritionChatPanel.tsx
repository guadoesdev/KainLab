import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Camera,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  ImagePlus,
  Loader2,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import type { ChatMessageItem } from '../types/nutrition';
import { CameraCaptureModal } from './CameraCaptureModal';

interface NutritionChatPanelProps {
  messages: ChatMessageItem[];
  isSending: boolean;
  errorMessage: string | null;
  onSendText: (text: string) => Promise<void>;
  onSendImage: (file: File, previewDataUrl: string, caption?: string) => Promise<void>;
  onClearChat: () => Promise<void>;
}

const EXAMPLE_PROMPTS = [
  'I ate 2 scrambled eggs and 2 slices of wheat bread.',
  'I had grilled chicken breast and rice for lunch.',
  'I ate a bowl of pasta.',
];

async function compressImageForUpload(file: File): Promise<{ file: File; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected image file.'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const img = new Image();
      img.onerror = () => resolve({ file, previewUrl: dataUrl });
      img.onload = () => {
        const maxDim = 1280;
        let { width, height } = img;
        if (width <= maxDim && height <= maxDim && file.size <= 1.2 * 1024 * 1024) {
          resolve({ file, previewUrl: dataUrl });
          return;
        }
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ file, previewUrl: dataUrl });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressedPreview = canvas.toDataURL('image/jpeg', 0.82);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve({ file, previewUrl: compressedPreview });
              return;
            }
            const nextFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
              type: 'image/jpeg',
            });
            resolve({ file: nextFile, previewUrl: compressedPreview });
          },
          'image/jpeg',
          0.82
        );
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function NutritionChatPanel({
  messages,
  isSending,
  errorMessage,
  onSendText,
  onSendImage,
  onClearChat,
}: NutritionChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const [pendingPhoto, setPendingPhoto] = useState<{
    file: File;
    previewUrl: string;
  } | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [photoReadError, setPhotoReadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, isSending]);

  async function handleFileChange(files: FileList | null) {
    setPhotoReadError(null);
    const selected = files?.[0];
    if (!selected) return;
    if (!selected.type.startsWith('image/')) {
      setPhotoReadError('Please select a valid image file (JPEG, PNG, or WebP).');
      return;
    }
    try {
      const prepared = await compressImageForUpload(selected);
      setPendingPhoto(prepared);
    } catch (error) {
      setPhotoReadError(
        error instanceof Error ? error.message : 'Unable to prepare image.'
      );
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSending) return;

    if (pendingPhoto) {
      const photoToUpload = pendingPhoto;
      const caption = inputText.trim() || undefined;
      setPendingPhoto(null);
      setInputText('');
      await onSendImage(photoToUpload.file, photoToUpload.previewUrl, caption);
      return;
    }

    const trimmed = inputText.trim();
    if (!trimmed) return;
    setInputText('');
    await onSendText(trimmed);
  }

  const lastMessageId = messages[messages.length - 1]?.id;

  return (
    <section
      aria-label="AI Nutrition Assistant Chat"
      className="rounded-2xl border border-slate-200 bg-white flex flex-col h-[560px] lg:h-[calc(100vh-8.5rem)] lg:sticky lg:top-20 overflow-hidden"
    >
      <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            AI Nutrition Assistant
          </h2>
          <p className="text-xs text-slate-500">
            Describe a meal or upload a food photo to log automatically
          </p>
        </div>

        {messages.length > 0 && (
          <button
            type="button"
            disabled={isSending}
            onClick={onClearChat}
            title="Clear today's chat history"
            className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Clear</span>
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4 bg-slate-50/50">
        {messages.length === 0 ? (
          <div className="py-6 space-y-5">
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-slate-900">
                What did you eat today?
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                Tell me your meal in plain English or tap the camera button to analyze a food photo. I&apos;ll estimate portions, check public nutrition data, and log high-confidence meals straight to your Today summary.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500">Try an example</p>
              <div className="space-y-2">
                {EXAMPLE_PROMPTS.map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    disabled={isSending}
                    onClick={() => onSendText(sample)}
                    className="w-full min-h-[44px] text-left rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs sm:text-sm text-slate-800 hover:border-emerald-600 hover:bg-emerald-50/40 transition-colors"
                  >
                    &ldquo;{sample}&rdquo;
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            const isLatest = msg.id === lastMessageId;

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed space-y-2.5 ${
                    isUser
                      ? 'bg-slate-900 text-white rounded-br-sm'
                      : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'
                  }`}
                >
                  {msg.localImagePreview && (
                    <img
                      src={msg.localImagePreview}
                      alt="Uploaded meal photo"
                      referrerPolicy="no-referrer"
                      className="max-h-44 w-auto rounded-lg object-cover border border-white/20"
                    />
                  )}
                  {!msg.localImagePreview && msg.hasImage && isUser && (
                    <div className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                      <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Food photo attached</span>
                    </div>
                  )}

                  <p className="whitespace-pre-line">{msg.content}</p>

                  {!isUser && msg.mealId && msg.nutritionSnapshot && (
                    <div className="pt-2 border-t border-slate-100 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-800">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
                        <span>
                          Added to Today
                          {typeof msg.confidence === 'number'
                            ? ` · ${Math.round(msg.confidence * 100)}% confidence`
                            : ''}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-xs text-slate-600 tabular-nums">
                        <span>{msg.nutritionSnapshot.calories} kcal</span>
                        <span aria-hidden="true">·</span>
                        <span>P {msg.nutritionSnapshot.protein}g</span>
                        <span aria-hidden="true">·</span>
                        <span>C {msg.nutritionSnapshot.carbs}g</span>
                        <span aria-hidden="true">·</span>
                        <span>F {msg.nutritionSnapshot.fat}g</span>
                      </div>
                    </div>
                  )}

                  {!isUser && !msg.mealId && msg.clarificationOptions && msg.clarificationOptions.length > 0 && (
                    <div className="pt-2 border-t border-slate-100 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
                        <HelpCircle className="h-3.5 w-3.5 text-amber-700 shrink-0" aria-hidden="true" />
                        <span>
                          Quick clarification needed before saving
                          {typeof msg.confidence === 'number'
                            ? ` · ${Math.round(msg.confidence * 100)}% confidence`
                            : ''}
                        </span>
                      </div>

                      {isLatest && (
                        <div className="flex flex-wrap gap-1.5">
                          {msg.clarificationOptions.map((option) => (
                            <button
                              key={option}
                              type="button"
                              disabled={isSending}
                              onClick={() => onSendText(option)}
                              className="min-h-[36px] rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 hover:border-emerald-700 hover:bg-emerald-50 hover:text-emerald-900 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {!isUser && msg.sources && msg.sources.length > 0 && (
                    <div className="pt-1.5 border-t border-slate-100 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      <span>Nutrition refs:</span>
                      {msg.sources.slice(0, 3).map((url, idx) => {
                        let host = 'Source';
                        try {
                          host = new URL(url).hostname.replace(/^www\./, '');
                        } catch {
                          host = `Ref ${idx + 1}`;
                        }
                        return (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-blue-700 hover:underline underline-offset-2"
                          >
                            <span>{host}</span>
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {isSending && (
          <div className="flex items-start">
            <div className="rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 inline-flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-700" aria-hidden="true" />
              <span>Analyzing meal &amp; checking nutrition data...</span>
            </div>
          </div>
        )}

        <div ref={scrollBottomRef} />
      </div>

      {(errorMessage || photoReadError) && (
        <div
          role="alert"
          className="px-4 py-2.5 bg-red-50 border-t border-red-200 text-xs text-red-800"
        >
          {photoReadError || errorMessage}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="p-3 sm:p-4 border-t border-slate-200 bg-white space-y-2.5 shrink-0"
      >
        {pendingPhoto && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src={pendingPhoto.previewUrl}
                alt="Selected food preview"
                referrerPolicy="no-referrer"
                className="h-11 w-11 rounded-lg object-cover border border-slate-200 shrink-0"
              />
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-800 truncate">
                  {pendingPhoto.file.name}
                </p>
                <p className="text-[11px] text-slate-500">
                  Add an optional note or send to analyze
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPendingPhoto(null)}
              aria-label="Remove attached photo"
              className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-900 shrink-0"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => handleFileChange(e.target.files)}
            className="hidden"
            aria-label="Upload food photo"
          />
          <button
            type="button"
            disabled={isSending}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach food photo"
            title="Upload food photo"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors disabled:opacity-50 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
          >
            <ImagePlus className="h-5 w-5" aria-hidden="true" />
          </button>

          <button
            type="button"
            disabled={isSending}
            onClick={() => {
              setPhotoReadError(null);
              setIsCameraOpen(true);
            }}
            aria-label="Take food photo with camera"
            title="Take food photo"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors disabled:opacity-50 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
          >
            <Camera className="h-5 w-5" aria-hidden="true" />
          </button>

          <input
            type="text"
            value={inputText}
            disabled={isSending}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={
              pendingPhoto
                ? 'Optional note (e.g. half portion, no dressing)...'
                : 'Describe a meal (e.g. 2 eggs and wheat toast)...'
            }
            aria-label="Meal description"
            className="flex-1 min-w-0 min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
          />

          <button
            type="submit"
            disabled={isSending || (!inputText.trim() && !pendingPhoto)}
            aria-label="Send meal message"
            className="min-h-[44px] min-w-[44px] px-4 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-700 text-sm font-medium text-white hover:bg-emerald-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">Log</span>
          </button>
        </div>
      </form>

      {isCameraOpen && (
        <CameraCaptureModal
          onClose={() => setIsCameraOpen(false)}
          onAttachPhoto={(file, previewUrl) => {
            setPhotoReadError(null);
            setPendingPhoto({ file, previewUrl });
          }}
          onSendPhotoNow={async (file, previewUrl) => {
            const caption = inputText.trim() || undefined;
            setInputText('');
            setPendingPhoto(null);
            await onSendImage(file, previewUrl, caption);
          }}
        />
      )}
    </section>
  );
}
