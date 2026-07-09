import { Stagehand, type LogLine } from "@browserbasehq/stagehand";
import { endpointURLString } from "@cloudflare/playwright";
import { z } from "zod";

const MODEL = "google/gemini-3-flash-preview";

function serializeError(err: unknown) {
	if (!(err instanceof Error)) return { message: String(err) };
	const chain = [];
	let current: unknown = err;
	while (current instanceof Error) {
		chain.push({
			name: current.name,
			message: current.message,
			stack: current.stack,
		});
		current = (current as { causedBy?: unknown; cause?: unknown }).causedBy ?? current.cause;
	}
	return { message: err.message, chain };
}

async function extractOnce(target: string, env: Env, logs: LogLine[]) {
	const stagehand = new Stagehand({
		env: "LOCAL",
		localBrowserLaunchOptions: { cdpUrl: endpointURLString(env.BROWSER) },
		modelName: MODEL,
		modelClientOptions: { apiKey: env.GOOGLE_API_KEY },
		verbose: 1,
		logger: (line) => {
			logs.push(line);
		},
	});

	try {
		await stagehand.init();
		const page = stagehand.page;
		await page.goto(target, { waitUntil: "domcontentloaded" });
		return await page.extract({
			instruction: "Extract the page's main heading and a one-sentence summary.",
			schema: z.object({ title: z.string(), summary: z.string() }),
		});
	} finally {
		// stagehand.close() itself throws StagehandNotInitializedError when
		// init() failed before setting up the browser context, which would
		// otherwise mask the real error from the try block above.
		await stagehand.close().catch(() => {});
	}
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/favicon.ico") {
			return new Response(null, { status: 404 });
		}

		const target = url.searchParams.get("url") ?? "https://simplepage.eth.link/";
		const logs: LogLine[] = [];

		try {
			const extracted = await extractOnce(target, env, logs);
			return Response.json({ ok: true, model: MODEL, target, extracted });
		} catch (err) {
			return Response.json(
				{ ok: false, model: MODEL, target, error: serializeError(err), logs },
				{ status: 500 },
			);
		}
	},
} satisfies ExportedHandler<Env>;
