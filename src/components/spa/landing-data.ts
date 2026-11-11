export type PublicPlan = {
  id: string;
  name: string;
  price: number;
  shortsLimit: number;
  channelsLimit: number;
  watermark: boolean;
  features: string[];
};

export const PLAN_FALLBACK: PublicPlan[] = [
  {
    id: "free_trial", name: "Free Trial", price: 0, shortsLimit: 3, channelsLimit: 1, watermark: true,
    features: ["3 generated Shorts", "1 channel", "Watermarked previews", "AI Studio access"],
  },
  {
    id: "starter", name: "Starter", price: 9, shortsLimit: 30, channelsLimit: 1, watermark: false,
    features: ["30 Shorts / month", "1 channel", "No watermark", "Scheduled publishing", "Email support"],
  },
  {
    id: "pro", name: "Pro", price: 24, shortsLimit: 100, channelsLimit: 3, watermark: false,
    features: ["100 Shorts / month", "3 channels", "No watermark", "Full automation mode", "Analytics dashboard", "Priority support"],
  },
  {
    id: "agency", name: "Agency", price: 59, shortsLimit: 300, channelsLimit: 10, watermark: false,
    features: ["300 Shorts / month", "10 channels", "No watermark", "Agency workspaces", "Usage & cost reporting", "Dedicated support"],
  },
];
