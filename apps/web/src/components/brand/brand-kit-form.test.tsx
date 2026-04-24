import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrandKitForm } from "./brand-kit-form";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  post: vi.fn(),
  productUploadCount: 0,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
  }),
}));

vi.mock("@/lib/api", () => ({
  createApiClient: () => ({
    post: mocks.post,
  }),
}));

vi.mock("./upload-field", () => ({
  UploadField: ({
    uploadType,
    onUploaded,
    label,
  }: {
    uploadType: "brand-logo" | "product-image" | "user-avatar";
    onUploaded: (key: string, publicUrl: string) => void;
    label: string;
  }) => (
    <button
      type="button"
      data-testid={`upload-${uploadType}`}
      onClick={() => {
        if (uploadType === "brand-logo") {
          onUploaded("logo-key", "https://example.com/logo.webp");
          return;
        }

        mocks.productUploadCount += 1;
        onUploaded(
          `product-${mocks.productUploadCount}-key`,
          `https://example.com/product-${mocks.productUploadCount}.webp`
        );
      }}
    >
      {label}
    </button>
  ),
}));

describe("BrandKitForm", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.post.mockReset();
    mocks.productUploadCount = 0;

    mocks.post.mockImplementation(async (url: string) => {
      if (url === "/brands") {
        return {
          data: {
            brand: { id: "11111111-1111-4111-8111-111111111111" },
          },
        };
      }

      if (url === "/brands/challenges") {
        return {
          data: {
            challenge: { id: "22222222-2222-4222-8222-222222222222" },
            depositInstructions: {
              hotWalletAddress: "GBRANDHOTWALLETTESTADDRESS",
              memo: "challenge-memo-123",
            },
          },
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
  });

  it("posts the exact API-compatible payload shape for brand and challenge creation", async () => {
    render(<BrandKitForm apiToken="test-api-token" />);

    fireEvent.change(screen.getByLabelText(/Brand Name/i), {
      target: { value: "Acme Corp" },
    });
    fireEvent.change(screen.getByLabelText(/Tagline/i), {
      target: { value: "Built for attention" },
    });
    fireEvent.change(screen.getByLabelText(/Brand Story/i), {
      target: { value: "A short story used for question generation." },
    });
    fireEvent.change(screen.getByLabelText(/Prize Pool \(USDC\)/i), {
      target: { value: "100.00" },
    });
    fireEvent.change(screen.getByLabelText(/Challenge Duration \(hours\)/i), {
      target: { value: "24" },
    });

    fireEvent.click(screen.getByTestId("upload-brand-logo"));
    fireEvent.click(screen.getByTestId("upload-product-image"));
    fireEvent.click(screen.getByTestId("upload-product-image"));

    fireEvent.click(screen.getByRole("button", { name: /Create Brand Kit & Challenge/i }));

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledTimes(2);
    });

    const [firstUrl, firstPayload] = mocks.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(firstUrl).toBe("/brands");
    expect(firstPayload).toStrictEqual({
      name: "Acme Corp",
      tagline: "Built for attention",
      brandStory: "A short story used for question generation.",
      primaryColor: "#6366f1",
      secondaryColor: "#a5b4fc",
      logoKey: "logo-key",
      productImage1Key: "product-1-key",
      productImage2Key: "product-2-key",
    });

    const [secondUrl, secondPayload] = mocks.post.mock.calls[1] as [string, Record<string, unknown>];
    expect(secondUrl).toBe("/brands/challenges");
    expect(Object.keys(secondPayload).sort()).toEqual(["brandId", "endsAt", "poolAmountUsdc"]);
    expect(secondPayload.brandId).toBe("11111111-1111-4111-8111-111111111111");
    expect(secondPayload.poolAmountUsdc).toBe("100.00");
    expect(typeof secondPayload.endsAt).toBe("string");
    expect(Number.isNaN(Date.parse(secondPayload.endsAt as string))).toBe(false);

    expect(mocks.push).toHaveBeenCalledWith(
      "/brand/11111111-1111-4111-8111-111111111111?depositAddress=GBRANDHOTWALLETTESTADDRESS&memo=challenge-memo-123"
    );
  });
});
