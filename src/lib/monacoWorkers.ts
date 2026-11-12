import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

// Let Vite resolve worker URLs in development and emit local assets for Tauri.
globalThis.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case "json": return new JsonWorker();
      default: return new EditorWorker();
    }
  },
};
