import type { Express } from "express";
import authRoutes from "./auth";
import brandsRoutes from "./brands";
import challengesRoutes from "./challenges";
import sessionsRoutes from "./sessions";
import uploadRoutes from "./upload";
import usersRoutes from "./users";
import leaderboardRoutes from "./leaderboard";
import webhooksRoutes from "./webhooks";
import leaguesRoutes from "./leagues";
import adminConfigRoutes from "./admin/config";
import adminUsersRoutes from "./admin/users";
import adminFraudRoutes from "./admin/fraud";
import adminChallengesRoutes from "./admin/challenges";
import adminEscrowRoutes from "./admin/escrow";
import adminAuditLogRoutes from "./admin/audit-log";
import adminPayoutsRoutes from "./admin/payouts";
import adminStatsRoutes from "./admin/stats";
import adminWaitlistRoutes from "./admin/waitlist";
import adminRoutes from "./admin";
import deleteAccountRoutes from "./me/delete-account";
import docsRoutes from "./docs";
import cspReportRoutes from "./csp-report";
import legalRoutes from "./legal";
import configRoutes from "./config";
import adminCacheRoutes from "./admin/cache";
import metricsRoutes from "./metrics";
import waitlistRoutes from "./waitlist";

export function registerRoutes(app: Express): void {
  // #143 — interactive OpenAPI 3.1 docs at /docs (Scalar UI) plus
  // the JSON spec at /docs/openapi.json. Mounted first so it can't
  // be accidentally shadowed by a route added below.
  app.use("/docs", docsRoutes);
  app.use("/metrics", metricsRoutes);
  app.use("/csp-report", cspReportRoutes);
  app.use("/legal", legalRoutes);
  app.use("/config", configRoutes);
  app.use("/auth", authRoutes);
  app.use("/brands", brandsRoutes);
  app.use("/challenges", challengesRoutes);
  app.use("/sessions", sessionsRoutes);
  app.use("/upload", uploadRoutes);
  app.use("/users", usersRoutes);
  app.use("/leaderboard", leaderboardRoutes);
  app.use("/webhooks", webhooksRoutes);
  app.use("/leagues", leaguesRoutes);
  // General admin endpoints — mounted before specific /admin/* sub-routers
  // so that routes like GET /admin/users (with fraud-score enrichment) are
  // matched first. Specific sub-routers handle the remaining paths.
  app.use("/admin", adminRoutes);
  app.use("/admin/config", adminConfigRoutes);
  app.use("/admin/users", adminUsersRoutes);
  app.use("/admin/fraud-flags", adminFraudRoutes);
  app.use("/admin/challenges", adminChallengesRoutes);
  app.use("/admin/cache", adminCacheRoutes);
  app.use("/admin/escrow", adminEscrowRoutes);
  app.use("/admin/audit-log", adminAuditLogRoutes);
  app.use("/admin/payouts", adminPayoutsRoutes);
  app.use("/admin/stats", adminStatsRoutes);
  app.use("/admin/waitlist", adminWaitlistRoutes);
  app.use("/me/delete-account", deleteAccountRoutes);
  app.use("/waitlist", waitlistRoutes);
}
