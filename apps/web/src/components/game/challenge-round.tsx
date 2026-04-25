"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { CountdownTimer } from "./countdown-timer";
import { cn } from "@/lib/utils";
import { ROUND_SECONDS } from "./constants";
import type { ChallengeQuestion } from "@/lib/api";

interface ChallengeRoundProps {
  question: ChallengeQuestion;
  round: 1 | 2 | 3;
  onAnswer: (option: "A" | "B" | "C" | "D" | null, reactionTimeMs: number) => void;
  brandLogoUrl?: string;
  brandProductImageUrl?: string;
}

const OPTIONS: ("A" | "B" | "C" | "D")[] = ["A", "B", "C", "D"];

export function ChallengeRound({
  question,
  round,
  onAnswer,
  brandLogoUrl,
  brandProductImageUrl,
}: ChallengeRoundProps) {
  const [selected, setSelected] = useState<"A" | "B" | "C" | "D" | null>(null);
  const [answered, setAnswered] = useState(false);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    startTimeRef.current = Date.now();
    setSelected(null);
    setAnswered(false);
  }, [round]);

  const handleSelect = (option: "A" | "B" | "C" | "D") => {
    if (answered) return;
    const reactionTimeMs = Date.now() - startTimeRef.current;
    setSelected(option);
    setAnswered(true);
    onAnswer(option, reactionTimeMs);
  };

  const handleTimeExpire = () => {
    if (!answered) {
      const reactionTimeMs = ROUND_SECONDS * 1000;
      setAnswered(true);
      onAnswer(null, reactionTimeMs);
    }
  };

  const getOptionLabel = (opt: "A" | "B" | "C" | "D") => {
    const map = { A: question.option_a, B: question.option_b, C: question.option_c, D: question.option_d };
    return map[opt];
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Round indicator */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--muted-foreground)]">
          Round {round} of 3
        </span>
        <CountdownTimer
          durationSeconds={ROUND_SECONDS}
          onExpire={handleTimeExpire}
          className="w-32"
        />
      </div>

      {/* Prompt image */}
      {(question.prompt_type === "logo" && brandLogoUrl) && (
        <div className="flex justify-center py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={brandLogoUrl}
            alt="Brand prompt"
            className="h-24 object-contain"
          />
        </div>
      )}
      {(question.prompt_type === "productImage1" && brandProductImageUrl) && (
        <div className="flex justify-center py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={brandProductImageUrl}
            alt="Product prompt"
            className="h-40 object-contain rounded-lg"
          />
        </div>
      )}

      {/* Question text */}
      <p className="text-xl font-semibold text-center">{question.question_text}</p>

      {/* Answer options */}
      <div className="grid grid-cols-1 gap-3">
        {OPTIONS.map((opt) => (
          <Button
            key={opt}
            variant="outline"
            size="lg"
            className={cn(
              "w-full text-left justify-start h-auto py-3 px-4 transition-all",
              selected === opt && "ring-2 ring-[var(--primary)] bg-[var(--accent)]",
              answered && "pointer-events-none"
            )}
            onClick={() => handleSelect(opt)}
          >
            <span className="font-bold mr-3 text-[var(--muted-foreground)]">{opt}</span>
            <span>{getOptionLabel(opt)}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
