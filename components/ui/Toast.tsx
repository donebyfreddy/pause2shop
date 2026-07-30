"use client";

import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Toasts. Sin dependencias: un contexto + AnimatePresence bastan, y así el
 * estilo es exactamente el del resto del sistema.
 *
 * Se monta una sola vez en el layout raíz; cualquier componente cliente puede
 * hacer `const toast = useToast()`.
 */

type ToastTone = "success" | "error" | "warning" | "info";

type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
};

type ToastApi = {
  show: (toast: Omit<Toast, "id">) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const TONE_CONFIG: Record<ToastTone, { icon: typeof Info; className: string }> = {
  success: { icon: CircleCheck, className: "text-success" },
  error: { icon: CircleAlert, className: "text-danger" },
  warning: { icon: TriangleAlert, className: "text-warning" },
  info: { icon: Info, className: "text-info" },
};

const DURATION_MS = 5200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
      // Auto-cierre. No hace falta limpiar el timer: si el toast ya se cerró a
      // mano, el filtro por id simplemente no encuentra nada.
      setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss]
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, description) => show({ tone: "success", title, description }),
      error: (title, description) => show({ tone: "error", title, description }),
      warning: (title, description) => show({ tone: "warning", title, description }),
      info: (title, description) => show({ tone: "info", title, description }),
    }),
    [show]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-100 flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const { icon: Icon, className } = TONE_CONFIG[toast.tone];
            return (
              <motion.output
                key={toast.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24, scale: 0.97 }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="panel pointer-events-auto flex w-full max-w-sm items-start gap-3 px-4 py-3 shadow-panel"
              >
                <Icon className={cn("mt-px size-4 shrink-0", className)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink">{toast.title}</p>
                  {toast.description && (
                    <p className="mt-0.5 text-xs leading-relaxed break-words text-ink-subtle">
                      {toast.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  aria-label="Cerrar aviso"
                  className="-mr-1 rounded-md p-1 text-ink-faint transition-colors hover:text-ink"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </motion.output>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Nunca lanza si falta el provider: devuelve una API que no hace nada visible
 * pero deja rastro en consola. Un toast no es motivo para romper una pantalla.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  return useMemo<ToastApi>(() => {
    if (ctx) return ctx;
    const warn = (title: string, description?: string) =>
      console.warn("[toast sin ToastProvider]", title, description ?? "");
    return {
      show: ({ title, description }) => warn(title, description),
      success: warn,
      error: warn,
      warning: warn,
      info: warn,
    };
  }, [ctx]);
}
