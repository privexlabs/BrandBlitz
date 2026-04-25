import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { ChallengeRound } from "./challenge-round";

describe("ChallengeRound", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("submits null on timer expiry", () => {
    const onAnswer = vi.fn();

    render(
      <ChallengeRound
        question={{
          id: "q1",
          challenge_id: "c1",
          round: 1,
          question_type: "mcq",
          prompt_type: "logo",
          question_text: "Pick the correct brand",
          option_a: "A option",
          option_b: "B option",
          option_c: "C option",
          option_d: "D option",
        }}
        round={1}
        onAnswer={onAnswer}
      />
    );

    act(() => {
      vi.advanceTimersByTime(15_100);
    });

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith(null, 15_000);
    expect(onAnswer).not.toHaveBeenCalledWith("A", expect.any(Number));
  });
});
