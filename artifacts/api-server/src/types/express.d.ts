import type { Request } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; email: string; tier?: string } | null;
      sessionToken?: string | null;
    }
  }
}

export type AuthUser = NonNullable<Request["user"]>;
export {};
