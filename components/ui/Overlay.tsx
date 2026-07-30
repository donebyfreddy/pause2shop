"use client";

import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { Button } from "./Button";

/**
 * Drawer lateral y modal. Implementados a mano (sin Radix) porque solo
 * necesitamos: cierre con Escape, click en el backdrop, bloqueo de scroll y
 * foco inicial dentro del panel. Suficiente y sin dependencia extra.
 */

/** Escape + bloqueo del scroll del body mientras el overlay está abierto. */
function useOverlayBehaviour(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);
}

function Backdrop({ onClose }: { onClose: () => void }) {
  return (
    <motion.button
      type="button"
      aria-label="Cerrar"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-40 cursor-default bg-black/70 backdrop-blur-sm"
    />
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  footer,
  width = "lg",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  footer?: ReactNode;
  width?: "md" | "lg" | "xl";
  children: ReactNode;
}) {
  useOverlayBehaviour(open, onClose);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const widths = { md: "max-w-md", lg: "max-w-xl", xl: "max-w-3xl" }[width];

  return (
    <AnimatePresence>
      {open && (
        <>
          <Backdrop onClose={onClose} />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className={cn(
              "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-canvas-raised outline-none",
              widths
            )}
          >
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
                {subtitle && <p className="mt-0.5 text-xs text-ink-subtle">{subtitle}</p>}
              </div>
              <Button variant="ghost" size="xs" icon onClick={onClose} aria-label="Cerrar panel">
                <X className="size-4" aria-hidden />
              </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && (
              <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
                {footer}
              </footer>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  useOverlayBehaviour(open, onClose);

  return (
    <AnimatePresence>
      {open && (
        <>
          <Backdrop onClose={onClose} />
          <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ type: "spring", stiffness: 400, damping: 32 }}
              className="panel pointer-events-auto w-full max-w-md shadow-panel"
            >
              <div className="px-5 pt-5">
                <h2 className="text-sm font-semibold text-ink">{title}</h2>
                {description && (
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-subtle">{description}</p>
                )}
              </div>
              {children && <div className="px-5 py-4">{children}</div>}
              <div className="flex items-center justify-end gap-2 px-5 py-4">
                {footer ?? (
                  <Button variant="outline" size="sm" onClick={onClose}>
                    Cerrar
                  </Button>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
