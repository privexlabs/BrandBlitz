import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { formatUsdc } from "@/lib/utils";
import type { Challenge } from "@/lib/api";

async function getActiveChallenges(): Promise<Challenge[]> {
  try {
    const res = await api.get("/challenges?limit=6");
    return res.data.challenges;
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const challenges = await getActiveChallenges();

  return (
    <main className="flex flex-col min-h-screen">
      {/* Hero */}
      <section className="flex flex-col items-center justify-center text-center px-6 py-24 bg-gradient-to-b from-[var(--primary)] to-[var(--background)]">
        <Badge variant="secondary" className="mb-4">
          Powered by Stellar USDC
        </Badge>
        <h1 className="text-5xl md:text-7xl font-extrabold text-white mb-6 leading-tight">
          Brand Challenges.
          <br />
          Real USDC Rewards.
        </h1>
        <p className="text-lg md:text-xl text-white/80 max-w-xl mb-10">
          Study a brand for 30 seconds. Answer 3 questions. Top performers earn USDC instantly on
          Stellar.
        </p>
        <div className="flex gap-4 flex-wrap justify-center">
          <Link href="/challenge">
            <Button size="lg" variant="secondary" className="text-lg px-8">
              Play Now
            </Button>
          </Link>
          <Link href="/login">
            <Button
              size="lg"
              variant="outline"
              className="text-lg px-8 text-white border-white hover:bg-white/10"
            >
              Sign In
            </Button>
          </Link>
        </div>
      </section>

      {/* Active Challenges */}
      <section className="px-6 py-16 max-w-5xl mx-auto w-full">
        <h2 className="text-3xl font-bold mb-8">Active Challenges</h2>

        {challenges.length === 0 ? (
          <p className="text-[var(--muted-foreground)]">
            No active challenges yet. Check back soon!
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {challenges.map((c) => (
              <Card key={c.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    {c.logo_url ? (
                      <Image
                        src={c.logo_url}
                        alt={c.brand_name}
                        width={160}
                        height={48}
                        sizes="160px"
                        className="h-12 w-auto object-contain"
                      />
                    ) : (
                      <div
                        className="h-12 w-12 rounded-lg"
                        style={{ backgroundColor: c.primary_color ?? "var(--primary)" }}
                      />
                    )}
                    <Badge variant="default">Active</Badge>
                  </div>
                  <CardTitle>{c.brand_name}</CardTitle>
                  <CardDescription>
                    Prize pool: {formatUsdc(c.pool_amount_usdc)} USDC
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Link href={`/challenge/${c.id}`}>
                    <Button
                      className="w-full"
                      style={{ backgroundColor: c.primary_color ?? undefined }}
                    >
                      Accept Challenge
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* How It Works */}
      <section className="px-6 py-16 bg-[var(--muted)]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
            {[
              {
                step: "1",
                title: "Study",
                desc: "30 seconds of brand content — logo, story, products.",
              },
              {
                step: "2",
                title: "Compete",
                desc: "3 rounds of questions based on what you just saw.",
              },
              {
                step: "3",
                title: "Earn",
                desc: "Top scorers earn USDC instantly to your Stellar wallet.",
              },
            ].map(({ step, title, desc }) => (
              <div key={step} className="space-y-3">
                <div className="h-14 w-14 rounded-full bg-[var(--primary)] text-white text-xl font-bold flex items-center justify-center mx-auto">
                  {step}
                </div>
                <h3 className="text-xl font-semibold">{title}</h3>
                <p className="text-[var(--muted-foreground)]">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
