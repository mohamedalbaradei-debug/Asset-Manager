import app from "./app";
import { logger } from "./lib/logger";
import { startAlertLoop, startDigestLoop } from "./lib/notify";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Keep Render free instances warm + drive the price-alert checker.
  const selfUrl = process.env["SELF_URL"];
  if (selfUrl) {
    setInterval(() => {
      fetch(`${selfUrl}/api/healthz`).catch(() => {});
    }, 14 * 60_000).unref();
  }
  startAlertLoop();
  startDigestLoop();
});
