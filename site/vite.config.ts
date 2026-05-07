import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config for the aligned-port. Mirrors sjramblings/aws-ip-ranges
// configuration:
//   * `base: "/bedrock-region-viewer/"` — this site deploys to GitHub
//     Pages at sjramblings.github.io/bedrock-region-viewer/, so all
//     asset URLs need that prefix. (Matches aws-ip-ranges' `/aws-ip-ranges/`
//     base.) The legacy Amplify deploy at awshostedmodels.sjramblings.io
//     continues to serve the vanilla `public/` site, untouched.
//   * Single entry — no separate globe.html; the Globe is rendered by the
//     main App alongside the (forthcoming) Hero / RegionAtlas / etc.
export default defineConfig({
  base: "/bedrock-region-viewer/",
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
