import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import { cache } from "react";

const readChangelog = cache(() =>
	readFile(resolve(process.cwd(), "../../CHANGELOG.md"), "utf8"),
);

export const getChangelog = Effect.tryPromise(readChangelog);

export class Changelog extends Context.Tag("Changelog")<
	Changelog,
	{ readonly read: typeof getChangelog }
>() {}
export const ChangelogLive = Layer.succeed(Changelog, { read: getChangelog });
