/**
 * @vitest-environment jsdom
 *
 * Unit tests for `<StorageThresholdBanner>` (T11 / v0.6).
 *
 * Mocks the IPC client + the preload-exposed `window.forme.onDiskUsageChanged`
 * so the component can be driven without spinning up Electron. We capture
 * the registered event listener so each test can simulate a usage update.
 */
import React from "react";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { DiskUsageSnapshot } from "../../../src/shared/ipc-contracts/channels.js";

// Mock the IPC client BEFORE importing the component.
vi.mock("../../../src/renderer/ipc/client.js", () => ({
  invoke: vi.fn(),
  IpcError: class IpcError extends Error {},
}));

// Mock the navigation store so we can assert on Manage → behavior without
// pulling in the real Zustand store across tests.
const mockedSetActiveTab = vi.fn();
vi.mock("../../../src/renderer/stores/navigation.js", () => ({
  useNavStore: (selector: (s: { setActiveTab: (tab: string) => void }) => unknown) =>
    selector({ setActiveTab: mockedSetActiveTab }),
}));

import { invoke } from "../../../src/renderer/ipc/client.js";
import {
  StorageThresholdBanner,
  deriveTier,
  formatBytes,
} from "../../../src/renderer/components/storage-threshold-banner/StorageThresholdBanner.js";

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const MB = 1_000_000;
const GB = 1_000_000_000;

let diskUsageListener: ((usage: DiskUsageSnapshot) => void) | null = null;
let unsubscribeSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedSetActiveTab.mockReset();
  unsubscribeSpy = vi.fn();
  diskUsageListener = null;

  // Stub the preload bridge. Capture the callback so tests can simulate
  // event-driven usage updates.
  Object.defineProperty(window, "forme", {
    writable: true,
    configurable: true,
    value: {
      invoke: vi.fn(),
      on: vi.fn(),
      onDiskUsageChanged: vi.fn((cb: (usage: DiskUsageSnapshot) => void) => {
        diskUsageListener = cb;
        return unsubscribeSpy;
      }),
      platform: "darwin",
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderBanner(initialTotal: number): Promise<ReturnType<typeof render>> {
  mockedInvoke.mockResolvedValueOnce({
    snapshots: initialTotal,
    blobs: 0,
    total: initialTotal,
  } satisfies DiskUsageSnapshot);
  const utils = render(<StorageThresholdBanner />);
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}

function emitUsage(total: number): void {
  const listener = diskUsageListener;
  if (!listener) throw new Error("disk-usage listener was never registered");
  act(() => {
    listener({ snapshots: total, blobs: 0, total });
  });
}

describe("deriveTier (pure helper)", () => {
  test("hidden when below 500 MB", () => {
    expect(deriveTier(0, null)).toBe("hidden");
    expect(deriveTier(499 * MB, null)).toBe("hidden");
  });

  test("warn at 500 MB through < 1 GB when not dismissed", () => {
    expect(deriveTier(500 * MB, null)).toBe("warn");
    expect(deriveTier(900 * MB, null)).toBe("warn");
  });

  test("critical at 1 GB and above, regardless of dismissal", () => {
    expect(deriveTier(1 * GB, null)).toBe("critical");
    expect(deriveTier(1.5 * GB, 1.5 * GB)).toBe("critical");
  });

  test("hidden after dismissal until +100 MB re-arm", () => {
    expect(deriveTier(600 * MB, 600 * MB)).toBe("hidden");
    expect(deriveTier(650 * MB, 600 * MB)).toBe("hidden");
    expect(deriveTier(699 * MB, 600 * MB)).toBe("hidden");
    expect(deriveTier(700 * MB, 600 * MB)).toBe("warn");
  });
});

describe("formatBytes (pure helper)", () => {
  test("formats GB with one decimal", () => {
    expect(formatBytes(1.2 * GB)).toBe("1.2 GB");
  });

  test("formats MB as integer", () => {
    expect(formatBytes(510 * MB)).toBe("510 MB");
  });
});

describe("<StorageThresholdBanner>", () => {
  test("renders nothing when total < 500MB", async () => {
    await renderBanner(100 * MB);
    expect(screen.queryByTestId("storage-threshold-banner")).toBeNull();
  });

  test("renders warn tier when total = 600MB", async () => {
    await renderBanner(600 * MB);
    const banner = screen.getByTestId("storage-threshold-banner");
    expect(banner.getAttribute("data-tier")).toBe("warn");
    expect(banner.textContent).toContain("600 MB of version history.");
    expect(banner.className).toContain("bg-warning-bg");
    expect(banner.className).toContain("border-warning");
  });

  test("renders critical tier when total = 1.5GB", async () => {
    await renderBanner(1.5 * GB);
    const banner = screen.getByTestId("storage-threshold-banner");
    expect(banner.getAttribute("data-tier")).toBe("critical");
    expect(banner.textContent).toContain("1.5 GB of version history.");
    expect(banner.textContent).toContain("Storage is critically large.");
    expect(banner.className).toContain("bg-error-bg");
    expect(banner.className).toContain("border-error");
  });

  test("critical tier has no dismiss button", async () => {
    await renderBanner(1.2 * GB);
    expect(screen.queryByTestId("storage-threshold-banner-dismiss")).toBeNull();
    // But Manage → is still there.
    expect(screen.getByTestId("storage-threshold-banner-manage")).toBeTruthy();
  });

  test("click dismiss on warn → banner hides", async () => {
    await renderBanner(600 * MB);
    expect(screen.getByTestId("storage-threshold-banner")).toBeTruthy();
    fireEvent.click(screen.getByTestId("storage-threshold-banner-dismiss"));
    expect(screen.queryByTestId("storage-threshold-banner")).toBeNull();
  });

  test("after dismiss at 600MB, total grows to 650MB → banner stays hidden", async () => {
    await renderBanner(600 * MB);
    fireEvent.click(screen.getByTestId("storage-threshold-banner-dismiss"));
    expect(screen.queryByTestId("storage-threshold-banner")).toBeNull();

    emitUsage(650 * MB);
    expect(screen.queryByTestId("storage-threshold-banner")).toBeNull();
  });

  test("after dismiss at 600MB, total grows to 750MB → banner reappears (re-armed)", async () => {
    await renderBanner(600 * MB);
    fireEvent.click(screen.getByTestId("storage-threshold-banner-dismiss"));
    expect(screen.queryByTestId("storage-threshold-banner")).toBeNull();

    emitUsage(750 * MB);
    const banner = screen.getByTestId("storage-threshold-banner");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("750 MB of version history.");
  });

  test("initial mount fetches current usage via IPC", async () => {
    await renderBanner(700 * MB);
    expect(mockedInvoke).toHaveBeenCalledWith("disk-usage:current", {});
  });

  test("subscribes to disk-usage-changed on mount, unsubscribes on unmount", async () => {
    const { unmount } = await renderBanner(100 * MB);
    expect(window.forme.onDiskUsageChanged).toHaveBeenCalledTimes(1);
    expect(unsubscribeSpy).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  test("Manage → switches the active tab to settings", async () => {
    await renderBanner(600 * MB);
    fireEvent.click(screen.getByTestId("storage-threshold-banner-manage"));
    expect(mockedSetActiveTab).toHaveBeenCalledWith("settings");
  });

  test("event-driven update can lift tier from hidden to warn", async () => {
    await renderBanner(100 * MB);
    expect(screen.queryByTestId("storage-threshold-banner")).toBeNull();
    emitUsage(550 * MB);
    expect(screen.getByTestId("storage-threshold-banner").getAttribute("data-tier")).toBe("warn");
  });

  test("event-driven update can lift tier from warn to critical", async () => {
    await renderBanner(600 * MB);
    expect(screen.getByTestId("storage-threshold-banner").getAttribute("data-tier")).toBe("warn");
    emitUsage(1.1 * GB);
    expect(screen.getByTestId("storage-threshold-banner").getAttribute("data-tier")).toBe(
      "critical"
    );
    // Critical: dismiss vanishes even if it had been there before.
    expect(screen.queryByTestId("storage-threshold-banner-dismiss")).toBeNull();
  });
});
