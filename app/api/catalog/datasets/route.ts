import { type NextResponse } from "next/server";
import { catalogRoute } from "@/lib/catalogService/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Datasets registrados, sus campos y el estado del storage. */
export async function GET(): Promise<NextResponse> {
  return catalogRoute("/datasets", { method: "GET" });
}
