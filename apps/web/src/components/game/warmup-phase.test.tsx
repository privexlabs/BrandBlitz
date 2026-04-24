import type { ImgHTMLAttributes } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WARMUP_MIN_SECONDS } from "./constants";
import { WarmupPhase } from "./warmup-phase";
import type { Challenge } from "@/lib/api";

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
    ...props
  }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) => (
    <img alt={alt} src={src} {...props} />
  ),
}));

const challenge: Challenge = {
  id: "session-123",
  brand_id: "brand-123",
  challenge_id: "challenge-123",
  pool_amount_usdc: "250",
  status: "active",
  starts_at: "2026-04-24T00:00:00.000Z",
  ends_at: "2026-04-25T00:00:00.000Z",
  brand_name: "Acme",
  tagline: "Launch faster.",
  logo_url: "https://example.com/logo.png",
  primary_color: "#112233",
  secondary_color: "#ddeeff",
};

describe("WarmupPhase", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the brand logo, name, tagline, and warmup copy", () => {
    render(<WarmupPhase challenge={challenge} onComplete={vi.fn()} />);

    expect(screen.getByRole("img", { name: "Acme" })).toHaveAttribute(
      "src",
      "https://example.com/logo.png"
    );
    expect(screen.getByRole("heading", { name: "Acme" })).toBeInTheDocument();
    expect(screen.getByText("Launch faster.")).toBeInTheDocument();
    expect(
      screen.getByText(/Study this brand carefully/i)
    ).toBeInTheDocument();
  });

  it("omits optional brand assets when absent", () => {
    render(
      <WarmupPhase
        challenge={{
          ...challenge,
          logo_url: undefined,
          tagline: undefined,
        }}
        onComplete={vi.fn()}
      />
    );

    expect(screen.queryByRole("img", { name: "Acme" })).not.toBeInTheDocument();
    expect(screen.queryByText("Launch faster.")).not.toBeInTheDocument();
  });

  it("counts down from WARMUP_MIN_SECONDS and keeps the start button disabled until zero", async () => {
    render(<WarmupPhase challenge={challenge} onComplete={vi.fn()} />);

    const startButton = screen.getByRole("button", { name: "Preparing..." });

    expect(screen.getByText(String(WARMUP_MIN_SECONDS))).toBeInTheDocument();
    expect(startButton).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByText(String(WARMUP_MIN_SECONDS - 1))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preparing..." })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync((WARMUP_MIN_SECONDS - 1) * 1000);
    });

    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Challenge →" })).toBeEnabled();
  });

  it("posts warmup completion and invokes onComplete with the challenge token", async () => {
    const onComplete = vi.fn();
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ challengeToken: "token-abc" }),
    });

    render(<WarmupPhase challenge={challenge} onComplete={onComplete} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WARMUP_MIN_SECONDS * 1000);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start Challenge →" }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/sessions/session-123/warmup-complete",
      { method: "POST" }
    );
    expect(onComplete).toHaveBeenCalledWith("token-abc");
  });

  it("shows a not-yet-ready message for a 400 response with remainingMs and does not invoke onComplete", async () => {
    const onComplete = vi.fn();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ remainingMs: 1500 }),
    });

    render(<WarmupPhase challenge={challenge} onComplete={onComplete} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WARMUP_MIN_SECONDS * 1000);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start Challenge →" }));
      await Promise.resolve();
    });

    expect(screen.getByText(/Not yet ready\. Please wait 2 more seconds and try again\./i)).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("shows a retry button after a network error and retries the request successfully", async () => {
    const onComplete = vi.fn();

    fetchMock
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ challengeToken: "token-retry" }),
      });

    render(<WarmupPhase challenge={challenge} onComplete={onComplete} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WARMUP_MIN_SECONDS * 1000);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start Challenge →" }));
      await Promise.resolve();
    });

    expect(screen.getByText(/Couldn't start the challenge\. Check your connection and try again\./i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenCalledWith("token-retry");
  });

  it("treats non-400 server failures as retryable errors", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({}),
    });

    render(<WarmupPhase challenge={challenge} onComplete={vi.fn()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WARMUP_MIN_SECONDS * 1000);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start Challenge →" }));
      await Promise.resolve();
    });

    expect(screen.getByText(/Couldn't start the challenge\. Check your connection and try again\./i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
