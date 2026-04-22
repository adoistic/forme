import React, { createContext, useCallback, useContext, useState } from "react";

// Minimal toast system. Used by IPC error handlers + success messages.
// Replace with Radix Toast when polish phase lands.

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  push: (kind: ToastKind, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed right-6 bottom-6 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            data-testid={`toast-${t.kind}`}
            className={[
              "bg-bg-surface text-body pointer-events-auto max-w-[480px] min-w-[260px] rounded-md border px-5 py-3 shadow-md",
              t.kind === "success" ? "border-success" : "",
              t.kind === "error" ? "border-error" : "",
              t.kind === "info" ? "border-border-default" : "",
            ].join(" ")}
          >
            <div
              className={[
                "text-label-caps mb-1",
                t.kind === "success" ? "text-success" : "",
                t.kind === "error" ? "text-error" : "",
                t.kind === "info" ? "text-text-secondary" : "",
              ].join(" ")}
            >
              {t.kind}
            </div>
            <div className="text-text-primary break-words whitespace-pre-wrap">{t.message}</div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
