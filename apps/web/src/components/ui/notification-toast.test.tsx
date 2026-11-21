import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotificationToast, type Notification } from "./notification-toast";

const notification = (type: Notification["type"], payload: Record<string, unknown> = {}): Notification => ({
  id: "notification-1", type, payload, read_at: null, created_at: "2026-01-01T00:00:00Z",
});

describe("NotificationToast", () => {
  it.each([
    ["payout_received", { amount_usdc: "12.50" }, "You received 12.50 USDC!"],
    ["badge_earned", { badge_name: "Early Bird" }, "Badge earned: Early Bird"],
    ["streak_milestone", { milestone: 7 }, "7-day streak milestone reached!"],
  ] as const)("renders %s summary", (type, payload, summary) => {
    render(<NotificationToast notification={notification(type, payload)} onDismiss={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(summary);
  });

  it("auto-dismisses and cancels the timer on manual dismissal", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<NotificationToast notification={notification("badge_earned")} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    vi.advanceTimersByTime(5000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
