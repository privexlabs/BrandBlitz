import { describe, it, expect, vi, beforeEach } from "vitest";
import { optimizeImage, StorageError } from "./optimize";
import { s3 } from "./client";
import sharp from "sharp";

vi.mock("./client", () => ({
  s3: {
    send: vi.fn(),
  },
  BUCKETS: {
    BRAND_ASSETS: "brand-assets",
  },
}));

// We'll mock sharp for some tests but keep it real for others if needed.
// Actually, for unit tests, it's better to mock it completely to avoid binary dependencies in some environments.
vi.mock("sharp", () => {
  const mSharp = vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ format: "png" }),
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("optimized")),
  }));
  return { default: mSharp };
});

describe("optimizeImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const dummyBuffer = Buffer.from("dummy");

  it("should process the image successfully (happy path)", async () => {
    vi.mocked(s3.send).mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () => dummyBuffer,
      },
    });

    const optimizedKey = await optimizeImage("test-image.png", "brand-logo");

    expect(optimizedKey).toBe("test-image.webp");
    expect(s3.send).toHaveBeenCalledTimes(2); // GetObjectCommand, PutObjectCommand
    expect(sharp).toHaveBeenCalledWith(dummyBuffer);
  });

  it("should throw a StorageError if the object body is null/undefined (missing object)", async () => {
    vi.mocked(s3.send).mockResolvedValue({
      Body: undefined,
    });

    await expect(optimizeImage("missing-image.png", "brand-logo"))
      .rejects.toThrow(StorageError);
  });

  it("should skip optimization and return original key for unsupported formats", async () => {
    vi.mocked(s3.send).mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () => dummyBuffer,
      },
    });

    // Mock metadata to return unsupported format
    vi.mocked(sharp).mockReturnValueOnce({
      metadata: vi.fn().mockResolvedValue({ format: "gif" }),
    } as any);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const resultKey = await optimizeImage("test-image.gif", "brand-logo");

    expect(resultKey).toBe("test-image.gif");
    expect(s3.send).toHaveBeenCalledTimes(1); // Only GetObjectCommand
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Unsupported image format: gif"));
    
    warnSpy.mockRestore();
  });

  it("should skip optimization and return original key when metadata processing fails", async () => {
    vi.mocked(s3.send).mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () => dummyBuffer,
      },
    });

    // Mock sharp to throw on metadata
    vi.mocked(sharp).mockReturnValueOnce({
      metadata: vi.fn().mockRejectedValue(new Error("Sharp error")),
    } as any);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const resultKey = await optimizeImage("corrupt.png", "brand-logo");

    expect(resultKey).toBe("corrupt.png");
    expect(s3.send).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to process image metadata"));

    warnSpy.mockRestore();
  });

  it("should skip optimization and return original key if metadata has no format", async () => {
    vi.mocked(s3.send).mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () => dummyBuffer,
      },
    });

    vi.mocked(sharp).mockReturnValueOnce({
      metadata: vi.fn().mockResolvedValue({}), // No format
    } as any);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const resultKey = await optimizeImage("no-format.png", "brand-logo");

    expect(resultKey).toBe("no-format.png");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Unsupported image format: undefined"));

    warnSpy.mockRestore();
  });
});
