"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePublicConfig } from "@/hooks/use-public-config";

interface MaintenanceBannerProps {
  className?: string;
}

export function MaintenanceBanner({ className }: MaintenanceBannerProps) {
  const { config } = usePublicConfig();

  if (!config?.maintenance_mode) return null;

  return (
    <div
      className={cn(
        "sticky top-0 z-50 w-full border-b border-amber-700 bg-amber-300 px-4 py-3 text-amber-950 shadow-sm",
        className,
      )}
      role="status"
      aria-live="assertive"
    >
      <div className="mx-auto flex max-w-5xl items-center justify-center gap-2 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>BrandBlitz is undergoing maintenance. Some features may be unavailable.</span>
      </div>
    </div>
  );
}
