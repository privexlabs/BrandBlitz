import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SessionRecoveryModal } from "./session-recovery-modal";

describe("SessionRecoveryModal", () => {
  it("calls resume and forfeit actions for interrupted sessions", () => {
    const onResume = vi.fn();
    const onForfeit = vi.fn();

    render(
      <SessionRecoveryModal
        session={{
          status: "in_progress",
          currentRound: 2,
          remainingTimeMs: 17000,
          totalScore: 120,
        }}
        onResume={onResume}
        onForfeit={onForfeit}
        onStartNew={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: /resume challenge/i })).toBeInTheDocument();
    expect(screen.getByText("17s")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /resume/i }));
    expect(onResume).toHaveBeenCalledTimes(1);

    // Forfeit is gated behind a confirmation step (#1056).
    fireEvent.click(screen.getByRole("button", { name: /^forfeit$/i }));
    expect(onForfeit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /yes, forfeit/i }));
    expect(onForfeit).toHaveBeenCalledTimes(1);
  });

  describe("forfeit confirmation (#1056)", () => {
    function renderInProgress(onForfeit = vi.fn()) {
      render(
        <SessionRecoveryModal
          session={{
            status: "in_progress",
            currentRound: 2,
            remainingTimeMs: 17000,
            totalScore: 120,
          }}
          onResume={vi.fn()}
          onForfeit={onForfeit}
          onStartNew={vi.fn()}
        />
      );
      return onForfeit;
    }

    it("does not forfeit on the first click", () => {
      const onForfeit = renderInProgress();

      fireEvent.click(screen.getByRole("button", { name: /^forfeit$/i }));

      expect(onForfeit).not.toHaveBeenCalled();
    });

    it("warns that the current score will be lost", () => {
      renderInProgress();

      fireEvent.click(screen.getByRole("button", { name: /^forfeit$/i }));

      const warning = screen.getByRole("alert");
      expect(warning).toHaveTextContent(/score of 120 will be\s+lost/i);
    });

    it("can be backed out of, leaving the original actions intact", () => {
      const onForfeit = renderInProgress();

      fireEvent.click(screen.getByRole("button", { name: /^forfeit$/i }));
      fireEvent.click(screen.getByRole("button", { name: /keep playing/i }));

      expect(onForfeit).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /^forfeit$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("moves focus to the non-destructive option when confirming", () => {
      renderInProgress();

      fireEvent.click(screen.getByRole("button", { name: /^forfeit$/i }));

      expect(screen.getByRole("button", { name: /keep playing/i })).toHaveFocus();
    });
  });

  it("only offers start new for expired sessions", () => {
    const onStartNew = vi.fn();

    render(
      <SessionRecoveryModal
        session={{ status: "expired", currentRound: 3, remainingTimeMs: 0, totalScore: 210 }}
        onResume={vi.fn()}
        onForfeit={vi.fn()}
        onStartNew={onStartNew}
      />
    );

    expect(screen.getByRole("dialog", { name: /session expired/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /resume/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /forfeit/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /start new/i }));
    expect(onStartNew).toHaveBeenCalledTimes(1);
  });
});
