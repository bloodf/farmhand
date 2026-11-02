import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // @farmhand/contracts reads host interfaces on the server; the browser never needs them.
      "node:os": fileURLToPath(new URL("./src/lib/node-os-shim.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: `http://127.0.0.1:${process.env.FARMHAND_API_PORT ?? "3490"}`, changeOrigin: false },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
