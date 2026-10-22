import { defineConfig } from "vite";
import { resolve } from "node:path";

// GitHub Pages 配信のため base は相対パス、出力はリポジトリ直下 docs/
export default defineConfig({
  root: __dirname,
  base: "./",
  server: { port: 5199, strictPort: true },
  build: {
    outDir: resolve(__dirname, "../docs"),
    emptyOutDir: true,
    rollupOptions: {
      // 通常ページと、元のサンプルを見せる /original/ の 2 ページ
      input: { main: resolve(__dirname, "index.html"), original: resolve(__dirname, "original/index.html") },
    },
  },
});
