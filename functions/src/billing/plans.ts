import type { ModelId } from "./models";

export type PlanId = "free" | "basic" | "plus" | "power";

export const PLAN_IDS: readonly PlanId[] = ["free", "basic", "plus", "power"] as const;

export const PLAN_RANK: Record<PlanId, number> = {
  free: 0,
  basic: 1,
  plus: 2,
  power: 3,
};

export type PlanConfig = {
  defaultModel: ModelId;
  // Universe of models the router may pick for this plan. The mini-family
  // (mini, smart-mini) is additionally gated by the per-request `advanced`
  // flag and the monthly advanced credit cap.
  allowedModels: ModelId[];
  advancedMode: boolean;
  advancedMonthlyCreditCap: number;
  monthlyCredits: number;
  softDailyCredits: number;
  maxInputTokens: number;
  maxOutputTokens: number;
};

export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    defaultModel: "nano",
    allowedModels: ["nano"],
    advancedMode: false,
    advancedMonthlyCreditCap: 0,
    monthlyCredits: 200,
    softDailyCredits: 20,
    maxInputTokens: 4000,
    maxOutputTokens: 512,
  },
  basic: {
    defaultModel: "smart-nano",
    allowedModels: ["nano", "smart-nano"],
    advancedMode: false,
    advancedMonthlyCreditCap: 0,
    monthlyCredits: 1000,
    softDailyCredits: 100,
    maxInputTokens: 8000,
    maxOutputTokens: 1024,
  },
  plus: {
    defaultModel: "smart-nano",
    allowedModels: ["nano", "smart-nano", "mini", "smart-mini"],
    advancedMode: true,
    advancedMonthlyCreditCap: 500,
    monthlyCredits: 5000,
    softDailyCredits: 400,
    maxInputTokens: 16_000,
    maxOutputTokens: 2048,
  },
  power: {
    defaultModel: "smart-nano",
    allowedModels: ["nano", "smart-nano", "mini", "smart-mini"],
    advancedMode: true,
    advancedMonthlyCreditCap: 2000,
    monthlyCredits: 10_000,
    softDailyCredits: 1000,
    maxInputTokens: 32_000,
    maxOutputTokens: 4096,
  },
};
