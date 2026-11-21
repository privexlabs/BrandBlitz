import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationToast, type Notification } from "./notification-toast";

const notification = (type: Notification["type"], payload: Record<string, unknown> = {}): Notification => ({
  id: "notification-1",
  type,
  payload,
  read_at: null,
  created_at: "2026-01-01T00:00:00Z",
});

describe("NotificationToast", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ["payout_received", { amount_usdc: "12.50" }, "💸", "You received 12.50 USDC!"],
    ["badge_earned", { badge_name: "Early Bird" }, "🏅", "Badge earned: Early Bird"],
    ["streak_milestone", { milestone: 7 }, "🔥", "7-day streak milestone reached!"],
  ] as const)("renders %s summary and icon", (type, payload, icon, summary) => {
    render(<NotificationToast notification={notification(type, payload)} onDismiss={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText(icon)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(summary);
  });

  it.each([
    ["payout_received", {}, "USDC payout received!"],
    ["badge_earned", {}, "New badge earned!"],
    ["streak_milestone", {}, "Streak milestone reached!"],
  ] as const)("uses fallback summary for %s", (type, payload, summary) => {
    render(<NotificationToast notification={notification(type, payload)} onDismiss={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(summary);
  });

  it("auto-dismisses after five seconds", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<NotificationToast notification={notification("badge_earned")} onDismiss={onDismiss} />);
    vi.advanceTimersByTime(4999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith("notification-1");
  });

  it("dismisses immediately and clears the pending timer", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<NotificationToast notification={notification("badge_earned")} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    vi.advanceTimersByTime(5000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
