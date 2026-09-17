import { requireRole } from "@/lib/auth/api";
import { zodErrorResponse } from "@/lib/api-errors";
import { ASK_PUBLIC_UNAVAILABLE } from "@/lib/staffless/ask-copy";
import { askAgentNdjsonResponse } from "@/lib/staffless/ask-http";
import { checkAskRateLimit } from "@/lib/staffless/ask-rate-limit";
import { askBodySchema } from "@/lib/staffless/ask-schema";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Stream an Ask turn. Tool-calling agent on the server (PAT and OpenAI key never
 * go to the browser). Catalog tools cover count, breakdown, distinct values, and key lookup.
 */
export async function POST(req: Request) {
  const { user, error } = await requireRole("readonly");
  if (error || !user) return error ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let orgId: string | null | undefined;
  try {
    ({ orgId } = await auth());
  } catch {
    orgId = null;
  }
  const gate = await checkAskRateLimit({ userId: user.id, tenantId: orgId });
  if (!gate.allowed) {
    return NextResponse.json(
      { error: ASK_PUBLIC_UNAVAILABLE },
      {
        status: 429,
        headers: { "Retry-After": String(gate.retryAfterSec ?? 60) },
      }
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = askBodySchema.safeParse(json);
  if (!parsed.success) return zodErrorResponse(parsed.error);

  return askAgentNdjsonResponse({
    message: parsed.data.message,
    history: parsed.data.history ?? [],
    sessionId: parsed.data.sessionId,
  });
}
