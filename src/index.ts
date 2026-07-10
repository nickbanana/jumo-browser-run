import "./als-shim";
import { Stagehand, type LogLine } from "@browserbasehq/stagehand";
import { endpointURLString } from "@cloudflare/playwright";
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

async function testStagehandV3(env: Env) {
	const cdpUrl = endpointURLString(env.BROWSER);
	const logs: LogLine[] = [];

	const stagehand = new Stagehand({
		env: "LOCAL",
		localBrowserLaunchOptions: {
			cdpUrl,
		},
		model: { modelName: MODEL, apiKey: env.GOOGLE_API_KEY },
		verbose: 1,
		logger: (line: LogLine) => {
			logs.push(line);
		},
	});

	try {
		await stagehand.init();
		const page = stagehand.context.activePage();
		if (!page) throw new Error("no active page after init()");
		await page.goto("https://simplepage.eth.link/", { waitUntil: "domcontentloaded" });
		const extracted = await stagehand.extract(
			"Extract the page's main heading and a one-sentence summary.",
			z.object({ title: z.string(), summary: z.string() }),
		);
		return { ok: true, extracted, logs };
	} finally {
		await stagehand.close().catch(() => {});
	}
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

		const result = await testStagehandV3(env).catch((err) => ({
			ok: false,
			error: serializeError(err),
		}));
		return Response.json(result);
	},
} satisfies ExportedHandler<Env>;
