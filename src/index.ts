import { Stagehand, StagehandNotInitializedError } from "@browserbasehq/stagehand";
import { endpointURLString } from "@cloudflare/playwright";
import { z } from "zod";

const MODEL = "google/gemini-3-flash-preview";
const MAX_INIT_ATTEMPTS = 3;

async function extractOnce(target: string, env: Env) {
	const stagehand = new Stagehand({
		env: "LOCAL",
		localBrowserLaunchOptions: { cdpUrl: endpointURLString(env.BROWSER) },
		modelName: MODEL,
		modelClientOptions: { apiKey: env.GOOGLE_API_KEY },
		verbose: 1,
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
		await stagehand.close();
	}
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const target =
			new URL(request.url).searchParams.get("url") ?? "https://simplepage.eth.link/";

		for (let attempt = 1; attempt <= MAX_INIT_ATTEMPTS; attempt++) {
			try {
				const extracted = await extractOnce(target, env);
				return Response.json({ ok: true, model: MODEL, target, extracted });
			} catch (err) {
				const isInitRace = err instanceof StagehandNotInitializedError;
				if (!isInitRace || attempt === MAX_INIT_ATTEMPTS) {
					return Response.json(
						{ ok: false, model: MODEL, target, error: String(err) },
						{ status: 500 },
					);
				}
				// connectOverCDP resolves before Playwright receives the CDP
				// target-attached event, so browser.contexts() can briefly be
				// empty; retrying with a fresh session clears it.
			}
		}

		// unreachable, satisfies TypeScript's control-flow analysis
		throw new Error("unreachable");
	},
} satisfies ExportedHandler<Env>;
