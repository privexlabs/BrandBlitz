import { describe, it, expect, vi, beforeEach } from "vitest";
import { optimizeImage, StorageError } from "./optimize";
import { s3 } from "./client";

vi.mock("./client", () => ({
  s3: {
    send: vi.fn(),
  },
  BUCKETS: {
    BRAND_ASSETS: "brand-assets",
  },
}));

describe("optimizeImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validImageBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64"
  );
  
  const corruptImageBuffer = Buffer.from("this is not an image");

  it("should process the image successfully (happy path)", async () => {
    vi.mocked(s3.send).mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () => validImageBuffer,
      },
    });

    const optimizedKey = await optimizeImage("test-image.png", "brand-logo");

    expect(optimizedKey).toBe("test-image.webp");
    expect(s3.send).toHaveBeenCalledTimes(2); // GetObjectCommand, PutObjectCommand
  });

  it("should throw a StorageError if the object body is null/undefined (missing object)", async () => {
    vi.mocked(s3.send).mockResolvedValue({
      Body: undefined,
    });

    await expect(optimizeImage("missing-image.png", "brand-logo"))
      .rejects.toThrow(StorageError);
      
    try {
      await optimizeImage("missing-image.png", "brand-logo");
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError);
      expect((error as StorageError).code).toBe("STORAGE_BODY_EMPTY");
      expect((error as StorageError).key).toBe("missing-image.png");
      expect((error as StorageError).bucket).toBe("brand-assets");
    }
  });

  it("should throw an error when processing a corrupt body", async () => {
    vi.mocked(s3.send).mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () => corruptImageBuffer,
      },
    });

    await expect(optimizeImage("corrupt-image.png", "brand-logo"))
      .rejects.toThrow(); // sharp should throw an error since it's not a valid image
      
    expect(s3.send).toHaveBeenCalledTimes(1); // Only GetObjectCommand should be called
  });
});
