"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatScore, formatUsdc } from "@/lib/utils";
import type { LeaderboardEntry } from "@/lib/api";

function normalizeBrand(brand: any) {
  if (!brand) return null;

  return {
    ...brand,
    logoUrl: brand.logoUrl ?? brand.logo_url ?? null,
    primaryColor: brand.primaryColor ?? brand.primary_color ?? null,
    secondaryColor: brand.secondaryColor ?? brand.secondary_color ?? null,
  };
}

function normalizeChallenge(challenge: any) {
  if (!challenge) return null;

  return {
    ...challenge,
    poolAmountUsdc: challenge.poolAmountUsdc ?? challenge.pool_amount_usdc ?? "0",
    participantCount: challenge.participantCount ?? challenge.participant_count ?? 0,
  };
}

export default function BrandAnalyticsPage() {
  const { data: session, status } = useSession();
  const params = useParams();
  const router = useRouter();
  const brandId = params.id as string;

  const [brand, setBrand] = useState<any>(null);
  const [challenge, setChallenge] = useState<any>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
      return;
    }
    if (status !== "authenticated") return;

    const api = createApiClient((session as any).apiToken);

    Promise.all([
      api.get(`/brands/${brandId}`),
      api.get(`/challenges?brandId=${brandId}&limit=1`).catch(() => ({ data: { challenges: [] } })),
    ])
      .then(([brandRes, challengeRes]) => {
        setBrand(normalizeBrand(brandRes.data.brand));
        const latestChallenge = normalizeChallenge(challengeRes.data.challenges[0]);
        setChallenge(latestChallenge ?? null);

        if (latestChallenge) {
          return api
            .get(`/challenges/${latestChallenge.id}/leaderboard`)
            .then((r) => setLeaderboard(r.data.sessions))
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session, status, router, brandId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-[var(--muted-foreground)]">Loading...</div>
      </div>
    );
  }

  if (!brand) {
    return (
      <main className="max-w-2xl mx-auto px-6 py-12">
        <p className="text-[var(--muted-foreground)]">Brand not found.</p>
      </main>
    );
  }

  return (
    <main className="max-w-4xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brand.name} className="h-16 object-contain" />
          ) : (
            <div
              className="h-16 w-16 rounded-xl"
              style={{ backgroundColor: brand.primaryColor ?? "var(--primary)" }}
            />
          )}
          <div>
            <h1 className="text-2xl font-bold">{brand.name}</h1>
            <p className="text-[var(--muted-foreground)]">{brand.tagline}</p>
          </div>
        </div>
        <Link href={`/brand/${brandId}/challenge/new`}>
          <Button>Launch New Challenge</Button>
        </Link>
      </div>

      {challenge && (
        <>
          <div className="grid grid-cols-3 gap-4 mb-8">
            {[
              { label: "Pool Size", value: `${formatUsdc(challenge.poolAmountUsdc)} USDC` },
              { label: "Participants", value: challenge.participantCount ?? 0 },
              { label: "Status", value: challenge.status },
            ].map(({ label, value }) => (
              <Card key={label} className="text-center">
                <CardContent className="pt-6 pb-4">
                  <p className="text-xl font-bold text-[var(--primary)]">{value}</p>
                  <p className="text-xs text-[var(--muted-foreground)] mt-1">{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {leaderboard.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Current Leaderboard</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="text-left px-6 py-3 text-[var(--muted-foreground)]">Rank</th>
                      <th className="text-left px-6 py-3 text-[var(--muted-foreground)]">Player</th>
                      <th className="text-right px-6 py-3 text-[var(--muted-foreground)]">Score</th>
                      <th className="text-right px-6 py-3 text-[var(--muted-foreground)]">Est. Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.slice(0, 10).map((entry) => (
                      <tr
                        key={`${entry.rank}-${entry.username}`}
                        className="border-b border-[var(--border)] last:border-0"
                      >
                        <td className="px-6 py-3 font-bold">#{entry.rank}</td>
                        <td className="px-6 py-3">{entry.username}</td>
                        <td className="px-6 py-3 text-right font-mono">
                          {formatScore(entry.totalScore)}
                        </td>
                        <td className="px-6 py-3 text-right text-green-600">
                          {"—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {!challenge && (
        <Card className="text-center py-12">
          <CardContent>
            <p className="text-[var(--muted-foreground)] mb-4">No active challenge for this brand.</p>
            <Link href={`/brand/${brandId}/challenge/new`}>
              <Button>Launch a Challenge</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
