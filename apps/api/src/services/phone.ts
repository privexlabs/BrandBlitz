import { createHmac } from "crypto";
import twilio from "twilio";
import { createError } from "../middleware/error";

export const PHONE_HASH_ALGORITHM = "sha256";

function getTwilioClient() {
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

function getVerifyServiceSid(): string {
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID ?? process.env.TWILIO_SERVICE_SID;
  if (!serviceSid) {
    throw new Error("TWILIO_VERIFY_SERVICE_SID is required");
  }
  return serviceSid;
}

function getPhoneHashSalt(): string {
  const salt = process.env.PHONE_HASH_SALT;
  if (!salt) {
    throw new Error("PHONE_HASH_SALT is required");
  }
  return salt;
}

export function normalizePhoneNumber(phoneNumber: string): string {
  const trimmed = phoneNumber.trim();
  const normalized = trimmed.startsWith("+")
    ? `+${trimmed.slice(1).replace(/\D/g, "")}`
    : `+${trimmed.replace(/\D/g, "")}`;

  if (!/^\+\d{10,15}$/.test(normalized)) {
    throw createError("Phone number must be a valid E.164 number", 400, "INVALID_PHONE");
  }

  return normalized;
}

export function hashPhoneNumber(phoneNumber: string): string {
  const normalized = normalizePhoneNumber(phoneNumber);
  return createHmac(PHONE_HASH_ALGORITHM, getPhoneHashSalt()).update(normalized).digest("hex");
}

export async function sendVerificationCode(phoneNumber: string): Promise<void> {
  await getTwilioClient().verify.v2.services(getVerifyServiceSid()).verifications.create({
    to: normalizePhoneNumber(phoneNumber),
    channel: "sms",
  });
}

export async function checkVerificationCode(
  phoneNumber: string,
  code: string
): Promise<boolean> {
  const result = await getTwilioClient().verify.v2
    .services(getVerifyServiceSid())
    .verificationChecks.create({ to: normalizePhoneNumber(phoneNumber), code });

  return result.status === "approved";
}

export async function requirePhoneVerified(
  userId: string,
  phoneVerified: boolean
): Promise<void> {
  if (!phoneVerified) {
    throw createError(
      "Phone verification required before claiming rewards",
      403,
      "PHONE_VERIFICATION_REQUIRED"
    );
  }
}
