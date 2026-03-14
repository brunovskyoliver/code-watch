import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared")
    }
  },
  build: {
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: "src/preload/preload.ts",
      formats: ["cjs"],
      fileName: () => "preload.js"
    },
    rollupOptions: {
      external: [
        "electron"
      ],
      output: {
        entryFileNames: "preload.js"
      }
    }
  }
});
