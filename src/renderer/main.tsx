import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import "./styles/globals.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Forme: #root element missing from index.html");
}
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
