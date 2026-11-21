import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CostPerSessionChart } from "./cost-per-session-chart";

describe("CostPerSessionChart", () => {
  it("provides an image label and accessible daily data table", () => {
    render(<CostPerSessionChart data={[{ date: "2026-01-01", totalCost: 10, sessionCount: 2, costPerSession: 5 }]} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(/cost per session for 1 days/i);
    expect(screen.getByRole("table")).toHaveTextContent("$5.00");
    expect(screen.getByRole("columnheader", { name: "Cost per session" })).toBeInTheDocument();
  });
});
