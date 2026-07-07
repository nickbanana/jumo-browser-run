# jumo-browser-run

Spike：驗證 **Cloudflare Browser Run**（Workers Browser Rendering binding）搭配
**Stagehand v2.5.x** 與 **`google/gemini-3-flash-preview`** 是否能跑通瀏覽器擷取。

目的是評估用這條路取代 `jumo-link-fixer` 目前透過 Browserbase Functions
（外部服務）跑瀏覽器擷取的方式。

## 運作方式

`GET /` 會用 Browser Run binding 開瀏覽器連到目標頁面，透過 Stagehand 的
`page.extract()` 呼叫 Gemini 做結構化擷取（標題 + 一句話摘要）。

```
GET /                          # 預設抓 https://simplepage.eth.link/
GET /?url=https://example.com  # 指定要擷取的頁面
```

成功回應：

```json
{
  "ok": true,
  "model": "google/gemini-3-flash-preview",
  "target": "https://example.com",
  "extracted": { "title": "...", "summary": "..." }
}
```

失敗會回 `{ "ok": false, "error": "..." }`（HTTP 500）。

## 開發

```bash
npm install
npm run dev       # 本地啟動 Worker（需要 GOOGLE_API_KEY 在 .dev.vars）
npm run deploy    # 部署到 Cloudflare（Browser Rendering 需 Workers Paid plan）
npm run cf-typegen  # 修改 wrangler.jsonc 後重新產生 Env 型別
```

`.dev.vars` 需包含：

```
GOOGLE_API_KEY=...
```

## 關鍵設定

- `wrangler.jsonc`：`browser` binding（`BROWSER`）+ `alias.playwright` 指向
  `@cloudflare/playwright`（Stagehand 2.5.x 內部 import 的是 `playwright`，
  Workers runtime 需要導到 Cloudflare 的版本才能執行）。
- `src/index.ts`：Stagehand 用 v2.5.x 的設定形狀（`modelName` +
  `modelClientOptions.apiKey`，而非 v3 的 `model:` 物件），CDP 連線透過
  `endpointURLString(env.BROWSER)` 接 Browser binding。

> ⚠️ Cloudflare Browser Run 官方只支援 `@browserbasehq/stagehand` v2.5.x
> （v3+ 非 Playwright-based，不支援）。
