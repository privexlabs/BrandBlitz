import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AnswerOption, type AnswerOptionKey } from "./answer-option";

describe("AnswerOption", () => {
  it.each<AnswerOptionKey>(["A", "B", "C", "D"])(
    "calls onSelect once with key %s when clicked",
    async (option) => {
      const user = userEvent.setup();
      const onSelect = vi.fn();

      render(<AnswerOption option={option} label={`Choice ${option}`} onSelect={onSelect} />);

      const button = screen.getByRole("button", { name: `${option}: Choice ${option}` });
      await user.click(button);

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(option);
    }
  );

  it("renders aria-label '{option}: {label}' including special characters and reflects aria-pressed", () => {
    const label = "Stellar & USDC (100% / <fast>)";
    const { rerender } = render(
      <AnswerOption option="B" label={label} selected={false} onSelect={vi.fn()} />
    );

    const button = screen.getByRole("button", { name: `B: ${label}` });
    expect(button).toHaveAttribute("aria-label", `B: ${label}`);
    expect(button).toHaveAttribute("aria-pressed", "false");

    rerender(<AnswerOption option="B" label={label} selected onSelect={vi.fn()} />);
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("renders pending ring/accent classes and Submitting answer spinner when selected and pending", () => {
    const { rerender } = render(
      <AnswerOption option="A" label="Fast finality" selected pending onSelect={vi.fn()} />
    );

    const button = screen.getByRole("button", { name: "A: Fast finality" });
    expect(button).toHaveClass("bg-[var(--accent)]", "ring-2", "ring-[var(--primary)]");

    const spinner = screen.getByLabelText("Submitting answer");
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveClass("animate-spin");

    rerender(
      <AnswerOption option="A" label="Fast finality" selected pending={false} onSelect={vi.fn()} />
    );
    expect(screen.queryByLabelText("Submitting answer")).not.toBeInTheDocument();
    expect(button).not.toHaveClass("bg-[var(--accent)]", "ring-[var(--primary)]");

    rerender(
      <AnswerOption option="A" label="Fast finality" selected={false} pending={false} onSelect={vi.fn()} />
    );
    expect(screen.queryByLabelText("Submitting answer")).not.toBeInTheDocument();
  });

  it("does not apply pending ring/accent classes when pending is true but selected is false", () => {
    render(
      <AnswerOption option="C" label="Unselected pending" selected={false} pending onSelect={vi.fn()} />
    );

    const button = screen.getByRole("button", { name: "C: Unselected pending" });
    expect(button).not.toHaveClass("bg-[var(--accent)]", "ring-[var(--primary)]");
  });

  it("renders green success classes when selected and correct is true", () => {
    render(
      <AnswerOption option="A" label="Correct choice" selected correct={true} onSelect={vi.fn()} />
    );

    const button = screen.getByRole("button", { name: "A: Correct choice" });
    expect(button).toHaveClass(
      "border-green-600",
      "bg-green-50",
      "text-green-900",
      "ring-2",
      "ring-green-600"
    );
    expect(button).not.toHaveClass("border-red-600", "bg-red-50");
  });

  it("renders red failure classes when selected and correct is false", () => {
    render(
      <AnswerOption option="D" label="Wrong choice" selected correct={false} onSelect={vi.fn()} />
    );

    const button = screen.getByRole("button", { name: "D: Wrong choice" });
    expect(button).toHaveClass(
      "border-red-600",
      "bg-red-50",
      "text-red-900",
      "ring-2",
      "ring-red-600"
    );
    expect(button).not.toHaveClass("border-green-600", "bg-green-50");
  });

  it("renders neither correct nor incorrect classes when correct is null or undefined", () => {
    const { rerender } = render(
      <AnswerOption option="A" label="Neutral" selected correct={null} onSelect={vi.fn()} />
    );

    const button = screen.getByRole("button", { name: "A: Neutral" });
    expect(button).not.toHaveClass("border-green-600", "bg-green-50", "border-red-600", "bg-red-50");

    rerender(
      <AnswerOption option="A" label="Neutral" selected correct={undefined} onSelect={vi.fn()} />
    );
    expect(button).not.toHaveClass("border-green-600", "bg-green-50", "border-red-600", "bg-red-50");
  });

  it("never shows correct or incorrect styling when unselected", () => {
    const { rerender } = render(
      <AnswerOption option="B" label="Option B" selected={false} correct={true} onSelect={vi.fn()} />
    );

    const button = screen.getByRole("button", { name: "B: Option B" });
    expect(button).not.toHaveClass("border-green-600", "bg-green-50", "border-red-600", "bg-red-50");

    rerender(
      <AnswerOption option="B" label="Option B" selected={false} correct={false} onSelect={vi.fn()} />
    );
    expect(button).not.toHaveClass("border-green-600", "bg-green-50", "border-red-600", "bg-red-50");
  });

  it("activates via Enter and Space when enabled", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<AnswerOption option="C" label="Keyboard option" onSelect={onSelect} />);

    const button = screen.getByRole("button", { name: "C: Keyboard option" });
    button.focus();

    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenNthCalledWith(1, "C");
    expect(onSelect).toHaveBeenNthCalledWith(2, "C");
  });

  it("disables the button and blocks click and keyboard activation when disabled is true", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<AnswerOption option="A" label="Locked" disabled onSelect={onSelect} />);

    const button = screen.getByRole("button", { name: "A: Locked" });
    expect(button).toBeDisabled();

    await user.click(button);
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not block clicks when pending is true and disabled is false", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<AnswerOption option="D" label="Still clickable" selected pending onSelect={onSelect} />);

    const button = screen.getByRole("button", { name: "D: Still clickable" });
    expect(button).toBeEnabled();

    await user.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("D");
  });
});
