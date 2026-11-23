import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CostPerSessionChart } from "./cost-per-session-chart";

const DRAWABLE_HEIGHT = 80;
const VIEWBOX_HEIGHT = 100;
const SLOT_WIDTH = 40;
const BAR_WIDTH = 24;

describe("CostPerSessionChart", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("provides an image label and accessible daily data table", () => {
    render(
      <CostPerSessionChart
        data={[{ date: "2026-01-01T12:00:00Z", totalCost: 10, sessionCount: 2, costPerSession: 5 }]}
      />
    );
    expect(screen.getByRole("img")).toHaveAccessibleName(/cost per session for 1 days/i);
    expect(screen.getByRole("table")).toHaveTextContent("$5.00");
    expect(screen.getByRole("columnheader", { name: "Cost per session" })).toBeInTheDocument();
  });

  it("renders skeleton placeholders and no chart or table when loading is true", () => {
    const { container } = render(<CostPerSessionChart data={[]} loading />);

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(2);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("Cost per Session (30 Days)")).not.toBeInTheDocument();
  });

  it("renders nothing when data is empty", () => {
    const { container } = render(<CostPerSessionChart data={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("scales SVG bar heights relative to maxCost using the 80-unit drawable height", () => {
    const data = [
      { date: "2026-03-01T12:00:00Z", totalCost: 40, sessionCount: 10, costPerSession: 4 },
      { date: "2026-03-02T12:00:00Z", totalCost: 20, sessionCount: 10, costPerSession: 2 },
      { date: "2026-03-03T12:00:00Z", totalCost: 0, sessionCount: 5, costPerSession: 0 },
    ];
    const maxCost = Math.max(...data.map((d) => d.costPerSession), 0.01);

    render(<CostPerSessionChart data={data} />);

    const svg = screen.getByRole("img");
    const rects = svg.querySelectorAll("rect");
    expect(rects).toHaveLength(3);

    data.forEach((point, index) => {
      const expectedHeight = (point.costPerSession / maxCost) * DRAWABLE_HEIGHT;
      const expectedY = VIEWBOX_HEIGHT - expectedHeight;
      expect(Number(rects[index].getAttribute("height"))).toBeCloseTo(expectedHeight, 5);
      expect(Number(rects[index].getAttribute("y"))).toBeCloseTo(expectedY, 5);
    });

    expect(Number(rects[0].getAttribute("height"))).toBe(DRAWABLE_HEIGHT);
    expect(Number(rects[1].getAttribute("height"))).toBe(DRAWABLE_HEIGHT / 2);
    expect(Number(rects[2].getAttribute("height"))).toBe(0);
  });

  it("renders Total spent and session count in the footer matching input sums", () => {
    const data = [
      { date: "2026-03-01T12:00:00Z", totalCost: 12.34, sessionCount: 13, costPerSession: 0.95 },
      { date: "2026-03-02T12:00:00Z", totalCost: 56.78, sessionCount: 27, costPerSession: 2.1 },
      { date: "2026-03-03T12:00:00Z", totalCost: 9.1, sessionCount: 41, costPerSession: 0.22 },
    ];
    const expectedTotalCost = data.reduce((sum, d) => sum + d.totalCost, 0);
    const expectedTotalSessions = data.reduce((sum, d) => sum + d.sessionCount, 0);

    render(<CostPerSessionChart data={data} />);

    expect(screen.getByText(`Total spent: $${expectedTotalCost.toFixed(2)}`)).toBeInTheDocument();
    expect(
      screen.getByText(`${expectedTotalSessions.toLocaleString()} sessions`)
    ).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName(
      `Cost per session for ${data.length} days; total spent $${expectedTotalCost.toFixed(2)} across ${expectedTotalSessions.toLocaleString()} sessions`
    );
  });

  it("renders a single-point data array with finite geometry inside the viewBox", () => {
    render(
      <CostPerSessionChart
        data={[{ date: "2026-03-10T12:00:00Z", totalCost: 15, sessionCount: 3, costPerSession: 5 }]}
      />
    );

    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute("viewBox", `0 0 ${SLOT_WIDTH} ${VIEWBOX_HEIGHT}`);

    const rect = svg.querySelector("rect");
    expect(rect).not.toBeNull();

    for (const attr of ["x", "y", "width", "height"] as const) {
      const raw = rect!.getAttribute(attr);
      expect(raw).not.toBeNull();
      expect(raw).not.toMatch(/NaN|Infinity/);
      expect(Number.isFinite(Number(raw))).toBe(true);
    }

    const x = Number(rect!.getAttribute("x"));
    const y = Number(rect!.getAttribute("y"));
    const width = Number(rect!.getAttribute("width"));
    const height = Number(rect!.getAttribute("height"));

    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(SLOT_WIDTH);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y + height).toBeLessThanOrEqual(VIEWBOX_HEIGHT);
  });

  it("keeps all bars inside the viewBox with positive widths for 30 data points", () => {
    const data = Array.from({ length: 30 }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      return {
        date: `2026-03-${day}T12:00:00Z`,
        totalCost: (i + 1) * 2,
        sessionCount: i + 1,
        costPerSession: (i + 1) * 0.5,
      };
    });

    render(<CostPerSessionChart data={data} />);

    const svg = screen.getByRole("img");
    const totalWidth = data.length * SLOT_WIDTH;
    expect(svg).toHaveAttribute("viewBox", `0 0 ${totalWidth} ${VIEWBOX_HEIGHT}`);

    const rects = svg.querySelectorAll("rect");
    expect(rects).toHaveLength(30);

    rects.forEach((rect) => {
      const x = Number(rect.getAttribute("x"));
      const y = Number(rect.getAttribute("y"));
      const width = Number(rect.getAttribute("width"));
      const height = Number(rect.getAttribute("height"));

      expect(width).toBe(BAR_WIDTH);
      expect(width).toBeGreaterThan(0);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(totalWidth);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y + height).toBeLessThanOrEqual(VIEWBOX_HEIGHT);
    });
  });

  it("formats date labels via toLocaleDateString deterministically across locales and time zones", () => {
    const spy = vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (
      this: Date
    ) {
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(this);
    });

    render(
      <CostPerSessionChart
        data={[
          { date: "2026-03-15T12:00:00Z", totalCost: 12, sessionCount: 4, costPerSession: 3 },
        ]}
      />
    );

    expect(spy).toHaveBeenCalledWith(expect.anything(), { month: "short", day: "numeric" });
    expect(screen.getByText("Mar 15")).toBeInTheDocument();
  });
});
