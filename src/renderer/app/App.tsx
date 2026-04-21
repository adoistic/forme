import React, { useEffect } from "react";
import { Sidebar } from "../components/Sidebar.js";
import { Canvas } from "../components/Canvas.js";
import { ToastProvider } from "../components/Toast.js";
import { useIssueStore, useShallow } from "../stores/issue.js";

export function App(): React.ReactElement {
  const refreshAll = useIssueStore(useShallow((s) => s.refreshAll));

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  return (
    <ToastProvider>
      <div className="flex h-full w-full bg-bg-canvas">
        <Sidebar />
        <Canvas />
      </div>
    </ToastProvider>
  );
}
