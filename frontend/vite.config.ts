import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    {
      // SPA fallback: rewrite any navigation request (no file extension, not a
      // Vite-internal path) to /index.html so the client-side router takes over.
      // This replaces historyApiFallback which was causing a redirect to / instead
      // of an in-place rewrite, breaking page refreshes on /combiner etc.
      name: "spa-fallback",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const pathname = (req.url ?? "/").split("?")[0];
          if (!pathname.includes(".") && !pathname.startsWith("/@")) {
            req.url = "/index.html";
          }
          next();
        });
      },
    },
  ],
});
