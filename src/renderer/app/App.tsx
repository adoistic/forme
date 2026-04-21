import React from "react";
import { Sidebar } from "../components/Sidebar.js";
import { Canvas } from "../components/Canvas.js";

export function App(): React.ReactElement {
  return (
    <div className="flex h-full w-full bg-bg-canvas">
      <Sidebar />
      <Canvas />
    </div>
  );
}
