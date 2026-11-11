import type { Metadata } from "next";
import { AdminApp } from "@/components/admin/AdminApp";

export const metadata: Metadata = {
  title: "Admin Console — ShortsPilot AI",
  description: "Backend control panel: users, subscriptions, plans & pricing, credits, AI pricing, jobs and integrations.",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminApp />;
}
