import { ChangelogApiLive } from "@/lib/changelog-api";
import { apiToHandler } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const revalidate = 3600;

const { handler } = apiToHandler(ChangelogApiLive, "/api/changelog");

export { handler as GET };
