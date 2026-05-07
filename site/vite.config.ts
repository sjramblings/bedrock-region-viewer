import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config for the aligned-port. Differences from the aws-ip-ranges
// reference:
//   * No `base:` override — this site deploys at the root of
//     awshostedmodels.sjramblings.io, not under a /aws-ip-ranges/ subpath
//   * Single entry — no separate globe.html; the Globe is rendered by the
//     main App alongside the (forthcoming) Hero / RegionAtlas / etc.
export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          d3: [
            "d3-geo",
            "d3-drag",
            "d3-scale",
            "d3-selection",
            "topojson-client",
          ],
        },
      },
    },
  },
});
