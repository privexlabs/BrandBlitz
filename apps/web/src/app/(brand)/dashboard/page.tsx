"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatUsdc } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/lib/toast";

interface ChallengeStats {
  total_sessions: number;
  completed_sessions: number;
  completion_rate_pct: number;
  disqualification_rate_pct: number;
  avg_score: number;
  avg_accuracy_pct: number;
  avg_time_per_round_ms: number;
  total_paid_out_usdc: number;
  cost_per_completed_session_usdc: number;
  unique_participants: number;
}

interface BrandWithChallenges {
  id: string;
  name: string;
  logoUrl?: string;
  primaryColor?: string;
  challenges: {
    id: string;
    status: string;
    poolAmountUsdc: string;
    participantCount: number;
    endsAt: string;
    stats?: ChallengeStats;
  }[];
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const apiToken = (session as { apiToken?: string } | null)?.apiToken;
  const [brands, setBrands] = useState<BrandWithChallenges[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [deletingBrandId, setDeletingBrandId] = useState<string | null>(null);

  async function loadBrands(apiToken: string) {
    setLoading(true);
    setLoadError(false);

    const api = createApiClient(apiToken);

    try {
      const res = await api.get("/brands");
      const brandsData = res.data.brands;

      const brandsWithStats = await Promise.all(
        brandsData.map(async (brand: BrandWithChallenges) => {
          const challenges = await Promise.all(
            brand.challenges.map(async (challenge) => {
              try {
                const statsResponse = await api.get(`/challenges/${challenge.id}/stats`);
                return { ...challenge, stats: statsResponse.data.stats as ChallengeStats };
              } catch {
                return challenge;
              }
            })
          );
          return { ...brand, challenges };
        })
      );

      setBrands(brandsWithStats);
    } catch {
      setBrands([]);
      setLoadError(true);
      toast.error("Couldn't load brands. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
      return;
    }
    if (status !== "authenticated" || !apiToken) return;

    void loadBrands(apiToken);
  }, [apiToken, status, router]);

  async function handleDeleteBrand(brand: BrandWithChallenges) {
    if (deletingBrandId) return;
    const ok = window.confirm(`Delete "${brand.name}"? This can't be undone.`);
    if (!ok) return;
    if (!apiToken) return;

    setDeletingBrandId(brand.id);
    try {
      const api = createApiClient(apiToken);
      await api.delete(`/brands/${brand.id}`);
      setBrands((prev) => prev.filter((b) => b.id !== brand.id));
    } catch {
      toast.error(`Couldn't delete "${brand.name}". Please try again.`);
    } finally {
      setDeletingBrandId(null);
    }
  }

  if (loading) {
    return null;
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Brand Dashboard</h1>
          <p className="mt-1 text-[var(--muted-foreground)]">
            Manage your brand kits and challenges
          </p>
        </div>
        <Link href="/brand/new">
          <Button>+ New Brand</Button>
        </Link>
      </div>

      {loadError ? (
        <EmptyState
          title="Couldn't load brands"
          description="We couldn't load your brands — tap to retry."
          action={
            <Button disabled={!apiToken} onClick={() => apiToken && void loadBrands(apiToken)}>
              Try Again
            </Button>
          }
        />
      ) : brands.length === 0 ? (
        <EmptyState
          title="No brands yet"
          description="Create your first brand kit and launch a challenge in minutes."
          action={
            <Link href="/brand/new">
              <Button>Create Brand Kit</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          {brands.map((brand) => (
            <Card key={brand.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {brand.logoUrl ? (
                      <Image
                        src={brand.logoUrl}
                        alt={brand.name}
                        width={160}
                        height={48}
                        sizes="160px"
                        className="h-12 w-auto object-contain"
                      />
                    ) : (
                      <div
                        className="h-12 w-12 rounded-lg"
                        style={{ backgroundColor: brand.primaryColor ?? "var(--primary)" }}
                      />
                    )}
                    <div>
                      <CardTitle>{brand.name}</CardTitle>
                      <CardDescription>{brand.challenges.length} challenge(s)</CardDescription>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/brand/${brand.id}`}>
                      <Button variant="outline" size="sm">
                        View Analytics
                      </Button>
                    </Link>
                    <Link href={`/brand/${brand.id}/challenge/new`}>
                      <Button size="sm">Launch Challenge</Button>
                    </Link>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deletingBrandId === brand.id}
                      onClick={() => handleDeleteBrand(brand)}
                    >
                      {deletingBrandId === brand.id ? "Deleting..." : "Delete"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {brand.challenges.length > 0 && (
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border)]">
                          <th className="py-2 text-left font-medium text-[var(--muted-foreground)]">
                            Status
                          </th>
                          <th className="py-2 text-right font-medium text-[var(--muted-foreground)]">
                            Pool
                          </th>
                          <th className="py-2 text-right font-medium text-[var(--muted-foreground)]">
                            Participants
                          </th>
                          <th className="py-2 text-right font-medium text-[var(--muted-foreground)]">
                            Sessions
                          </th>
                          <th className="py-2 text-right font-medium text-[var(--muted-foreground)]">
                            Completion
                          </th>
                          <th className="py-2 text-right font-medium text-[var(--muted-foreground)]">
                            Accuracy
                          </th>
                          <th className="py-2 text-right font-medium text-[var(--muted-foreground)]">
                            Paid out
                          </th>
                          <th className="py-2 text-right font-medium text-[var(--muted-foreground)]">
                            Cost / completion
                          </th>
                          <th className="py-2 text-right font-medium text-[var(--muted-foreground)]">
                            Ends
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {brand.challenges.map((c) => {
                          const stats = c.stats;
                          return (
                            <tr
                              key={c.id}
                              className="border-b border-[var(--border)] last:border-0"
                            >
                              <td className="py-2">
                                <Badge
                                  variant={
                                    c.status === "active"
                                      ? "default"
                                      : c.status === "pending_deposit"
                                        ? "secondary"
                                        : "outline"
                                  }
                                >
                                  {c.status.replace("_", " ")}
                                </Badge>
                              </td>
                              <td className="py-2 text-right">{formatUsdc(c.poolAmountUsdc)}</td>
                              <td className="py-2 text-right">
                                {stats?.unique_participants ?? c.participantCount}
                              </td>
                              <td className="py-2 text-right">
                                {stats
                                  ? `${stats.completed_sessions}/${stats.total_sessions}`
                                  : "—"}
                              </td>
                              <td className="py-2 text-right">
                                {stats ? `${stats.completion_rate_pct}%` : "—"}
                              </td>
                              <td className="py-2 text-right">
                                {stats ? `${stats.avg_accuracy_pct}%` : "—"}
                              </td>
                              <td className="py-2 text-right">
                                {stats ? formatUsdc(stats.total_paid_out_usdc) : "—"}
                              </td>
                              <td className="py-2 text-right">
                                {stats ? formatUsdc(stats.cost_per_completed_session_usdc) : "—"}
                              </td>
                              <td className="py-2 text-right text-[var(--muted-foreground)]">
                                {new Date(c.endsAt).toLocaleDateString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
