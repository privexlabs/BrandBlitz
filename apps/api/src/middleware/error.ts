import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";
import { BadRequestError } from "@stellar/stellar-sdk";
import { ZodError } from "zod";

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

/**
 * Express 5 global error handler.
 * Express 5 automatically catches async errors — no need for try/catch in route handlers.
 * All thrown errors land here.
 */
export function errorHandler(
  err: ApiError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  let statusCode = err.statusCode;
  let message = err.message;

  if (err instanceof ZodError) {
    statusCode = 400;
    message = "Validation Error";
  } else if (err instanceof BadRequestError) {
    statusCode = 400;
  }

  statusCode = statusCode ?? 500;
  const isServerError = statusCode >= 500;
  if (isServerError) {
    message = "Internal Server Error";
  }

  if (isServerError) {
    logger.error("Unhandled error", {
      err: err.message,
      stack: err.stack,
      method: req.method,
      url: req.url,
    });
  }

  const payload: Record<string, unknown> = {
    error: message,
  };

  if (err.code) {
    payload.code = err.code;
  }

  if (err instanceof ZodError) {
    payload.details = err.issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
      code: issue.code,
    }));
  }

  if (process.env.NODE_ENV === "development" && err.stack) {
    payload.stack = err.stack;
  }

  res.status(statusCode).json(payload);
}

export function createError(message: string, statusCode: number, code?: string): ApiError {
  const err = new Error(message) as ApiError;
  err.statusCode = statusCode;
  err.code = code;
  return err;
}
