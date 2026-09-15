import "server-only";
import { type HttpApi, HttpApiBuilder, HttpServer } from "@effect/platform";
import { Effect, Layer, ManagedRuntime } from "effect";

export const EffectRuntime = ManagedRuntime.make(Layer.empty);

export function apiToHandler(
	api: Layer.Layer<HttpApi.Api>,
	staticGetPath?: string,
) {
	const web = HttpApiBuilder.toWebHandler(
		Layer.merge(api, HttpServer.layerContext),
		{
			middleware: (app) => app.pipe(Effect.tapErrorCause(Effect.logError)),
		},
	);
	return {
		handler: (request: Request) => {
			// Next's force-static Request proxy breaks native getters; static GETs need no request data.
			const input = staticGetPath
				? new Request(new URL(staticGetPath, "http://localhost"))
				: request;
			return web.handler(input);
		},
		dispose: web.dispose,
	};
}
