import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import agents from "agents/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    agents(),
    react(),
    cloudflare({
      // Workers AI has no local simulator, so the plugin's default
      // (remote bindings on) waits for `wrangler login` before the server
      // listens. Leave this off for the teaching loop. Set
      // CLOUDFLARE_REMOTE_BINDINGS=true after logging in to call Workers AI.
      remoteBindings: process.env.CLOUDFLARE_REMOTE_BINDINGS === "true",
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 43123,
    strictPort: true,
  },
});
