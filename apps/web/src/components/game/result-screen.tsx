"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatScore, formatUsdc } from "@/lib/utils";

interface ResultScreenProps {
  totalScore: number;
  rank?: number;
  estimatedUsdc?: string;
  challengeId: string;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}

function useCountUp(target: number, duration: number, disabled: boolean): number {
  const [current, setCurrent] = useState(() => (disabled ? target : 0));
  const frameRef = useRef(0);

  useEffect(() => {
    if (disabled) {
      setCurrent(target);
      return;
    }

    const startTime = performance.now();

    function easeOutCubic(t: number): number {
      return 1 - Math.pow(1 - t, 3);
    }

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      setCurrent(Math.round(easeOutCubic(progress) * target));

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      }
    }

    frameRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration, disabled]);

  return current;
}

export function ResultScreen({ totalScore, rank, estimatedUsdc, challengeId }: ResultScreenProps) {
  const [shareToast, setShareToast] = useState<string | null>(null);
  const prefersReduced = useReducedMotion();
  const animatedScore = useCountUp(totalScore, 1200, prefersReduced);
  const confettiFired = useRef(false);

  useEffect(() => {
    if (rank != null && rank <= 10 && !confettiFired.current && !prefersReduced) {
      confettiFired.current = true;
      import("canvas-confetti").then((mod) => {
        mod.default({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.6 },
        });
      });
    }
  }, [rank, prefersReduced]);

  const shareText = `I just scored ${formatScore(totalScore)} in a BrandBlitz challenge${estimatedUsdc ? ` and earned ~${formatUsdc(estimatedUsdc)} USDC` : ""}! 🏆`;
  const leaderboardHref = `/challenge/${challengeId}`;

  const handleShare = useCallback(async () => {
    if (navigator.share) {
      await navigator.share({ text: shareText, url: window.location.href });
      return;
    }

    await navigator.clipboard.writeText(shareText);
    setShareToast("Result copied to clipboard.");
  }, [shareText]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="max-w-sm w-full text-center">
        <CardHeader>
          <CardTitle className="text-2xl">Challenge Complete!</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p
              className="text-6xl font-bold text-[var(--primary)] tabular-nums"
              aria-live="polite"
            >
              {formatScore(animatedScore)}
            </p>
            <p className="text-[var(--muted-foreground)] mt-1">points</p>
          </div>

          {rank && (
            <p className="text-lg font-medium">
              Rank #{rank}
            </p>
          )}

          {estimatedUsdc && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 motion-safe:animate-pulse">
              <p className="text-sm text-green-700">Estimated earnings</p>
              <p className="text-2xl font-bold text-green-800">{formatUsdc(estimatedUsdc)} USDC</p>
              <p className="text-xs text-green-600 mt-1">Paid out when challenge ends</p>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <Button
              onClick={() => {
                void handleShare();
              }}
              variant="outline"
              className="w-full"
            >
              Share Result
            </Button>

            <Button asChild variant="secondary" className="w-full">
              <Link href={leaderboardHref}>
                View Leaderboard
              </Link>
            </Button>

            <Button asChild className="w-full">
              <Link href="/">Play Another Challenge</Link>
            </Button>
          </div>

          {shareToast ? (
            <p role="status" aria-live="polite" className="text-sm font-medium text-green-700">
              {shareToast}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
