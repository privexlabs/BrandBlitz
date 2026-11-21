import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Label } from "./label";

describe("Label", () => {
  it("forwards its ref to the underlying label element", () => {
    const ref = React.createRef<HTMLLabelElement>();
    render(<Label ref={ref}>Email</Label>);
    expect(ref.current).toBe(screen.getByText("Email"));
  });

  it("renders htmlFor and children", () => {
    render(<Label htmlFor="email">Email address</Label>);
    expect(screen.getByText("Email address")).toHaveAttribute("for", "email");
  });

  it("keeps peer-disabled styles and merges custom classes", () => {
    render(<Label className="text-blue-500">Email</Label>);
    expect(screen.getByText("Email")).toHaveClass(
      "peer-disabled:cursor-not-allowed",
      "peer-disabled:opacity-70",
      "text-blue-500",
    );
  });
});
