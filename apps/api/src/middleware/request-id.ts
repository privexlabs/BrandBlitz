import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

declare global {
  namespace Express {
    interface Locals {
      requestId: string;
    }
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const clientId = req.headers["x-request-id"] as string | undefined;
  let id: string;

  if (clientId && UUID_REGEX.test(clientId)) {
    id = clientId;
  } else {
    id = randomUUID();
  }

  res.locals.requestId = id;
  res.setHeader("X-Request-ID", id);
  next();
}
