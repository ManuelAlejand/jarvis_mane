import { NextResponse, type NextRequest } from "next/server";
import { runExplorador } from "@/lib/trends";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Ejecución diaria del Explorador de tendencias (pg_cron, 8 a. m. Bogotá). Bearer WORKER_SECRET. */
async function handle(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.WORKER_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json(await runExplorador({ source: "cron" }));
}

export const POST = handle;
export const GET = handle;
