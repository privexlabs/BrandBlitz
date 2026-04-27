import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatScore, formatUsdc } from "@/lib/utils";
import type { LeaderboardEntry } from "@/lib/api";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import Image from "next/image";

async function getGlobalLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const res = await api.get("/leaderboard/global");
    return res.data.leaderboard;
  } catch {
    return [];
  }
}

const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export default async function LeaderboardPage() {
  const entries = await getGlobalLeaderboard();

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold mb-2">Global Leaderboard</h1>
      <p className="text-[var(--muted-foreground)] mb-8">Top performers across all challenges</p>

      <Card>
        <CardHeader>
          <CardTitle>All-Time Rankings</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No games played yet"
                description="Be the first to climb the leaderboard."
                action={
                  <Link href="/challenge">
                    <Button>Browse Challenges</Button>
                  </Link>
                }
              />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left px-6 py-3 font-medium text-[var(--muted-foreground)]">
                    Rank
                  </th>
                  <th className="text-left px-6 py-3 font-medium text-[var(--muted-foreground)]">
                    Player
                  </th>
                  <th className="text-right px-6 py-3 font-medium text-[var(--muted-foreground)]">
                    Score
                  </th>
                  <th className="text-right px-6 py-3 font-medium text-[var(--muted-foreground)]">
                    Earned
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.userId}
                    className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/50 transition-colors"
                  >
                    <td className="px-6 py-4 font-bold">
                      {MEDAL[entry.rank] ?? `#${entry.rank}`}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {entry.avatarUrl ? (
                          <Image
                            src={entry.avatarUrl}
                            alt={entry.displayName}
                            width={32}
                            height={32}
                            sizes="32px"
                            className="h-8 w-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-[var(--primary)] flex items-center justify-center text-white text-xs font-bold">
                            {entry.displayName.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="font-medium">{entry.displayName}</span>
                        {entry.league && (
                          <Badge variant={entry.league as "gold" | "silver" | "bronze"}>
                            {entry.league}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right font-mono">
                      {formatScore(entry.totalScore)}
                    </td>
                    <td className="px-6 py-4 text-right text-green-600 font-medium">
                      {entry.totalEarned ? `${formatUsdc(entry.totalEarned)} USDC` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
