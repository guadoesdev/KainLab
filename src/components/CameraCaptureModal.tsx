import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  Loader2,
  RotateCcw,
  Send,
  SwitchCamera,
  Upload,
  X,
} from 'lucide-react';

interface CameraCaptureModalProps {
  onClose: () => void;
  onAttachPhoto: (file: File, previewUrl: string) => void;
  onSendPhotoNow: (file: File, previewUrl: string) => Promise<void>;
}

export function CameraCaptureModal({
  onClose,
  onAttachPhoto,
  onSendPhotoNow,
}: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isInitializing, setIsInitializing] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<{ file: File; previewUrl: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(
    async (mode: 'environment' | 'user') => {
      stopStream();
      setCameraError(null);
      setIsInitializing(true);

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        setIsInitializing(false);
        setCameraError(
          'Live camera preview is unavailable in this browser. Use the device camera picker below instead.'
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
          audio: false,
        });

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (error) {
        const name =
          typeof error === 'object' && error !== null && 'name' in error
            ? String((error as { name: unknown }).name)
            : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setCameraError(
            'Camera permission was denied. Allow camera access in your browser settings or use the device photo picker below.'
          );
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setCameraError(
            'No camera device was detected. You can still upload or capture a photo using the device picker below.'
          );
        } else {
          setCameraError(
            'Unable to start live camera preview. Use the device photo picker below to capture or select a meal photo.'
          );
        }
      } finally {
        setIsInitializing(false);
      }
    },
    [stopStream]
  );

  useEffect(() => {
    if (!captured) {
      void startCamera(facingMode);
    }
    return () => {
      stopStream();
    };
  }, [facingMode, captured, startCamera, stopStream]);

  function handleCaptureFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError('Camera stream is not ready yet. Please wait a moment and try again.');
      return;
    }

    const maxDim = 1280;
    let width = video.videoWidth;
    let height = video.videoHeight;
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
      setCameraError('Could not process captured camera frame.');
      return;
    }

    ctx.drawImage(video, 0, 0, width, height);
    const previewUrl = canvas.toDataURL('image/jpeg', 0.85);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError('Unable to encode captured photo.');
          return;
        }
        const file = new File([blob], `meal_${Date.now()}.jpg`, {
          type: 'image/jpeg',
        });
        stopStream();
        setCaptured({ file, previewUrl });
      },
      'image/jpeg',
      0.85
    );
  }

  function handleFallbackFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      stopStream();
      setCaptured({
        file,
        previewUrl: String(reader.result || ''),
      });
    };
    reader.readAsDataURL(file);
  }

  async function handleSendNow() {
    if (!captured || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSendPhotoNow(captured.file, captured.previewUrl);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleAttach() {
    if (!captured) return;
    onAttachPhoto(captured.file, captured.previewUrl);
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="camera-modal-title"
      className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h3
              id="camera-modal-title"
              className="font-display text-base font-semibold text-slate-900"
            >
              Take Food Photo
            </h3>
            <p className="text-xs text-slate-500">
              Capture your meal for automatic AI nutrition analysis
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopStream();
              onClose();
            }}
            aria-label="Close camera"
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div className="relative aspect-[4/3] w-full rounded-2xl bg-slate-950 overflow-hidden flex items-center justify-center">
            {captured ? (
              <img
                src={captured.previewUrl}
                alt="Captured meal preview"
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className={`h-full w-full object-cover ${cameraError ? 'hidden' : ''}`}
                />
                {isInitializing && !cameraError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-slate-200 bg-slate-950/70">
                    <Loader2 className="h-6 w-6 animate-spin text-emerald-400" aria-hidden="true" />
                    <span>Starting camera...</span>
                  </div>
                )}
                {cameraError && (
                  <div className="p-6 text-center space-y-3 max-w-sm">
                    <AlertCircle className="h-7 w-7 text-amber-400 mx-auto" aria-hidden="true" />
                    <p className="text-xs text-slate-200 leading-relaxed">{cameraError}</p>
                    <button
                      type="button"
                      onClick={() => fallbackInputRef.current?.click()}
                      className="min-h-[44px] px-4 py-2 inline-flex items-center gap-2 rounded-xl bg-emerald-600 text-xs font-medium text-white hover:bg-emerald-500"
                    >
                      <Upload className="h-4 w-4" aria-hidden="true" />
                      <span>Open Device Camera / Picker</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <input
            ref={fallbackInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => handleFallbackFile(e.target.files)}
            className="hidden"
            aria-label="Capture photo with device camera"
          />

          {!captured ? (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() =>
                  setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
                }
                disabled={isInitializing || Boolean(cameraError)}
                className="min-h-[44px] px-3.5 py-2 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap"
              >
                <SwitchCamera className="h-4 w-4" aria-hidden="true" />
                <span>Flip camera</span>
              </button>

              <button
                type="button"
                onClick={handleCaptureFrame}
                disabled={isInitializing || Boolean(cameraError)}
                className="min-h-[48px] px-6 py-2.5 inline-flex items-center gap-2 rounded-xl bg-emerald-700 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-40 whitespace-nowrap"
              >
                <Camera className="h-4 w-4" aria-hidden="true" />
                <span>Capture Photo</span>
              </button>

              <button
                type="button"
                onClick={() => fallbackInputRef.current?.click()}
                className="min-h-[44px] px-3 py-2 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium text-slate-600 hover:bg-slate-100 whitespace-nowrap"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Device picker</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setCaptured(null)}
                className="min-h-[44px] px-3.5 py-2 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                <span>Retake</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleAttach}
                  className="min-h-[44px] px-4 py-2 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  <span>Attach to chat</span>
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void handleSendNow()}
                  className="min-h-[44px] px-5 py-2 inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 text-xs sm:text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>{isSubmitting ? 'Analyzing...' : 'Analyze Meal'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
