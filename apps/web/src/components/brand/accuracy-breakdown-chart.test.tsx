import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccuracyBreakdownChart } from "./accuracy-breakdown-chart";

describe("AccuracyBreakdownChart", () => {
  it("exposes each accuracy bar as a named progressbar", () => {
    render(
      <AccuracyBreakdownChart
        data={[
          {
            round: 2,
            questionType: "logo",
            questionText: "Logo",
            totalAttempts: 10,
            correctAttempts: 8,
            accuracy: 80,
          },
        ]}
      />
    );
    expect(screen.getByRole("progressbar", { name: "Round 2 logo accuracy" })).toHaveAttribute(
      "aria-valuenow",
      "80"
    );
  });

  it("renders skeleton placeholders instead of chart bars when loading is true", () => {
    const { container } = render(<AccuracyBreakdownChart data={[]} loading />);

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(4);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("Accuracy by Question")).not.toBeInTheDocument();
    expect(screen.queryByText(/Round \d+/)).not.toBeInTheDocument();
  });

  it("renders nothing when data is empty", () => {
    const { container } = render(<AccuracyBreakdownChart data={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    { accuracy: 100, expectedClass: "bg-green-500" },
    { accuracy: 80, expectedClass: "bg-green-500" },
    { accuracy: 79.99, expectedClass: "bg-yellow-500" },
    { accuracy: 50, expectedClass: "bg-yellow-500" },
    { accuracy: 49.99, expectedClass: "bg-red-500" },
    { accuracy: 0, expectedClass: "bg-red-500" },
    { accuracy: -1, expectedClass: "bg-red-500" },
  ])(
    "maps accuracy $accuracy to bar color class $expectedClass",
    ({ accuracy, expectedClass }) => {
      render(
        <AccuracyBreakdownChart
          data={[
            {
              round: 1,
              questionType: "tagline",
              questionText: "Tagline",
              totalAttempts: 100,
              correctAttempts: Math.max(0, Math.round(accuracy)),
              accuracy,
            },
          ]}
        />
      );

      const bar = screen.getByRole("progressbar", { name: "Round 1 tagline accuracy" });
      expect(bar).toHaveClass(expectedClass);
    }
  );

  it("displays round label, correct/total counts, accuracy percentage, and percentage width style", () => {
    const data = [
      {
        round: 1,
        questionType: "tagline",
        questionText: "Tagline",
        totalAttempts: 40,
        correctAttempts: 35,
        accuracy: 87.5,
      },
      {
        round: 2,
        questionType: "usp",
        questionText: "USP",
        totalAttempts: 20,
        correctAttempts: 11,
        accuracy: 55,
      },
      {
        round: 3,
        questionType: "product",
        questionText: "Product",
        totalAttempts: 10,
        correctAttempts: 3,
        accuracy: 30,
      },
    ];

    render(<AccuracyBreakdownChart data={data} />);

    for (const row of data) {
      expect(screen.getByText(`Round ${row.round}`)).toBeInTheDocument();
      expect(
        screen.getByText(`${row.correctAttempts}/${row.totalAttempts} correct (${row.accuracy}%)`)
      ).toBeInTheDocument();

      const bar = screen.getByRole("progressbar", {
        name: `Round ${row.round} ${row.questionType} accuracy`,
      });
      expect(bar).toHaveStyle({ width: `${row.accuracy}%` });
      expect(bar).toHaveAttribute("aria-valuemin", "0");
      expect(bar).toHaveAttribute("aria-valuemax", "100");
    }
  });

  it("handles zero totalAttempts for all rows without division by zero, NaN, or Infinity", () => {
    const { container } = render(
      <AccuracyBreakdownChart
        data={[
          {
            round: 1,
            questionType: "tagline",
            questionText: "Tagline",
            totalAttempts: 0,
            correctAttempts: 0,
            accuracy: 0,
          },
          {
            round: 2,
            questionType: "usp",
            questionText: "USP",
            totalAttempts: 0,
            correctAttempts: 0,
            accuracy: 0,
          },
        ]}
      />
    );

    expect(screen.getAllByText("0/0 correct (0%)")).toHaveLength(2);
    expect(container.textContent).not.toMatch(/NaN|Infinity/);

    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(bar).toHaveStyle({ width: "0%" });
      expect(bar.getAttribute("style")).not.toMatch(/NaN|Infinity/);
    }
  });
});
