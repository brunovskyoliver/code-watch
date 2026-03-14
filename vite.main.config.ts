import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@main": path.resolve(__dirname, "src/main"),
      "@shared": path.resolve(__dirname, "src/shared")
    }
  },
  build: {
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: "src/main/main.ts",
      formats: ["cjs"],
      fileName: () => "main.js"
    },
    rollupOptions: {
      external: [
        "better-sqlite3",
        "chokidar",
        "electron",
        "electron-log",
        "node:child_process",
        "node:crypto",
        "node:events",
        "node:fs",
        "node:os",
        "node:path",
        "node:util"
      ],
      output: {
        entryFileNames: "main.js"
      }
    }
  }
});
