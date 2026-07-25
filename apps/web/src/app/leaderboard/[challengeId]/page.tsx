import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LeaderboardEntry } from "@/lib/api";
import { LiveGlobalLeaderboard } from "@/components/leaderboard/live-global-leaderboard";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { OfflineBanner } from "@/components/layout/offline-banner";

interface Props {
  params: {
    challengeId: string;
  };
}

export const metadata: Metadata = {
  title: "Challenge Leaderboard",
  description: "See the top performers for this challenge and their USDC earnings.",
};

// Enable ISR with 30-second revalidation
export const revalidate = 30;

async function getChallengeLeaderboard(challengeId: string): Promise<{
  entries: LeaderboardEntry[];
  hasMore: boolean;
  failed: boolean;
}> {
  try {
    const res = await api.get(`/leaderboard/${challengeId}?limit=50`);
    return {
      entries: res.data.data || res.data.sessions || [],
      hasMore: Boolean(res.data.nextCursor),
      failed: false,
    };
  } catch {
    return {
      entries: [],
      hasMore: false,
      failed: true,
    };
  }
}

function LeaderboardSkeleton() {
  return (
    <div className="border-b border-[var(--border)] last:border-0 px-6 py-4 space-y-4">
      {Array.from({ length: 6 }).map((_, idx) => (
        <div
          key={idx}
          className="grid grid-cols-[80px_1fr_120px_120px] gap-4 items-center"
        >
          <Skeleton className="h-5 w-10" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-4 w-36" />
          </div>
          <Skeleton className="h-4 w-20 ml-auto" />
          <Skeleton className="h-4 w-16 ml-auto" />
        </div>
      ))}
    </div>
  );
}

async function LeaderboardContent({ challengeId }: { challengeId: string }) {
  const { entries, hasMore, failed } = await getChallengeLeaderboard(challengeId);

  if (failed) {
    return (
      <div className="p-6">
        <EmptyState
          title="Couldn't load leaderboard"
          description="We couldn't load the rankings right now. Please try again."
          action={
            <Link href={`/leaderboard/${challengeId}`}>
              <Button variant="outline">Try Again</Button>
            </Link>
          }
        />
      </div>
    );
  }

  // LiveGlobalLeaderboard also supports a specific challengeId if passed
  return <LiveGlobalLeaderboard initial={entries} initialHasMore={hasMore} challengeId={challengeId} />;
}

export default function ChallengeLeaderboardPage({ params }: Props) {
  return (
    <>
      <OfflineBanner />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="mb-2 text-3xl font-bold">Challenge Leaderboard</h1>
        <p className="mb-8 text-[var(--muted-foreground)]">Top performers for this challenge</p>

        <Card>
          <CardHeader>
            <CardTitle>Rankings</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Suspense fallback={<LeaderboardSkeleton />}>
              <LeaderboardContent challengeId={params.challengeId} />
            </Suspense>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
