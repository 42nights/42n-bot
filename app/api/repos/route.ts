import { NextResponse } from "next/server";
import { botConfig } from "@/bot.config";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    repos: botConfig.repos,
    labels: botConfig.labels,
    verification: {
      maxIterations: botConfig.verification.maxIterations,
      diffMaxLines: botConfig.verification.diffMaxLines,
      criticMinConfidence: botConfig.verification.criticMinConfidence,
    },
    budgets: botConfig.budgets,
    reviewer: botConfig.reviewer,
    demoMode: botConfig.demoMode,
  });
}
