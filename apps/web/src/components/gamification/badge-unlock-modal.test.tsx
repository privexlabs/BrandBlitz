import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  BadgeUnlockModal,
  resetInMemoryDismissalsForTests,
  type Badge,
} from "./badge-unlock-modal";

// Mock sessionStorage
const sessionStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(window, "sessionStorage", { value: sessionStorageMock });

const badge1: Badge = {
  id: "b1",
  name: "First Win",
  description: "You won your first challenge!",
  iconUrl: undefined,
};
const badge2: Badge = {
  id: "b2",
  name: "Streak Master",
  description: "7-day streak!",
  iconUrl: undefined,
};

describe("BadgeUnlockModal focus management (#814)", () => {
  beforeEach(() => {
    sessionStorageMock.clear();
  });

  it("moves focus to the close button when the modal opens", () => {
    render(<BadgeUnlockModal badges={[badge1]} onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /close/i }));
  });

  it("Tab on the last focusable element wraps to the first inside the modal", () => {
    render(<BadgeUnlockModal badges={[badge1]} onClose={() => {}} />);
    const closeBtn = screen.getByRole("button", { name: /close/i });
    const shareLink = screen.getByRole("link", { name: /Share on X/i });

    shareLink.focus();
    fireEvent.keyDown(shareLink, { key: "Tab" });

    expect(document.activeElement).toBe(closeBtn);
  });

  it("Shift+Tab on the first focusable element wraps to the last inside the modal", () => {
    render(<BadgeUnlockModal badges={[badge1]} onClose={() => {}} />);
    const closeBtn = screen.getByRole("button", { name: /close/i });
    const shareLink = screen.getByRole("link", { name: /Share on X/i });

    closeBtn.focus();
    fireEvent.keyDown(closeBtn, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(shareLink);
  });

  it("Tab from outside the modal pulls focus back into it", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    render(<BadgeUnlockModal badges={[badge1]} onClose={() => {}} />);

    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab" });

    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    outside.remove();
  });

  it("returns focus to the element that opened the modal when it unmounts", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(<BadgeUnlockModal badges={[badge1]} onClose={() => {}} />);
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

describe("BadgeUnlockModal", () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    resetInMemoryDismissalsForTests();
    vi.restoreAllMocks();
  });

  it("does not render when badges is empty", () => {
    const { container } = render(<BadgeUnlockModal badges={[]} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders badge name and description", () => {
    render(<BadgeUnlockModal badges={[badge1]} onClose={() => {}} />);
    expect(screen.getByText("First Win")).toBeTruthy();
    expect(screen.getByText("You won your first challenge!")).toBeTruthy();
  });

  it("share link uses correct badge name and product name", () => {
    render(<BadgeUnlockModal badges={[badge1]} onClose={() => {}} />);
    const link = screen.getByRole("link", { name: /Share on X/i });
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain(encodeURIComponent("First Win"));
    expect(href).toContain("BrandBlitz!");
    expect(href).not.toContain("StreamFi");
    expect(href).toContain("x.com/intent/tweet");
    // Opens in new tab with safe rel attributes
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("onClose called on close button click", () => {
    const onClose = vi.fn();
    vi.useFakeTimers();
    render(<BadgeUnlockModal badges={[badge1]} onClose={onClose} />);
    const closeBtn = screen.getByRole("button", { name: /close/i });
    fireEvent.click(closeBtn);
    vi.advanceTimersByTime(400);
    expect(onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("navigates between badges in multi-badge carousel with transition", () => {
    vi.useFakeTimers();
    render(<BadgeUnlockModal badges={[badge1, badge2]} onClose={() => {}} />);
    expect(screen.getByText("First Win")).toBeTruthy();

    const nextBtn = screen.getByRole("button", { name: /next badge/i });
    const prevBtn = screen.getByRole("button", { name: /previous badge/i });

    expect((prevBtn as HTMLButtonElement).disabled).toBe(true);
    expect((nextBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(nextBtn);
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText("Streak Master")).toBeTruthy();
    expect((nextBtn as HTMLButtonElement).disabled).toBe(true);
    expect((prevBtn as HTMLButtonElement).disabled).toBe(false);

    vi.useRealTimers();
  });

  describe("dismissal persistence", () => {
    const fallbackBadge: Badge = {
      id: "fallback-b1",
      name: "Fallback Badge",
      description: "Earned while storage is blocked",
    };

    it("keeps cross-reload dismissal in sessionStorage when storage works", () => {
      vi.useFakeTimers();
      const onClose = vi.fn();
      const { unmount } = render(<BadgeUnlockModal badges={[badge1]} onClose={onClose} />);
      fireEvent.click(screen.getByRole("button", { name: /close/i }));
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(onClose).toHaveBeenCalled();
      expect(sessionStorageMock.getItem("dismissed_badges_b1")).toBe("true");
      unmount();

      // A new page load reads from sessionStorage and does not show the badge again.
      const { container } = render(<BadgeUnlockModal badges={[badge1]} onClose={() => {}} />);
      expect(container.firstChild).toBeNull();
      vi.useRealTimers();
    });

    it("does not reappear within the same lifetime when sessionStorage throws", () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const storageError = Object.assign(new Error("blocked"), { name: "SecurityError" });
      vi.spyOn(sessionStorageMock, "getItem").mockImplementation(() => {
        throw storageError;
      });
      vi.spyOn(sessionStorageMock, "setItem").mockImplementation(() => {
        throw storageError;
      });

      const onClose = vi.fn();
      const { rerender, container } = render(
        <BadgeUnlockModal badges={[fallbackBadge]} onClose={onClose} />
      );
      expect(screen.getByText("Fallback Badge")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: /close/i }));
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(onClose).toHaveBeenCalled();

      // Re-render with a new badges array so the dismissal filter runs again.
      rerender(<BadgeUnlockModal badges={[{ ...fallbackBadge }]} onClose={onClose} />);
      expect(container.firstChild).toBeNull();

      // Both failure paths logged a diagnosable warning that names storage.
      const messages = warn.mock.calls.map((call) => String(call[0]));
      expect(messages.some((m) => m.includes("sessionStorage write failed"))).toBe(true);
      expect(messages.some((m) => m.includes("sessionStorage read failed"))).toBe(true);
      expect(messages.every((m) => m.includes("[BadgeUnlockModal]"))).toBe(true);
      vi.useRealTimers();
    });
  });
});
