import twilio from "twilio";
import { createError } from "../middleware/error";
import { config } from "../lib/config";

const client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
const SERVICE_SID = config.TWILIO_SERVICE_SID;

export async function sendVerificationCode(phoneNumber: string): Promise<void> {
  if (!SERVICE_SID) throw new Error("TWILIO_SERVICE_SID is not configured");
  await client.verify.v2.services(SERVICE_SID).verifications.create({
    to: phoneNumber,
    channel: "sms",
  });
}

export async function checkVerificationCode(
  phoneNumber: string,
  code: string
): Promise<boolean> {
  if (!SERVICE_SID) throw new Error("TWILIO_SERVICE_SID is not configured");
  const result = await client.verify.v2
    .services(SERVICE_SID)
    .verificationChecks.create({ to: phoneNumber, code });

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
