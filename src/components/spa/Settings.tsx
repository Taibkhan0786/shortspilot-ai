"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "./store";
import { api, toastError } from "./api";
import { SectionHeader } from "./common";
import { toast } from "sonner";
import { UserCog, KeyRound, Trash2, Loader2, AlertTriangle } from "lucide-react";

export function Settings() {
  const { user, profile, setSession, setView, setProfile } = useApp();
  const [name, setName] = useState(user?.name ?? "");
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [monthlyLimit, setMonthlyLimit] = useState(profile?.monthlyLimit ?? 50);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // refresh profile from server
    api.get("/api/v1/users/me")
      .then((d) => {
        const me = d as { user: { name: string }; profile?: { displayName?: string; monthlyLimit: number } };
        setName(me.user.name);
        if (me.profile) {
          setDisplayName(me.profile.displayName ?? "");
          setMonthlyLimit(me.profile.monthlyLimit ?? 50);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function saveProfile() {
    setBusy("profile");
    try {
      await api.patch("/api/v1/users/me", { name, profile: { displayName, monthlyLimit } });
      toast.success("Settings saved");
      const me = await api.get("/api/v1/auth/me");
      setSession(me as never);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function changePassword() {
    setBusy("password");
    try {
      await api.patch("/api/v1/users/me", { currentPassword, newPassword });
      toast.success("Password changed");
      setCurrentPassword("");
      setNewPassword("");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    setBusy("delete");
    try {
      await api.del("/api/v1/users/me");
      toast.success("Account and all data deleted");
      const me = await api.get("/api/v1/auth/me");
      setSession(me as never);
      setView("dashboard");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return null;

  return (
    <div className="max-w-2xl">
      <SectionHeader title="Account Settings" description="Profile, security and data controls." />

      <div className="space-y-6">
        <Card className="border-border/60">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><UserCog className="h-4 w-4 text-primary" /> Profile</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sname">Full name</Label>
                <Input id="sname" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dname">Creator display name</Label>
                <Input id="dname" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Shown on watermarks & reports" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cap">Monthly credit cap</Label>
              <Input id="cap" type="number" min={5} value={monthlyLimit} onChange={(e) => setMonthlyLimit(parseInt(e.target.value) || 50)} />
              <p className="text-xs text-muted-foreground">Hard stop for AI spending each calendar month.</p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Email: {user?.email}</p>
              <Button onClick={saveProfile} disabled={busy === "profile"}>
                {busy === "profile" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4 text-primary" /> Change password</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cpass">Current password</Label>
                <Input id="cpass" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="npass">New password</Label>
                <Input id="npass" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
              </div>
            </div>
            <Button onClick={changePassword} disabled={busy === "password" || !currentPassword || newPassword.length < 8}>
              {busy === "password" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Update password
            </Button>
          </CardContent>
        </Card>

        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertTriangle className="h-4 w-4" /> Danger zone
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Deleting your account permanently removes your channels, videos, ideas, credits and analytics. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <Input
                value={confirmDelete}
                onChange={(e) => setConfirmDelete(e.target.value)}
                placeholder="Type DELETE to confirm"
                className="max-w-56"
              />
              <Button variant="destructive" disabled={confirmDelete !== "DELETE" || busy === "delete"} onClick={deleteAccount}>
                {busy === "delete" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                Delete account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
