import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { hasPg, pgQuery } from "./pg";

/**
 * Email+password auth (node:crypto scrypt — zero dependencies) with
 * httpOnly session cookies backed by Postgres. Requires DATABASE_URL:
 * without it the routes degrade to 503 so local dev stays file-only.
 */

const SESSION_COOKIE = "am_sid";
const SESSION_DAYS = 30;

// ── Password hashing ────────────────────────────────────────────────────────

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  try {
    const hash = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHash, "hex");
    return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
  } catch {
    return false;
  }
}

// ── Cookie helpers (manual parsing — no cookie-parser dep) ─────────────────

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

export function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/api; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/api; SameSite=Lax; Max-Age=0`);
}

// ── Sessions (Postgres) ─────────────────────────────────────────────────────

const uid = () => `u_${crypto.randomUUID()}`;

export async function createUser(email: string, password: string): Promise<{ id: string; email: string }> {
  const e = String(email).toLowerCase().trim();
  const { salt, hash } = hashPassword(password);
  const id = uid();
  await pgQuery("INSERT INTO users (id, email, pw_hash, salt) VALUES ($1,$2,$3,$4)", [id, e, hash, salt]);
  return { id, email: e };
}

export async function getUserByEmail(email: string): Promise<{ id: string; email: string; pwHash: string; salt: string } | null> {
  const r = await pgQuery<{ id: string; email: string; pw_hash: string; salt: string }>(
    "SELECT id, email, pw_hash, salt FROM users WHERE email=$1",
    [String(email).toLowerCase().trim()],
  );
  const row = r.rows[0];
  return row ? { id: row.id, email: row.email, pwHash: row.pw_hash, salt: row.salt } : null;
}

export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await pgQuery("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1,$2,$3)", [
    token,
    userId,
    new Date(Date.now() + SESSION_DAYS * 86400_000),
  ]);
  return token;
}

async function getSessionUser(token: string): Promise<{ id: string; email: string } | null> {
  const r = await pgQuery<{ id: string; email: string }>(
    `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  return r.rows[0] ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await pgQuery("DELETE FROM sessions WHERE token=$1", [token]);
}

// ── Middleware ──────────────────────────────────────────────────────────────

export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  req.user = null;
  try {
    const token = readCookie(req, SESSION_COOKIE);
    req.sessionToken = token;
    if (token && hasPg()) req.user = await getSessionUser(token);
  } catch (err) {
    req.log?.warn({ err }, "attachUser failed");
  }
  next();
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!hasPg()) {
    res.status(503).json({ error: "storage_unavailable" });
    return;
  }
  if (!req.user) {
    res.status(401).json({ error: "auth_required" });
    return;
  }
  next();
}

/** Per-IP sliding-minute limiter for credential endpoints. */
const hits = new Map<string, number>();
setInterval(() => hits.clear(), 60_000).unref();

export function rateLimit(maxPerMin: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip}:${Math.floor(Date.now() / 60_000)}`;
    const n = (hits.get(key) ?? 0) + 1;
    hits.set(key, n);
    if (n > maxPerMin) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    next();
  };
}
