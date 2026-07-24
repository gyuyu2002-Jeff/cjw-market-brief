// scripts/generate-brief.mjs
// Runs in GitHub Actions (Node 20+, global fetch available).
// Requires the ANTHROPIC_API_KEY environment variable (set as a repo secret).
// Calls the Anthropic API with the web_search tool, asks Claude to research
// today's plant-based / vegan food industry news, and writes the result to
// data/latest.json (plus an archived copy under data/history/).

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY environment variable.");
  process.exit(1);
}

const MODEL = "claude-3-7-sonnet-20250219";

const PROMPT = `你是齋滋味（Vegan Select，台灣純素肉品外銷商，外銷澳洲/加拿大/美國/歐盟/新加坡/俄羅斯/香港）的產業情報分析師。
請上網搜尋「今天」最新的植物性/素食食品產業消息，涵蓋以下範圍：
1. 台灣市場（政策、通路、素食大廠：弘陽/HOYA、大成/Neo Foods、鈺統/三機、松珍）
2. 美國市場（關稅政策、競品動態、零售趨勢）
3. 澳洲市場
4. 歐洲市場（法規、通路）
5. 是否有任何公開評論或討論提及品牌「齋滋味」「齋之味」或「VeganSelect」（Dcard、PTT、Google評論、蝦皮評價、Facebook、Threads、部落格等）

只能回傳合法 JSON，不要加 markdown 代碼框、不要任何說明文字、不要在 JSON 前後加任何文字。
entries 最多 10 則，recommendations 最多 5 則，全部使用繁體中文，格式如下：
{
  "highlight": "一句話重點提醒，若無重大事件可留空字串",
  "entries": [
    {"region":"tw|us|au|eu","category":"policy|competitor|channel|trend|expo|incumbent|regulation","headline":"標題","summary":"40字內摘要","source":"媒體名稱","time":"相對時間如：3小時前","url":"原文網址"}
  ],
  "recommendations": [
    {"trigger":"觸發的新聞重點","text":"具體建議"}
  ],
  "buzz": {
    "gyu": {"found": true或false, "summary":"偵測結果說明"},
    "veganselect": {"found": true或false, "summary":"偵測結果說明"}
  }
}`;

async function callClaude() {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: PROMPT }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 12 }]
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API 錯誤 (${res.status}): ${body}`);
  }

  const result = await res.json();
  const textBlock = (result.content || [])
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("\n");

  const cleaned = textBlock.replace(/```json/g, "").replace(/```/g, "").trim();

  let data;
  try {
    data = JSON.parse(cleaned);
  } catch (e) {
    console.error("原始回應內容：", textBlock);
    throw new Error("回傳內容無法解析為 JSON: " + e.message);
  }
  return data;
}

async function main() {
  console.log(`[${new Date().toISOString()}] 開始產生今日彙整…`);
  const data = await callClaude();
  data.generatedAt = new Date().toISOString();

  const rootDir = path.resolve(new URL(".", import.meta.url).pathname, "..");
  const dataDir = path.join(rootDir, "data");
  const historyDir = path.join(dataDir, "history");
  await mkdir(historyDir, { recursive: true });

  const json = JSON.stringify(data, null, 2);
  await writeFile(path.join(dataDir, "latest.json"), json, "utf-8");

  const dateStamp = data.generatedAt.slice(0, 10); // YYYY-MM-DD
  await writeFile(path.join(historyDir, `${dateStamp}.json`), json, "utf-8");

  console.log(`完成，共 ${(data.entries || []).length} 則情報、${(data.recommendations || []).length} 條建議。`);
}

main().catch(err => {
  console.error("執行失敗：", err);
  process.exit(1);
});
