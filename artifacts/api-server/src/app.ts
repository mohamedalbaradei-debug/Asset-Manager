import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { existsSync } from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { attachUser } from "./lib/auth";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Populate req.user from the session cookie before any route runs.
app.use("/api", attachUser, router);

// Serve the built frontend when present (single-service deployment, e.g. Render).
const webDist = path.resolve(
  process.env.WEB_DIST ?? path.resolve(process.cwd(), "artifacts/investment-app/dist"),
);

if (existsSync(webDist)) {
  app.use(express.static(webDist));
  // Express 5: use middleware instead of "*" route for the SPA fallback.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(path.join(webDist, "index.html"));
  });
}

export default app;
