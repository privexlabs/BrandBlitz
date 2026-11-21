import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccuracyBreakdownChart } from "./accuracy-breakdown-chart";

describe("AccuracyBreakdownChart", () => {
  it("exposes each accuracy bar as a named progressbar", () => {
    render(<AccuracyBreakdownChart data={[{ round: 2, questionType: "logo", questionText: "Logo", totalAttempts: 10, correctAttempts: 8, accuracy: 80 }]} />);
    expect(screen.getByRole("progressbar", { name: "Round 2 logo accuracy" })).toHaveAttribute("aria-valuenow", "80");
  });
});
