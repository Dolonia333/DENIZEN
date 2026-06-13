import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "/crm/",
  build: {
    outDir: path.resolve(__dirname, "../dist"),
    emptyOutDir: true,
    modulePreload: {
      resolveDependencies(_filename, deps) {
        return deps.filter((dep) => !/recharts|SalesSection|NotesTab|ScheduleSection|GlobalTeamChat/i.test(dep));
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("recharts") || id.includes("d3-")) return "recharts";
          if (id.includes("@radix-ui")) return "radix";
          if (id.includes("@tanstack/react-query")) return "query";
          if (id.includes("react-dom") || id.includes("react-router") || /\/react\//.test(id)) {
            return "react-vendor";
          }
        },
      },
    },
  },
  server: {
    host: "::",
    port: 8090,
    hmr: {
      overlay: false,
    },
    // CRM dev UI (8090) → Denizen API (8080/8081). Use /crm/ via Denizen server in prod.
    proxy: {
      "/api": {
        target: process.env.VITE_DENIZEN_API || "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
