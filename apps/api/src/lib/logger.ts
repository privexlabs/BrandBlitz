import winston from "winston";
import { config } from "./config";

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

export const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: combine(timestamp(), errors({ stack: true }), json()),
  defaultMeta: { service: "brandblitz-api" },
  transports: [
    new winston.transports.Console({
      format:
        config.NODE_ENV === "development"
          ? combine(colorize(), simple())
          : combine(timestamp(), json()),
    }),
  ],
});
