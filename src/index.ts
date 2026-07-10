import { Stagehand, type LogLine } from "@browserbasehq/stagehand";
import { z } from "zod";

const MODEL = "google/gemini-3-flash-preview";
const CLOUDFLARE_ACCOUNT_ID = "692696df11d629053d7b8f1cb2243ca0";

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
	const cdpUrl = `wss://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/browser-rendering/devtools/browser?keep_alive=60000`;

	const stagehand = new Stagehand({
		env: "LOCAL",
		localBrowserLaunchOptions: {
			cdpUrl,
			extraHTTPHeaders: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
		},
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

async function testDirectCdp(env: Env) {
	const cdpUrl = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/browser-rendering/devtools/browser?keep_alive=60000`;

	const response = await fetch(cdpUrl, {
		headers: {
			Upgrade: "websocket",
			Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
		},
	});

	if (!response.webSocket) {
		return {
			ok: false,
			stage: "upgrade",
			status: response.status,
			statusText: response.statusText,
			body: await response.text().catch(() => "<unreadable>"),
		};
	}

	const ws = response.webSocket;
	ws.accept();

	return await new Promise((resolve) => {
		const timeout = setTimeout(() => {
			resolve({ ok: false, stage: "cdp-roundtrip", error: "timed out waiting for CDP response" });
		}, 8000);

		ws.addEventListener("message", (event: MessageEvent) => {
			clearTimeout(timeout);
			ws.close();
			resolve({
				ok: true,
				stage: "cdp-roundtrip",
				message: typeof event.data === "string" ? event.data : "<binary frame>",
			});
		});

		ws.addEventListener("error", (event: Event) => {
			clearTimeout(timeout);
			resolve({ ok: false, stage: "cdp-roundtrip", error: String(event) });
		});

		ws.send(JSON.stringify({ id: 1, method: "Target.getBrowserContexts" }));
	});
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/favicon.ico") {
			return new Response(null, { status: 200 });
		}

		if (url.pathname === "/direct-cdp-test") {
			const result = await testDirectCdp(env).catch((err) => ({
				ok: false,
				stage: "exception",
				error: serializeError(err),
			}));
			return Response.json(result);
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
