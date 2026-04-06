import { defineConfig } from "vite";

/** Paths where `public/<name>/index.html` must be served (clean URLs without trailing slash). */
const LEGAL_ROOTS = ["/privacy", "/terms", "/data-deletion"];

function legalStaticMiddleware() {
  return (req, _res, next) => {
    const raw = req.url || "";
    const pathname = raw.split("?")[0];
    if (LEGAL_ROOTS.includes(pathname)) {
      const q = raw.includes("?") ? "?" + raw.split("?").slice(1).join("?") : "";
      req.url = pathname + "/index.html" + q;
    }
    next();
  };
}

export default defineConfig({
  plugins: [
    {
      name: "serve-legal-pages",
      configureServer(server) {
        server.middlewares.use(legalStaticMiddleware());
      },
      configurePreviewServer(server) {
        server.middlewares.use(legalStaticMiddleware());
      },
    },
  ],
});
