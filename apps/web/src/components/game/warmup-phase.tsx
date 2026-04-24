"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { CountdownTimer } from "./countdown-timer";
import { WARMUP_MIN_SECONDS } from "./constants";
import type { Challenge } from "@/lib/api";

interface WarmupPhaseProps {
  challenge: Challenge;
  onComplete: (challengeToken: string) => void;
}

export function WarmupPhase({ challenge, onComplete }: WarmupPhaseProps) {
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showRetry, setShowRetry] = useState(false);

  // Server enforces WARMUP_MIN_SECONDS; client enables button after same duration
  useEffect(() => {
    const timer = setTimeout(() => setUnlocked(true), WARMUP_MIN_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, []);

  const handleStartChallenge = async () => {
    setLoading(true);
    setStatusMessage(null);
    setShowRetry(false);

    try {
      // Notify API that warmup completed — receive challenge token
      const res = await fetch(`/api/proxy/sessions/${challenge.id}/warmup-complete`, {
        method: "POST",
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 400 && typeof data?.remainingMs === "number") {
          setStatusMessage(
            `Not yet ready. Please wait ${Math.ceil(data.remainingMs / 1000)} more seconds and try again.`
          );
          setLoading(false);
          return;
        }

        throw new Error("Request failed");
      }

      onComplete(data.challengeToken);
    } catch {
      setStatusMessage("Couldn't start the challenge. Check your connection and try again.");
      setShowRetry(true);
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{
        background: `linear-gradient(135deg, ${challenge.primary_color ?? "var(--primary)"} 0%, ${challenge.secondary_color ?? "var(--background)"} 100%)`,
      }}
    >
      <div className="max-w-lg w-full bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl p-8 space-y-6">
        {/* Brand logo */}
        {challenge.logo_url && (
          <div className="flex justify-center">
            <Image
              src={challenge.logo_url}
              alt={challenge.brand_name ?? "Brand logo"}
              width={120}
              height={120}
              className="object-contain rounded-xl"
            />
          </div>
        )}

        {/* Brand name */}
        <h1 className="text-3xl font-bold text-center text-slate-900">
          {challenge.brand_name}
        </h1>

        {challenge.tagline ? (
          <p className="text-center text-base font-medium text-slate-700">{challenge.tagline}</p>
        ) : null}

        {/* Warmup instructions */}
        <p className="text-center text-slate-600 text-sm">
          Study this brand carefully — you&#39;ll be tested on it in a moment.
          Top scorers win USDC instantly.
        </p>

        {/* Countdown */}
        <div className="py-4">
          <CountdownTimer
            durationSeconds={WARMUP_MIN_SECONDS}
            onExpire={() => setUnlocked(true)}
          />
          {!unlocked && (
            <p className="text-center text-xs text-slate-500 mt-2">
              Study time remaining
            </p>
          )}
        </div>

        {/* Start button — unlocked after minimum warmup */}
        <Button
          onClick={handleStartChallenge}
          disabled={!unlocked || loading}
          size="lg"
          className="w-full text-lg"
          style={{ backgroundColor: challenge.primary_color ?? undefined }}
        >
          {loading ? "Starting..." : unlocked ? "Start Challenge →" : "Preparing..."}
        </Button>

        {statusMessage ? (
          <p role="alert" className="text-center text-sm text-slate-700">
            {statusMessage}
          </p>
        ) : null}

        {showRetry ? (
          <Button
            onClick={handleStartChallenge}
            disabled={loading}
            variant="outline"
            className="w-full"
          >
            Retry
          </Button>
        ) : null}

        <p className="text-center text-xs text-slate-400">
          Prize pool: <strong>{challenge.pool_amount_usdc} USDC</strong>
        </p>
      </div>
    </div>
  );
}
