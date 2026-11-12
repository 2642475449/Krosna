// Synthetic content only. The runner stubs native IPC before loading this page.
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import "../src/i18n";
import MonacoTextEditor from "../src/components/editors/MonacoTextEditor";
import { MonacoDiffEditor } from "../src/components/editors/MonacoDiffEditor";
import * as monaco from "../src/lib/monacoRuntime";

const root = createRoot(document.getElementById("root")!);
const original = Array.from({ length: 200 }, (_, i) => `const value${i}: number = ${i};`).join("\n");
let value = original;
let active = { left: true, right: false, diff: true };
function render() {
  flushSync(() => root.render(<main style={{ display: "flex", height: 500 }}>
    <section style={{ display: active.left ? "flex" : "none", width: 550 }}>
      <MonacoTextEditor filePath="C:/synthetic-editor-probe/left.ts" value={value} readOnly={false}
        isActive={active.left} onChange={(next) => { value = next; }} />
    </section>
    <section style={{ display: active.right ? "flex" : "none", width: 550 }}>
      <MonacoTextEditor filePath="C:/synthetic-editor-probe/right.html" value="<h1>Review</h1>" readOnly
        isActive={active.right} onChange={() => {}} />
    </section>
    <section style={{ display: active.diff ? "block" : "none", width: 550 }}>
      <MonacoDiffEditor original={original} modified={original.replace("= 42;", "= 43;")} language="typescript"
        isActive={active.diff} options={{ readOnly: true, automaticLayout: true }} />
    </section>
  </main>));
}
function editor() {
  const instance = monaco.editor.getEditors().find((item) => item.getModel()?.uri.path.endsWith("/left.ts"));
  if (!instance) throw new Error("Left editor is not mounted");
  return instance;
}
function snapshot() {
  const instance = monaco.editor.getEditors().find((item) => item.getModel()?.uri.path.endsWith("/left.ts"));
  const diff = monaco.editor.getDiffEditors()[0]?.getModifiedEditor();
  return {
    models: monaco.editor.getModels().length,
    left: instance ? { model: instance.getModel()!.id, position: instance.getPosition(), scrollTop: instance.getScrollTop(), value: instance.getValue() } : null,
    diff: diff ? { position: diff.getPosition(), scrollTop: diff.getScrollTop() } : null,
  };
}
Object.assign(window, { editorMemoryProbe: {
  snapshot,
  setActive(next: typeof active) { active = next; render(); },
  position() { const instance = editor(); instance.setPosition({ lineNumber: 80, column: 4 }); instance.setScrollTop(1000); },
  diffPosition() { const instance = monaco.editor.getDiffEditors()[0].getModifiedEditor(); instance.setPosition({ lineNumber: 90, column: 4 }); instance.setScrollTop(1200); },
  edit() { const instance = editor(); instance.pushUndoStop(); instance.executeEdits("probe", [{ range: new monaco.Range(1, 1, 1, 1), text: "// edit\n" }]); instance.pushUndoStop(); },
  undo() { editor().trigger("probe", "undo", {}); },
  close() { flushSync(() => root.render(null)); },
  tokens() { return monaco.editor.tokenize("const value: number = 1;", "typescript")[0].map((token) => token.type); },
  json() {
    const container = document.createElement("div"); document.body.append(container);
    const model = monaco.editor.createModel('{"broken": }', "json");
    const instance = monaco.editor.create(container, { model });
    return new Promise<boolean>((resolve) => {
      const interval = setInterval(() => {
        if (!monaco.editor.getModelMarkers({ resource: model.uri }).length) return;
        clearInterval(interval); clearTimeout(timeout); instance.dispose(); model.dispose(); container.remove(); resolve(true);
      }, 50);
      const timeout = setTimeout(() => { clearInterval(interval); instance.dispose(); model.dispose(); container.remove(); resolve(false); }, 10_000);
    });
  },
} });
render();
