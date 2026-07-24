"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminUser {
  id: string;
  email: string;
  username: string | null;
  createdAt: string;
  suspendedAt: string | null;
  fraudScore: number;
  totalPayouts: string;
}

interface Pagination {
  pageSize: number;
  total: number;
  nextCursor: string | null;
}

type OrderBy = "createdAt" | "fraudScore";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const apiToken = (session as { apiToken?: string } | null)?.apiToken;
  const userRole = (session?.user as { role?: string } | undefined)?.role;

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    pageSize: 25,
    total: 0,
    nextCursor: null,
  });
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [minFraudScore, setMinFraudScore] = useState<string>("");
  const [minFraudScoreInput, setMinFraudScoreInput] = useState("");
  const [orderBy, setOrderBy] = useState<OrderBy>("createdAt");

  // Suspend dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"suspend" | "unsuspend">("suspend");
  const [dialogUserId, setDialogUserId] = useState("");
  const [dialogUserName, setDialogUserName] = useState("");
  const [dialogReason, setDialogReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ─── Auth guard ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (authStatus === "unauthenticated") {
      router.push("/login");
    } else if (authStatus === "authenticated" && userRole !== "admin") {
      router.push("/dashboard");
    }
  }, [authStatus, userRole, router]);

  // ─── Data loading ────────────────────────────────────────────────────────

  const loadUsers = useCallback(
    async (cursor?: string) => {
      if (!apiToken) return;
      setLoading(true);
      try {
        const api = createApiClient(apiToken);
        const params: Record<string, string | number> = { limit: 25 };
        if (cursor) params.cursor = cursor;
        if (minFraudScore.trim()) params.minFraudScore = minFraudScore.trim();
        if (orderBy) params.orderBy = orderBy;

        const res = await api.get("/admin/users", { params });
        setUsers(res.data.users);
        setPagination(res.data.pagination);
      } catch {
        setUsers([]);
      } finally {
        setLoading(false);
      }
    },
    [apiToken, minFraudScore, orderBy],
  );

  useEffect(() => {
    if (authStatus === "authenticated" && userRole === "admin") {
      setCursorStack([]);
      void loadUsers();
    }
  }, [loadUsers, authStatus, userRole]);

  // ─── Filter handler ──────────────────────────────────────────────────────

  function handleFilter(e: React.FormEvent) {
    e.preventDefault();
    setMinFraudScore(minFraudScoreInput);
  }

  // ─── Pagination handlers ──────────────────────────────────────────────────

  function handleNext() {
    if (pagination.nextCursor) {
      setCursorStack((prev) => [...prev, pagination.nextCursor!]);
      void loadUsers(pagination.nextCursor);
    }
  }

  function handlePrevious() {
    setCursorStack((prev) => {
      const next = [...prev];
      next.pop();
      const prevCursor = next[next.length - 1] ?? null;
      void loadUsers(prevCursor ?? undefined);
      return next;
    });
  }

  // ─── Dialog helpers ──────────────────────────────────────────────────────

  function openSuspendDialog(user: AdminUser) {
    setDialogMode("suspend");
    setDialogUserId(user.id);
    setDialogUserName(user.username || user.email);
    setDialogReason("");
    setDialogOpen(true);
  }

  function openUnsuspendDialog(user: AdminUser) {
    setDialogMode("unsuspend");
    setDialogUserId(user.id);
    setDialogUserName(user.username || user.email);
    setDialogReason("");
    setDialogOpen(true);
  }

  async function handleSubmitAction() {
    if (!apiToken) return;
    if (dialogMode === "suspend" && !dialogReason.trim()) return;

    setSubmitting(true);
    const api = createApiClient(apiToken);

    try {
      if (dialogMode === "suspend") {
        await api.patch(`/admin/users/${dialogUserId}/suspend`, {
          reason: dialogReason.trim(),
        });
      } else {
        await api.patch(`/admin/users/${dialogUserId}/unsuspend`);
      }
      setDialogOpen(false);
      const currentCursor = cursorStack[cursorStack.length - 1];
      await loadUsers(currentCursor);
    } catch {
      // Toast is handled by the API interceptor
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  if (authStatus === "loading" || (authStatus === "authenticated" && userRole !== "admin")) {
    return null;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">User Management</h1>
        <span className="text-sm text-gray-500">{pagination.total} users</span>
      </div>

      {/* Filter bar */}
      <Card className="mb-6">
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Label className="text-sm font-medium">Order by:</Label>
            {(["createdAt", "fraudScore"] as OrderBy[]).map((o) => (
              <Button
                key={o}
                variant={orderBy === o ? "default" : "outline"}
                size="sm"
                onClick={() => setOrderBy(o)}
              >
                {o === "createdAt" ? "Joined" : "Fraud Score"}
              </Button>
            ))}

            <div className="ml-4" />

            <form onSubmit={handleFilter} className="flex items-center gap-2">
              <Label className="text-sm font-medium whitespace-nowrap">Min Fraud Score:</Label>
              <Input
                type="number"
                min={0}
                placeholder="0"
                value={minFraudScoreInput}
                onChange={(e) => setMinFraudScoreInput(e.target.value)}
                className="w-24"
              />
              <Button type="submit" size="sm" variant="outline">
                Filter
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>

      {/* Users table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Users</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-500">Loading…</div>
          ) : users.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              No users found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs font-medium text-gray-500">
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Username</th>
                    <th className="px-4 py-3">Fraud Score</th>
                    <th className="px-4 py-3">Total Payouts</th>
                    <th className="px-4 py-3">Suspended at</th>
                    <th className="px-4 py-3">Joined</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr
                      key={user.id}
                      className="border-b hover:bg-gray-50"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{user.email}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {user.username ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={user.fraudScore > 0 ? "destructive" : "default"}>
                          {user.fraudScore}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {user.totalPayouts}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {user.suspendedAt
                          ? new Date(user.suspendedAt).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        {user.suspendedAt ? (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => openUnsuspendDialog(user)}
                          >
                            Unsuspend
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => openSuspendDialog(user)}
                          >
                            Suspend
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-gray-500">
          {pagination.total} users total
          {cursorStack.length > 0 && ` (page ${cursorStack.length + 1})`}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={cursorStack.length === 0}
            onClick={handlePrevious}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!pagination.nextCursor}
            onClick={handleNext}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Suspend / Unsuspend dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "suspend" ? "Suspend" : "Unsuspend"} user
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-600">
              {dialogMode === "suspend"
                ? `Suspending "${dialogUserName}" will block them from entering paid challenges. They will retain read-only access.`
                : `Unsuspending "${dialogUserName}" will restore full access.`}
            </p>
            {dialogMode === "suspend" && (
              <>
                <Label htmlFor="suspend-reason">
                  Suspension reason <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="suspend-reason"
                  placeholder="e.g. Suspected multi-accounting"
                  value={dialogReason}
                  onChange={(e) => setDialogReason(e.target.value)}
                />
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              variant={dialogMode === "suspend" ? "destructive" : "default"}
              onClick={handleSubmitAction}
              disabled={
                submitting ||
                (dialogMode === "suspend" && !dialogReason.trim())
              }
            >
              {submitting
                ? "Saving…"
                : dialogMode === "suspend"
                  ? "Suspend user"
                  : "Unsuspend user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
