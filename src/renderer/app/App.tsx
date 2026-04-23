import React, { useEffect } from "react";
import { Sidebar } from "../components/Sidebar.js";
import { Canvas } from "../components/Canvas.js";
import { ToastProvider } from "../components/Toast.js";
import { StorageThresholdBanner } from "../components/storage-threshold-banner/StorageThresholdBanner.js";
import { useIssueStore, useShallow } from "../stores/issue.js";

export function App(): React.ReactElement {
  const refreshAll = useIssueStore(useShallow((s) => s.refreshAll));

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  return (
    <ToastProvider>
      <div className="bg-bg-canvas flex h-full w-full flex-col">
        <StorageThresholdBanner />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <Canvas />
        </div>
      </div>
    </ToastProvider>
  );
}
