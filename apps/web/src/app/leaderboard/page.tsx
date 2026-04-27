import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LeaderboardEntry } from "@/lib/api";
import { LiveGlobalLeaderboard } from "@/components/leaderboard/live-global-leaderboard";

async function getGlobalLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const res = await api.get("/leaderboard/global");
    return res.data.leaderboard;
  } catch {
    return [];
  }
}

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
          <LiveGlobalLeaderboard initial={entries} />
        </CardContent>
      </Card>
    </main>
  );
}
