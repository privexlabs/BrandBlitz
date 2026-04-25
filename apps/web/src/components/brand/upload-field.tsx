"use client";

import { useRef, useState } from "react";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface UploadFieldProps {
  label: string;
  accept?: string;
  uploadType: "brand-logo" | "product-image" | "user-avatar";
  apiToken: string;
  onUploaded: (key: string, publicUrl: string) => void;
  className?: string;
}

export function UploadField({
  label,
  accept = "image/*",
  uploadType,
  apiToken,
  onUploaded,
  className,
}: UploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);

    try {
      const api = createApiClient(apiToken);

      // 1. Get presigned URL
      const presignRes = await api.post("/upload/presign", {
        type: uploadType,
        contentType: file.type,
        contentLength: file.size,
      });

      const { uploadUrl, key, publicUrl } = presignRes.data;

      // 2. Upload directly to S3/MinIO
      await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      // 3. Verify upload
      await api.post("/upload/verify", { key });

      setUploadedUrl(publicUrl);
      onUploaded(key, publicUrl);
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {uploadedUrl ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={uploadedUrl} alt={label} className="h-16 w-16 object-contain rounded-lg border border-[var(--border)]" />
          <div>
            <p className="text-sm font-medium text-green-600">Uploaded</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setUploadedUrl(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              Replace
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={cn(
            "w-full border-2 border-dashed border-[var(--border)] rounded-xl p-8 text-center transition-colors hover:border-[var(--primary)] hover:bg-[var(--muted)]/50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
          )}
        >
          {uploading ? (
            <p className="text-sm text-[var(--muted-foreground)]">Uploading...</p>
          ) : (
            <>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-1">
                Click to upload · {accept}
              </p>
            </>
          )}
        </button>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
