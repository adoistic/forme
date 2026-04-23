import React, { useCallback, useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import { invoke } from "../../ipc/client.js";
import { useNavStore } from "../../stores/navigation.js";

// `<StorageThresholdBanner>` — app-shell banner that surfaces when the
// version-history disk usage crosses thresholds (T11 / v0.6).
// Per CEO plan G6 + ER2-3, ER2-4:
//   - hidden  : total < WARN_THRESHOLD
//   - warn    : total >= WARN_THRESHOLD AND not currently dismissed
//   - critical: total >= CRITICAL_THRESHOLD (always shown, no dismiss)
// After dismiss, the banner re-arms once the total grows by REARM_DELTA
// from the value at dismiss time. Dismissal state is in-memory only —
// persistent dismissal is deferred to a follow-up commit.

const WARN_THRESHOLD = 500 * 1_000_000; // 500 MB
const CRITICAL_THRESHOLD = 1_000 * 1_000_000; // 1 GB
const REARM_DELTA = 100 * 1_000_000; // re-arm once total grows by +100 MB

export type StorageBannerTier = "hidden" | "warn" | "critical";

export function deriveTier(currentTotal: number, dismissedAt: number | null): StorageBannerTier {
  if (currentTotal >= CRITICAL_THRESHOLD) return "critical";
  if (currentTotal < WARN_THRESHOLD) return "hidden";
  if (dismissedAt === null) return "warn";
  if (currentTotal >= dismissedAt + REARM_DELTA) return "warn";
  return "hidden";
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

export function StorageThresholdBanner(): React.ReactElement | null {
  const [currentTotal, setCurrentTotal] = useState<number>(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const setActiveTab = useNavStore((s) => s.setActiveTab);
  const setSettingsTab = useNavStore((s) => s.setSettingsTab);

  // Initial fetch + event subscription. The component needs the current
  // total before any `disk-usage-changed` event has fired.
  useEffect(() => {
    let cancelled = false;
    invoke("disk-usage:current", {})
      .then((usage) => {
        if (cancelled) return;
        setCurrentTotal(usage.total);
      })
      .catch(() => {
        // Initial fetch failure is silent — banner stays hidden until an
        // event lands. The Settings → Storage panel surfaces real errors.
      });
    const unsubscribe = window.forme.onDiskUsageChanged((usage) => {
      setCurrentTotal(usage.total);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const tier = deriveTier(currentTotal, dismissedAt);

  const handleDismiss = useCallback(() => {
    setDismissedAt(currentTotal);
  }, [currentTotal]);

  const handleManage = useCallback(() => {
    setSettingsTab("storage");
    setActiveTab("settings");
  }, [setActiveTab, setSettingsTab]);

  if (tier === "hidden") return null;

  const isCritical = tier === "critical";
  const formatted = formatBytes(currentTotal);
  const message = isCritical
    ? `${formatted} of version history. Storage is critically large.`
    : `${formatted} of version history.`;

  return (
    <div
      data-testid="storage-threshold-banner"
      data-tier={tier}
      role={isCritical ? "alert" : "status"}
      className={[
        "border-l-[1.5px] px-6 py-3 motion-reduce:transition-none",
        "flex w-full items-center justify-between gap-4",
        "transition-transform duration-base ease-decelerate",
        isCritical
          ? "bg-error-bg border-error text-error"
          : "bg-warning-bg border-warning text-warning",
      ].join(" ")}
    >
      <span className="text-body text-text-primary">{message}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleManage}
          data-testid="storage-threshold-banner-manage"
          className="text-body text-accent hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 rounded-sm"
        >
          Manage →
        </button>
        {!isCritical && (
          <button
            type="button"
            onClick={handleDismiss}
            data-testid="storage-threshold-banner-dismiss"
            aria-label="Dismiss"
            className="text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 rounded-sm p-1"
          >
            <X size={14} weight="bold" />
          </button>
        )}
      </div>
    </div>
  );
}
