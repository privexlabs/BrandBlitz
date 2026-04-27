"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { WarmupPhase } from "@/components/game/warmup-phase";
import { ChallengeRound } from "@/components/game/challenge-round";
import { ResultScreen } from "@/components/game/result-screen";
import { createApiClient, type Challenge, type ChallengeQuestion } from "@/lib/api";
import { TOTAL_ROUNDS } from "@/components/game/constants";

type GamePhase = "loading" | "warmup" | "challenge" | "result";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ChallengePage({ params }: PageProps) {
  const { id: challengeId } = React.use(params);
  const { data: session, status } = useSession();
  const router = useRouter();

  const [challenge, setChallenge] = React.useState<Challenge | null>(null);
  const [questions, setQuestions] = React.useState<ChallengeQuestion[]>([]);
  const [phase, setPhase] = React.useState<GamePhase>("loading");
  const [currentRound, setCurrentRound] = React.useState<1 | 2 | 3>(1);
  const [scores, setScores] = React.useState<number[]>([]);

  React.useEffect(() => {
    if (!challengeId) return;
    if (status === "loading") return;
    if (!session) {
      router.push(`/login?callbackUrl=/challenge/${challengeId}`);
      return;
    }

    const apiToken = (session as any).apiToken as string;
    const api = createApiClient(apiToken);

    api.get(`/challenges/${challengeId}`).then((res) => {
      setChallenge(res.data.challenge);
      setQuestions(res.data.questions);

      // Start warmup session on server
      api
        .post(`/sessions/${challengeId}/warmup-start`, {
          deviceId: undefined, // FingerprintJS visitorId added via middleware
        })
        .then(() => {
          setPhase("warmup");
        });
    });
  }, [challengeId, session, status, router]);

  const handleWarmupComplete = async (token: string) => {
    const apiToken = (session as any)?.apiToken as string;
    const api = createApiClient(apiToken);

    await api.post(`/sessions/${challengeId}/start`, { challengeToken: token });

    setPhase("challenge");
    setCurrentRound(1);
  };

  const handleAnswer = async (option: "A" | "B" | "C" | "D" | null, reactionTimeMs: number) => {
    const apiToken = (session as any)?.apiToken as string;
    const api = createApiClient(apiToken);

    const res = await api.post(`/sessions/${challengeId}/answer/${currentRound}`, {
      selectedOption: option,
      reactionTimeMs,
    });

    setScores((prev) => [...prev, res.data.score]);

    if (currentRound < TOTAL_ROUNDS) {
      setCurrentRound((r) => (r + 1) as 1 | 2 | 3);
    } else {
      setPhase("result");
    }
  };

  if (phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-[var(--muted-foreground)]">Loading challenge...</div>
      </div>
    );
  }

  if (phase === "warmup" && challenge) {
    return (
      <WarmupPhase
        challenge={challenge}
        apiToken={(session as any).apiToken}
        onComplete={(token) => {
          void handleWarmupComplete(token);
        }}
      />
    );
  }

  if (phase === "challenge" && challenge) {
    const question = questions[currentRound - 1];
    if (!question) return null;

    return (
      <div className="min-h-screen p-6">
        <ChallengeRound
          question={question}
          round={currentRound}
          onAnswer={handleAnswer}
          brandLogoUrl={challenge.logo_url ?? undefined}
        />
      </div>
    );
  }

  if (phase === "result") {
    const totalScore = scores.reduce((a, b) => a + b, 0);
    return (
      <ResultScreen
        totalScore={totalScore}
        challengeId={challengeId}
      />
    );
  }

  return null;
}
