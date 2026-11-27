import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReportModal } from "./report-modal";
import { createApiClient } from "@/lib/api";
import { toast } from "@/lib/toast";

vi.mock("@/lib/api");
vi.mock("@/lib/toast");

const mockApiClient = {
  post: vi.fn(),
};

describe("ReportModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createApiClient).mockReturnValue(mockApiClient as any);
    vi.mocked(toast.success).mockImplementation(() => {});
    vi.mocked(toast.error).mockImplementation(() => {});
    vi.mocked(toast.warning).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("disables submit button until a reason is selected", () => {
    const onOpenChange = vi.fn();
    render(<ReportModal challengeId="chal_1" open={true} onOpenChange={onOpenChange} />);

    const submitButton = screen.getByRole("button", { name: /submit report/i });
    expect(submitButton).toBeDisabled();

    const misleadingOption = screen.getByLabelText(/misleading content/i);
    fireEvent.click(misleadingOption);

    expect(submitButton).not.toBeDisabled();
  });

  it("clamps note input to MAX_NOTE_LENGTH (500)", () => {
    const onOpenChange = vi.fn();
    render(<ReportModal challengeId="chal_1" open={true} onOpenChange={onOpenChange} />);

    const textarea = screen.getByPlaceholderText(/provide any extra context/i);
    const longText = "a".repeat(600);

    fireEvent.change(textarea, { target: { value: longText } });

    expect((textarea as HTMLTextAreaElement).value).toHaveLength(500);
  });

  it("shows warning toast and prevents API call when submitting within rate limit", async () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    mockApiClient.post.mockResolvedValue({});

    render(<ReportModal challengeId="chal_1" open={true} onOpenChange={onOpenChange} />);

    const misleadingOption = screen.getByLabelText(/misleading content/i);
    fireEvent.click(misleadingOption);

    const submitButton = screen.getByRole("button", { name: /submit report/i });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockApiClient.post).toHaveBeenCalledTimes(1);
    });

    vi.advanceTimersByTime(30_000);

    fireEvent.click(submitButton);

    expect(toast.warning).toHaveBeenCalledWith("Please wait before submitting another report.");
    expect(mockApiClient.post).toHaveBeenCalledTimes(1);
  });

  it("closes dialog and shows already-reported toast on 409 response", async () => {
    const onOpenChange = vi.fn();
    const error = {
      response: { status: 409 },
    };
    mockApiClient.post.mockRejectedValue(error);

    render(<ReportModal challengeId="chal_1" open={true} onOpenChange={onOpenChange} />);

    const misleadingOption = screen.getByLabelText(/misleading content/i);
    fireEvent.click(misleadingOption);

    const submitButton = screen.getByRole("button", { name: /submit report/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("You have already reported this challenge.");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("resets reason and note fields when dialog closes", async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ReportModal challengeId="chal_1" open={true} onOpenChange={onOpenChange} />
    );

    const misleadingOption = screen.getByLabelText(/misleading content/i);
    fireEvent.click(misleadingOption);

    const textarea = screen.getByPlaceholderText(/provide any extra context/i);
    fireEvent.change(textarea, { target: { value: "Test note" } });

    expect((textarea as HTMLTextAreaElement).value).toBe("Test note");

    rerender(<ReportModal challengeId="chal_1" open={false} onOpenChange={onOpenChange} />);

    rerender(<ReportModal challengeId="chal_1" open={true} onOpenChange={onOpenChange} />);

    const textareaAfterReopen = screen.getByPlaceholderText(/provide any extra context/i);
    expect((textareaAfterReopen as HTMLTextAreaElement).value).toBe("");

    const misleadingOptionAfterReopen = screen.getByLabelText(/misleading content/i);
    expect((misleadingOptionAfterReopen as HTMLInputElement).checked).toBe(false);
  });
});
