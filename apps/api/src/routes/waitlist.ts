import { Router } from "express";
import { z } from "zod";
import { query } from "../db/index";
import { createError } from "../middleware/error";
import { apiLimiter, waitlistLimiter } from "../middleware/rate-limit";

const router = Router();

const WaitlistSchema = z.object({
  email: z.string().trim().email().max(254),
  referral_code: z.string().max(64).optional(),
});

router.post("/", waitlistLimiter, async (req, res) => {
  const parsed = WaitlistSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Validation Error", details: parsed.error.issues });
    return;
  }

  const body = parsed.data;
  const email = body.email.toLowerCase().trim();

  const result = await query<{ id: string }>(
    `INSERT INTO waitlist (email, referral_code)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [email, body.referral_code ?? null]
  );

  res.status(result.rows.length > 0 ? 201 : 200).json({ message: "You're on the list!" });
});

router.get("/position/:email", apiLimiter, async (req, res) => {
  const email = z.string().email().parse(req.params.email);
  const result = await query<{ position: number }>(
    "SELECT position FROM waitlist_signups WHERE email = $1",
    [email.toLowerCase().trim()]
  );

  if (result.rows.length === 0) {
    throw createError("Email not found on waitlist", 404);
  }

  res.json({ position: result.rows[0].position });
});

export default router;
