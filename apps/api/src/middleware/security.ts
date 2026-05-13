import type { Express } from "express";
import helmet from "helmet";
import cors from "cors";
import type { Config } from "../lib/config";

export type SecurityConfig = Pick<
  Config,
  "NODE_ENV" | "WEB_URL" | "NEXT_PUBLIC_APP_URL" | "S3_PUBLIC_URL"
>;

const STELLAR_EXPERT_API_ORIGIN = "https://api.stellar.expert";

function originFromUrl(url: string): string {
  return new URL(url).origin;
}

export function applySecurityMiddleware(app: Express, config: SecurityConfig): void {
  const appOrigin = originFromUrl(config.NEXT_PUBLIC_APP_URL ?? config.WEB_URL);
  const cdnOrigin = originFromUrl(config.S3_PUBLIC_URL);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          connectSrc: ["'self'", STELLAR_EXPERT_API_ORIGIN, cdnOrigin],
          fontSrc: ["'self'", cdnOrigin],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          imgSrc: ["'self'", cdnOrigin],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
        },
      },
      hsts:
        config.NODE_ENV === "production"
          ? {
              maxAge: 31_536_000,
              includeSubDomains: true,
              preload: true,
            }
          : false,
      referrerPolicy: {
        policy: "strict-origin-when-cross-origin",
      },
    })
  );

  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin) {
          callback(null, true);
          return;
        }

        callback(null, origin === appOrigin);
      },
    })
  );
}
