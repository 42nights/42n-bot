import { NextResponse } from "next/server";
import { appConfigured, appName, installUrl } from "@/src/github/app";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    configured: appConfigured(),
    appName: appName(),
    installUrl: installUrl(),
  });
}
