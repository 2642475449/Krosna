import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./i18n";
import "./styles/global.css";
import "./styles/settings.css";
import { useAppStore, type ThemeCategory, type ThemeMode } from "./store";
import { startStorageDiagnostics, type StorageDiagnosticsController } from "./lib/storageDiagnostics";

declare global {
  interface Window {
    __KROSNA_STORAGE_DIAGNOSTICS__?: StorageDiagnosticsController;
    __KROSNA_STARTUP_THEME__?: {
      lightTheme: ThemeMode;
      darkTheme: ThemeMode;
      themeCategory: ThemeCategory;
      systemPrefersDark: boolean;
    };
  }
}

// 仅诊断窗口显式开启；默认不包装存储、不启动采样，也不记录存储正文。
if (new URLSearchParams(window.location.search).get("storageDiagnostics") === "1") {
  try {
    const diagnostics = startStorageDiagnostics({ enabled: true });
    if (diagnostics) {
      window.__KROSNA_STORAGE_DIAGNOSTICS__ = diagnostics;
      window.addEventListener("beforeunload", () => diagnostics.stop(), { once: true });
    }
  } catch {
    console.warn("Storage diagnostics could not be started.");
  }
}

const startupTheme = window.__KROSNA_STARTUP_THEME__;
if (startupTheme) {
  useAppStore.setState(startupTheme);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary scope="app">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
