import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatScore, formatUsdc } from "@/lib/utils";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import Image from "next/image";

interface ProfilePageProps {
  params: Promise<{ username: string }>;
}

async function getUserProfile(username: string) {
  try {
    const res = await api.get(`/users/profile/${username}`);
    return res.data.user;
  } catch {
    return null;
  }
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { username } = await params;
  const user = await getUserProfile(username);

  if (!user) notFound();

  return (
    <main className="max-w-2xl mx-auto px-6 py-12">
      {/* Profile header */}
      <div className="flex items-center gap-6 mb-10">
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
          <div className="h-20 w-20 rounded-full bg-[var(--primary)] flex items-center justify-center text-white text-2xl font-bold">
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
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Challenges", value: user.totalChallenges ?? 0 },
          { label: "Best Score", value: formatScore(user.bestScore ?? 0) },
          { label: "USDC Earned", value: `${formatUsdc(user.totalEarned ?? "0")}` },
        ].map(({ label, value }) => (
          <Card key={label} className="text-center">
            <CardContent className="pt-6 pb-4">
              <p className="text-2xl font-bold text-[var(--primary)]">{value}</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-1">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent activity */}
      {user.recentSessions?.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent Challenges</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <tbody>
                {user.recentSessions.map(
                  (session: {
                    id: string;
                    brandName: string;
                    totalScore: number;
                    rank?: number;
                    completedAt: string;
                  }) => (
                    <tr
                      key={session.id}
                      className="border-b border-[var(--border)] last:border-0"
                    >
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
