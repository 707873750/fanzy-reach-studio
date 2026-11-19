import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./style.css";
import { startUiPerformanceMonitor } from "./performance-monitor";

const stopPerformanceMonitor = startUiPerformanceMonitor();
window.addEventListener("pagehide", stopPerformanceMonitor, {once:true});
if (import.meta.hot) import.meta.hot.dispose(stopPerformanceMonitor);

window.addEventListener("error", event => {
  void window.reach?.reportRendererError?.(event.message, event.error?.stack)?.catch(() => {});
});
window.addEventListener("unhandledrejection", event => {
  const error = event.reason;
  void window.reach?.reportRendererError?.(error instanceof Error ? error.message : String(error), error instanceof Error ? error.stack : undefined)?.catch(() => {});
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
