import { Stagehand } from "@browserbasehq/stagehand";
import { endpointURLString } from "@cloudflare/playwright";
import { z } from "zod";

const MODEL = "google/gemini-3-flash-preview";

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const target =
			new URL(request.url).searchParams.get("url") ?? "https://simplepage.eth.link/";

		const stagehand = new Stagehand({
			env: "LOCAL",
			localBrowserLaunchOptions: { cdpUrl: endpointURLString(env.BROWSER) },
			modelName: MODEL,
			modelClientOptions: { apiKey: env.GOOGLE_API_KEY },
			verbose: 1,
		});

		try {
			await stagehand.init();
			await stagehand.page.goto(target, { waitUntil: "domcontentloaded" });
			const extracted = await stagehand.page.extract({
				instruction: "Extract the page's main heading and a one-sentence summary.",
				schema: z.object({ title: z.string(), summary: z.string() }),
			});
			return Response.json({ ok: true, model: MODEL, target, extracted });
		} catch (err) {
			return Response.json(
				{ ok: false, model: MODEL, target, error: String(err) },
				{ status: 500 },
			);
		} finally {
			await stagehand.close();
		}
	},
} satisfies ExportedHandler<Env>;
