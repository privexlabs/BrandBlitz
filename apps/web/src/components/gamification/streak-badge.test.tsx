import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StreakBadge } from "./streak-badge";

describe("StreakBadge", () => {
  it("normalizes null streak to 0-day streak", () => {
    render(<StreakBadge streak={null} />);

    expect(screen.getByText("0-day streak")).toBeInTheDocument();
    expect(screen.queryByText(/null-day streak/i)).not.toBeInTheDocument();
  });

  it("normalizes NaN streak to 0-day streak", () => {
    render(<StreakBadge streak={Number.NaN} />);

    expect(screen.getByText("0-day streak")).toBeInTheDocument();
    expect(screen.queryByText(/NaN-day streak/i)).not.toBeInTheDocument();
  });

  it("normalizes undefined (omitted) streak to 0-day streak", () => {
    render(<StreakBadge />);

    expect(screen.getByText("0-day streak")).toBeInTheDocument();
  });

  it("normalizes non-number runtime inputs such as numeric strings to 0-day streak", () => {
    render(<StreakBadge streak={"5" as unknown as number} />);

    expect(screen.getByText("0-day streak")).toBeInTheDocument();
    expect(screen.queryByText("5-day streak")).not.toBeInTheDocument();
  });

  it("renders 0-day streak when streak is 0", () => {
    render(<StreakBadge streak={0} />);

    expect(screen.getByText("0-day streak")).toBeInTheDocument();
  });

  it.each([1, 7, 365])("renders exact '{n}-day streak' text for positive integer %i", (days) => {
    render(<StreakBadge streak={days} />);

    expect(screen.getByText(`${days}-day streak`)).toBeInTheDocument();
  });

  it("renders the fire icon by default and when showIcon is true, regardless of streak value", () => {
    const { rerender } = render(<StreakBadge streak={0} />);
    expect(screen.getByText("🔥")).toBeInTheDocument();

    rerender(<StreakBadge streak={5} showIcon />);
    expect(screen.getByText("🔥")).toBeInTheDocument();
  });

  it("omits the fire icon span from the document when showIcon is false", () => {
    render(<StreakBadge streak={5} showIcon={false} />);

    expect(screen.queryByText("🔥")).not.toBeInTheDocument();
    expect(screen.getByText("5-day streak")).toBeInTheDocument();
  });

  it("renders the default label and supports a custom label", () => {
    const { rerender } = render(<StreakBadge streak={3} />);
    expect(screen.getByText("Streak")).toBeInTheDocument();

    rerender(<StreakBadge streak={3} label="Current" />);
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.queryByText("Streak")).not.toBeInTheDocument();
  });
});
