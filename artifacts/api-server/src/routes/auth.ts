import { Router } from "express";
import type { IRouter, Request, Response } from "express";
import { logger } from "../lib/logger";
import {
  attachUser,
  createUser,
  getUserByEmail,
  createSession,
  deleteSession,
  setSessionCookie,
  clearSessionCookie,
  requireUser,
  rateLimit,
  verifyPassword,
} from "../lib/auth";
import { hasPg } from "../lib/pg";

const router: IRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get("/auth/me", (req: Request, res: Response): void => {
  res.json({ user: req.user ?? null });
});

router.post("/auth/register", rateLimit(10), async (req: Request, res: Response): Promise<void> => {
  if (!hasPg()) {
    res.status(503).json({ error: "storage_unavailable" });
    return;
  }
  const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
  if (!email || !EMAIL_RE.test(String(email))) {
    res.status(400).json({ error: "invalid_email" });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "password_too_short" });
    return;
  }
  try {
    if (await getUserByEmail(email)) {
      res.status(409).json({ error: "email_taken" });
      return;
    }
    const user = await createUser(email, password);
    const token = await createSession(user.id);
    req.log?.info({ email: user.email }, "user registered");
    setSessionCookie(res, token);
    res.json({ user });
  } catch (err) {
    logger.warn({ err }, "register failed");
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/auth/login", rateLimit(10), async (req: Request, res: Response): Promise<void> => {
  if (!hasPg()) {
    res.status(503).json({ error: "storage_unavailable" });
    return;
  }
  const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
  try {
    const u = email ? await getUserByEmail(email) : null;
    if (!u || typeof password !== "string" || !verifyPassword(password, u.salt, u.pwHash)) {
      res.status(401).json({ error: "bad_credentials" });
      return;
    }
    const token = await createSession(u.id);
    setSessionCookie(res, token);
    res.json({ user: { id: u.id, email: u.email } });
  } catch (err) {
    logger.warn({ err }, "login failed");
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/auth/logout", requireUser, async (req: Request, res: Response): Promise<void> => {
  try {
    if (req.sessionToken) await deleteSession(req.sessionToken);
  } finally {
    clearSessionCookie(res);
    res.json({ ok: true });
  }
});

export default router;
