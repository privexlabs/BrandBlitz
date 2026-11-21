import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Label } from "./label";

describe("Label", () => {
  it("forwards props, ref, and peer-disabled styling to the label element", () => {
    const ref = React.createRef<HTMLLabelElement>();
    render(<Label ref={ref} htmlFor="email" className="text-blue-500">Email</Label>);
    const label = screen.getByText("Email");
    expect(ref.current).toBe(label);
    expect(label).toHaveAttribute("for", "email");
    expect(label).toHaveClass("peer-disabled:cursor-not-allowed", "peer-disabled:opacity-70", "text-blue-500");
  });
});
