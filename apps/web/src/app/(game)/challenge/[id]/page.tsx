"use client";

import { useState, useEffect, use } from "react";
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
  const { id: challengeId } = use(params);
  const { data: session } = useSession();
  const router = useRouter();

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [questions, setQuestions] = useState<ChallengeQuestion[]>([]);
  const [phase, setPhase] = useState<GamePhase>("loading");
  const [currentRound, setCurrentRound] = useState<1 | 2 | 3>(1);
  const [challengeToken, setChallengeToken] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [scores, setScores] = useState<number[]>([]);

  useEffect(() => {
    if (!challengeId) return;
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
        .then((r) => {
          setSessionId(r.data.sessionId);
          setPhase("warmup");
        });
    });
  }, [challengeId, session, router]);

  const handleWarmupComplete = (token: string) => {
    setChallengeToken(token);
    setPhase("challenge");
    setCurrentRound(1);
  };

  const handleAnswer = async (option: "A" | "B" | "C" | "D", reactionTimeMs: number) => {
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
    return <WarmupPhase challenge={challenge} onComplete={handleWarmupComplete} />;
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
