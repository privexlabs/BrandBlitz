"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatUsdc } from "@/lib/utils";

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
  }[];
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [brands, setBrands] = useState<BrandWithChallenges[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
      return;
    }
    if (status !== "authenticated") return;

    const api = createApiClient(session.apiToken);
    api
      .get("/brands")
      .then((res) => setBrands(res.data.brands))
      .catch(() => setBrands([]))
      .finally(() => setLoading(false));
  }, [session, status, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-[var(--muted-foreground)]">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Brand Dashboard</h1>
          <p className="text-[var(--muted-foreground)] mt-1">Manage your brand kits and challenges</p>
        </div>
        <Link href="/brand/new">
          <Button>+ New Brand</Button>
        </Link>
      </div>

      {brands.length === 0 ? (
        <Card className="text-center py-16">
          <CardContent>
            <p className="text-[var(--muted-foreground)] mb-4">
              No brands yet. Create your first brand kit to launch a challenge.
            </p>
            <Link href="/brand/new">
              <Button>Create Brand Kit</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {brands.map((brand) => (
            <Card key={brand.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {brand.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={brand.logoUrl}
                        alt={brand.name}
                        className="h-12 object-contain"
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
                  </div>
                </div>
              </CardHeader>
              {brand.challenges.length > 0 && (
                <CardContent>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        <th className="text-left py-2 font-medium text-[var(--muted-foreground)]">
                          Status
                        </th>
                        <th className="text-right py-2 font-medium text-[var(--muted-foreground)]">
                          Pool
                        </th>
                        <th className="text-right py-2 font-medium text-[var(--muted-foreground)]">
                          Players
                        </th>
                        <th className="text-right py-2 font-medium text-[var(--muted-foreground)]">
                          Ends
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {brand.challenges.map((c) => (
                        <tr key={c.id} className="border-b border-[var(--border)] last:border-0">
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
                          <td className="py-2 text-right">{formatUsdc(c.poolAmountUsdc)} USDC</td>
                          <td className="py-2 text-right">{c.participantCount}</td>
                          <td className="py-2 text-right text-[var(--muted-foreground)]">
                            {new Date(c.endsAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
