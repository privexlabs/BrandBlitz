import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatScore, formatUsdc } from "@/lib/utils";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import Image from "next/image";
import type { UserProfile } from "@/lib/api";

interface ProfilePageProps {
  params: Promise<{ username: string }>;
}

async function getUserProfile(
  username: string
): Promise<{ user: UserProfile | null; failed: boolean }> {
  try {
    const res = await api.get(`/users/profile/${username}`);
    return {
      user: res.data.user,
      failed: false,
    };
  } catch {
    return {
      user: null,
      failed: true,
    };
  }
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { username } = await params;
  const { user, failed } = await getUserProfile(username);

  if (!user && failed) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <EmptyState
          title="Couldn't load profile"
          description="We couldn't load this profile right now. Please try again."
          action={
            <Link href={`/profile/${username}`}>
              <Button variant="outline">Try Again</Button>
            </Link>
          }
        />
      </main>
    );
  }

  if (!user) notFound();

  const recentSessions = user.recentSessions ?? [];

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      {/* Profile header */}
      <div className="mb-10 flex items-center gap-6">
        {user.avatarUrl ? (
          <Image
            src={user.avatarUrl}
            alt={user.displayName}
            width={80}
            height={80}
            sizes="80px"
            className="h-20 w-20 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--primary)] text-2xl font-bold text-white">
            {user.displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold">{user.displayName}</h1>
          <p className="text-[var(--muted-foreground)]">@{user.username}</p>
          {user.league && (
            <Badge variant={user.league} className="mt-2">
              {user.league} League
            </Badge>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-3 gap-4">
        {[
          { label: "Challenges", value: user.totalChallenges ?? 0 },
          { label: "Best Score", value: formatScore(user.bestScore ?? 0) },
          { label: "USDC Earned", value: `${formatUsdc(user.totalEarned ?? "0")}` },
        ].map(({ label, value }) => (
          <Card key={label} className="text-center">
            <CardContent className="pb-4 pt-6">
              <p className="text-2xl font-bold text-[var(--primary)]">{value}</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent activity */}
      {recentSessions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent Challenges</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <tbody>
                {recentSessions.map(
                  (session: {
                    id: string;
                    brandName: string;
                    totalScore: number;
                    rank?: number;
                    completedAt: string;
                  }) => (
                    <tr key={session.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-6 py-3 font-medium">{session.brandName}</td>
                      <td className="px-6 py-3 text-right">{formatScore(session.totalScore)}</td>
                      <td className="px-6 py-3 text-right text-[var(--muted-foreground)]">
                        {session.rank ? `#${session.rank}` : "—"}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          title="No history yet"
          description="Play a challenge to start building your stats."
          action={
            <Link href="/challenge">
              <Button>Browse Challenges</Button>
            </Link>
          }
        />
      )}
    </main>
  );
}
