import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

// Statically exported (this whole site is `output: "export"`), so this
// handler runs once at build time and its response is written to disk as a
// plain file — the desktop app's changelog page fetches it like any other
// static JSON endpoint. CHANGELOG.md at the repo root stays the one source of
// truth; this just republishes it where the app can reach it.
export const dynamic = "force-static";

export function GET() {
	const markdown = readFileSync(
		join(process.cwd(), "..", "..", "CHANGELOG.md"),
		"utf8",
	);
	return NextResponse.json({ markdown });
}
