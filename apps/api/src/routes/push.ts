import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { authenticate } from "../middleware/authenticate";

const router = Router();
const SubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(16).max(512), auth: z.string().min(8).max(256) }),
});

router.use(authenticate);

router.post("/subscriptions", async (req, res) => {
  const subscription = SubscriptionSchema.parse(req.body);
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, endpoint) DO UPDATE
       SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, last_seen_at = NOW()`,
    [req.user!.sub, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
  );
  res.status(204).end();
});

router.delete("/subscriptions", async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.string().url().max(2048) }).parse(req.body);
  await query("DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2", [req.user!.sub, endpoint]);
  res.status(204).end();
});

export default router;
