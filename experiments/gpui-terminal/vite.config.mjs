import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL("./web", import.meta.url)),
  base: "./",
  build: { target: "esnext", outDir: "../dist", emptyOutDir: true },
});
