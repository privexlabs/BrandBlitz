import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrandKitForm } from "./brand-kit-form";

const pushMock = vi.fn();
const postMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");

  return {
    ...actual,
    createApiClient: () => ({
      post: postMock,
    }),
  };
});

vi.mock("./upload-field", () => ({
  UploadField: ({
    label,
    uploadType,
    onUploaded,
  }: {
    label: string;
    uploadType: "brand-logo" | "product-image";
    onUploaded: (key: string, publicUrl: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        if (uploadType === "brand-logo") {
          onUploaded("logo-key-123", "https://cdn.example/logo.webp");
          return;
        }

        const count = (globalThis as any).__productUploadCount ?? 0;
        const nextCount = count + 1;
        (globalThis as any).__productUploadCount = nextCount;
        onUploaded(`product-key-${nextCount}`, `https://cdn.example/product-${nextCount}.webp`);
      }}
    >
      {label}
    </button>
  ),
}));

describe("BrandKitForm", () => {
  beforeEach(() => {
    postMock.mockReset();
    pushMock.mockReset();
    (globalThis as any).__productUploadCount = 0;
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-04-25T12:00:00.000Z").getTime());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps submit disabled until required fields and logo are present", async () => {
    const user = userEvent.setup();

    render(<BrandKitForm apiToken="test-token" />);

    const submitButton = screen.getByRole("button", { name: "Create Brand Kit & Challenge" });

    expect(submitButton).toBeDisabled();

    await user.type(screen.getByLabelText("Brand Name *"), "Acme");
    expect(submitButton).toBeDisabled();

    await user.type(screen.getByLabelText("Prize Pool (USDC) *"), "100");
    expect(submitButton).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Upload Brand Logo" }));
    expect(submitButton).toBeEnabled();
  });

  it("posts the exact API payloads and redirects with deposit instructions on success", async () => {
    const user = userEvent.setup();

    postMock
      .mockResolvedValueOnce({ data: { brand: { id: "brand-123" } } })
      .mockResolvedValueOnce({
        data: {
          depositInstructions: {
            hotWalletAddress: "GABC123",
            memo: "MEMO-123",
            amount: "100.00",
          },
        },
      });

    render(<BrandKitForm apiToken="test-token" />);

    await user.type(screen.getByLabelText("Brand Name *"), "Acme Corp");
    await user.type(screen.getByLabelText("Tagline"), "Launch faster");
    await user.type(
      screen.getByLabelText("Brand Story"),
      "Acme helps teams launch high-conviction campaigns."
    );
    await user.clear(screen.getByLabelText("Challenge Duration (hours)"));
    await user.type(screen.getByLabelText("Challenge Duration (hours)"), "24");
    await user.type(screen.getByLabelText("Prize Pool (USDC) *"), "100.00");
    await user.click(screen.getByRole("button", { name: "Upload Brand Logo" }));
    await user.click(screen.getByRole("button", { name: "Upload Product Image" }));
    await user.click(screen.getByRole("button", { name: "Upload Product Image" }));
    await user.click(screen.getByRole("button", { name: "Create Brand Kit & Challenge" }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(2);
    });

    expect(postMock).toHaveBeenNthCalledWith(1, "/brands", {
      name: "Acme Corp",
      tagline: "Launch faster",
      brandStory: "Acme helps teams launch high-conviction campaigns.",
      primaryColor: "#6366f1",
      secondaryColor: "#a5b4fc",
      logoKey: "logo-key-123",
      usp: "Launch faster",
      productImage1Key: "product-key-1",
      productImage2Key: "product-key-2",
    });

    expect(postMock).toHaveBeenNthCalledWith(2, "/brands/challenges", {
      brandId: "brand-123",
      poolAmountUsdc: "100",
      endsAt: "2026-04-26T12:00:00.000Z",
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(
        "/brand/brand-123?depositAddress=GABC123&memo=MEMO-123&amount=100.00"
      );
    });
  });

  it("shows the returned API error message inline for a 400 response", async () => {
    const user = userEvent.setup();

    postMock.mockRejectedValueOnce({
      response: {
        data: {
          message: "Brand name already exists.",
        },
      },
    });

    render(<BrandKitForm apiToken="test-token" />);

    await user.type(screen.getByLabelText("Brand Name *"), "Acme Corp");
    await user.type(screen.getByLabelText("Prize Pool (USDC) *"), "100");
    await user.click(screen.getByRole("button", { name: "Upload Brand Logo" }));
    await user.click(screen.getByRole("button", { name: "Create Brand Kit & Challenge" }));

    expect(await screen.findByText("Brand name already exists.")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("validates lowercase hex colour inputs client-side", async () => {
    const user = userEvent.setup();

    render(<BrandKitForm apiToken="test-token" />);

    const submitButton = screen.getByRole("button", { name: "Create Brand Kit & Challenge" });
    const primaryColorHexInput = screen.getByLabelText("Primary Color Hex");

    await user.type(screen.getByLabelText("Brand Name *"), "Acme Corp");
    await user.type(screen.getByLabelText("Prize Pool (USDC) *"), "100");
    await user.click(screen.getByRole("button", { name: "Upload Brand Logo" }));
    expect(submitButton).toBeEnabled();

    await user.clear(primaryColorHexInput);
    await user.type(primaryColorHexInput, "#ABCDEF");

    expect(primaryColorHexInput).toHaveAttribute("pattern", "^#[0-9a-f]{6}$");
    expect(primaryColorHexInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Use format `#rrggbb` in lowercase.")).toBeInTheDocument();
    expect(submitButton).toBeDisabled();

    await user.clear(primaryColorHexInput);
    await user.type(primaryColorHexInput, "#abcdef");

    expect(primaryColorHexInput).toHaveAttribute("aria-invalid", "false");
    expect(submitButton).toBeEnabled();
  });
});
