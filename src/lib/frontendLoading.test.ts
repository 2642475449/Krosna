import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import { expect, it } from "vitest";

function readStaticGraph(entry: string) {
  const root = path.resolve(import.meta.dirname, "../..");
  const config = JSON.parse(readFileSync(path.join(root, "tsconfig.json"), "utf8")) as {
    compilerOptions: { paths: Record<string, string[]> };
  };
  const visited = new Set<string>();
  const eagerPackages = new Set<string>();

  function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = parse(readFileSync(file, "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"] });
    for (const statement of source.program.body) {
      if (statement.type !== "ImportDeclaration" && statement.type !== "ExportNamedDeclaration"
        && statement.type !== "ExportAllDeclaration") continue;
      if (statement.type === "ImportDeclaration") {
        if (statement.importKind === "type") continue;
        if (statement.specifiers.length > 0 && statement.specifiers.every((item) =>
          item.type === "ImportSpecifier" && item.importKind === "type")) continue;
      } else if (statement.exportKind === "type") {
        continue;
      }
      const specifier = statement.source?.value;
      if (!specifier) continue;
      eagerPackages.add(specifier);
      let local = specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : null;
      for (const [alias, targets] of Object.entries(config.compilerOptions.paths)) {
        const wildcard = alias.endsWith("*");
        const prefix = wildcard ? alias.slice(0, -1) : alias;
        if (wildcard ? specifier.startsWith(prefix) : specifier === alias) {
          local = path.resolve(root, targets[0].replace("*", specifier.slice(prefix.length)));
          break;
        }
      }
      if (!local) continue;
      const resolved = [local, `${local}.ts`, `${local}.tsx`, path.join(local, "index.ts"), path.join(local, "index.tsx")]
        .find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate));
      if (resolved) {
        visit(resolved);
      }
    }
  }

  // 检查整个入口依赖链，防止其他常驻弹窗再次绕过编辑器的 lazy 边界。
  visit(path.join(root, entry));
  return { eagerPackages, files: [...visited].map((file) => path.relative(root, file).replaceAll("\\", "/")) };
}

it.each(["src/main.tsx", "src/components/MainWindow.tsx"])(
  "keeps editor and syntax-highlighting runtimes out of the static graph of %s", (entry) => {
    const { eagerPackages } = readStaticGraph(entry);
    expect([...eagerPackages].filter((name) =>
      /^(monaco-editor|@monaco-editor\/react|@shikijs\/|@wooorm\/starry-night)/.test(name),
    )).toEqual([]);
  },
);

it.each([
  "src/components/editors/MonacoTextEditor.tsx",
  "src/components/GitDiffTabView.tsx",
  "src/components/GitConflictTabView.tsx",
])("keeps full Monaco and compiler services out of the editor graph of %s", (entry) => {
  const { eagerPackages } = readStaticGraph(entry);
  expect([...eagerPackages].filter((name) => name === "monaco-editor"
    || /monaco-editor\/esm\/vs\/(?:editor\/editor\.main|language\/(?:typescript|html|css)\/)/.test(name),
  )).toEqual([]);
});

it.each([
  "src/main.tsx",
  "src/components/VoiceOverlayWindow.tsx",
  "src/components/VoiceWorkerWindow.tsx",
])("keeps workspace UI and project services out of the voice startup graph of %s", (entry) => {
  const { files } = readStaticGraph(entry);
  expect(files.filter((file) =>
    file === "src/components/MainWindow.tsx"
    || file === "src/components/BackgroundCloseController.tsx"
    || file.startsWith("src/components/layout/")
    || file === "src/hooks/useRecentProjectSync.ts"
    || file === "src/store/slices/sessionTitleSlice.ts"
    || file === "src/store/slices/clipboardCache.ts",
  )).toEqual([]);
});
