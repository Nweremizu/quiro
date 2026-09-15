import "server-only";
import {
	HttpApi,
	HttpApiBuilder,
	HttpApiEndpoint,
	HttpApiError,
	HttpApiGroup,
} from "@effect/platform";
import { Effect, Layer, Schema } from "effect";
import { Changelog, ChangelogLive } from "./changelog";

class ChangelogGroup extends HttpApiGroup.make("changelog").add(
	HttpApiEndpoint.get("read", "/api/changelog")
		.addSuccess(Schema.Struct({ markdown: Schema.String }))
		.addError(HttpApiError.ServiceUnavailable),
) {}

class ChangelogApi extends HttpApi.make("QuiroApi").add(ChangelogGroup) {}

const ChangelogGroupLive = HttpApiBuilder.group(
	ChangelogApi,
	"changelog",
	(handlers) =>
		handlers.handle("read", () =>
			Effect.gen(function* () {
				const service = yield* Changelog;
				const markdown = yield* service.read.pipe(
					Effect.mapError(() => new HttpApiError.ServiceUnavailable()),
				);
				return { markdown };
			}),
		),
).pipe(Layer.provide(ChangelogLive));

export const ChangelogApiLive = HttpApiBuilder.api(ChangelogApi).pipe(
	Layer.provide(ChangelogGroupLive),
);
