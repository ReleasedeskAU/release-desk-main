import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/api";
import { evaluateConnectorFieldCheck } from "@/lib/connectors/check-fields";
import { getConnectorTypeDef } from "@/lib/connectors/types";

/**
 * Check wizard fields. GitHub PATs are verified with GitHub here.
 * Never forwards secrets to the index engine. Do not log credentials.
 */
export async function POST(req: Request) {
  const { error } = await requireRole("editor");
  if (error) return error;

  const body = (await req.json()) as {
    type?: string;
    baseUrl?: string;
    credentials?: Record<string, string>;
    config?: Record<string, unknown>;
  };

  if (!body.type || !body.credentials) {
    return NextResponse.json({ error: "Type and credentials are required" }, { status: 400 });
  }

  const typeDef = getConnectorTypeDef(body.type);
  if (!typeDef?.available) {
    return NextResponse.json({ ok: false, message: "Connector type is not available yet" });
  }

  const result = await evaluateConnectorFieldCheck({
    type: body.type,
    baseUrl: body.baseUrl,
    credentials: body.credentials,
    config: body.config,
  });
  return NextResponse.json(result);
}
