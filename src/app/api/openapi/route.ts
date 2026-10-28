import { NextResponse } from "next/server";
import { openApiSpec } from "@/server/openapi/spec";
export function GET() {
  return NextResponse.json(openApiSpec, { headers: { "Cache-Control": "public, max-age=300" } });
}
