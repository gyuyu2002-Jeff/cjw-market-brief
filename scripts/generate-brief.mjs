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
請使用網頁搜尋功能，搜尋最近 24-48 小時內最新的植物性/素食食品產業消息，涵蓋以下範圍：
1. 台灣市場（政策、通路、素食大廠：弘陽/HOYA、大成/Neo Foods、鈺統/三機、松珍，以及本土食品安全/食安事件與新規範）
2. 美國市場（關稅政策、競品動態、零售趨勢）
3. 澳洲市場
4. 歐洲市場（法規、通路）
5. 針對品牌「齋滋味」「齋之味」或「VeganSelect」的評論或討論（搜尋論壇如 Dcard、PTT 等，若無提及請在 buzz 中設定為 found: false）

【常駐搜尋與分析指導】
- 請使用特定的搜尋指令，例如搜尋 \`site:foodnext.net\` (食力) 與 \`site:newsmarket.com.tw\` (上下游) 來獲取台灣高品質的素食與食安報導。
- 搜尋 \`plant-based meat tariff\` 或 \`植物肉 關稅\` 等關鍵字，常駐關注各國關稅及進口政策對外銷的影響。
- 篩選出的 10 則日報中，必須包含上述台灣大廠/本地報導至少 3 則。若有任何關稅變動新聞，必須優先錄用，並在建議中提供應對方針。

請依據搜尋結果，只能回傳合法 JSON，不要加 markdown 代碼框、不要任何說明文字、不要在 JSON 前後加 any 文字。格式如下：
{
  "briefing": {
    "title": "今日簡報大標題前段（例如：市場不缺新品，真正稀缺的是，約15字內，著重深刻洞察）",
    "title_highlight": "大標題尾端金色高亮關鍵詞（例如：回購理由，4-6字）",
    "subtitle": "今日簡報副標題（約40-50字，解釋大標題的背景與推論）",
    "card_title": "今日核心判讀標題（20字內，例如：價格、健康感與料理便利性共同決定回購）",
    "card_summary": "今日核心判讀說明摘要（約80-100字，說明跨市場共通訊號之研判）",
    "markets": "受影響市場清單，例如：台灣、美國、澳洲、歐洲"
  },
  "entries": [
    {"region":"tw|us|au|eu","category":"policy|competitor|channel|trend|expo|incumbent|regulation","headline":"標題","summary":"40字內摘要","source":"媒體名稱","time":"相對時間如：3小時前","url":"原文網址"}
  ],
  "recommendations": [
    {"trigger":"觸發的新聞重點或關稅變動","text":"具體外銷戰略建議"}
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
