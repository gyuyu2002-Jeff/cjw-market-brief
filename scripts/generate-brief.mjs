// scripts/generate-brief.mjs
// Runs in GitHub Actions (Node 20+, global fetch available).
// Requires the GEMINI_API_KEY or ANTHROPIC_API_KEY environment variable (set as a repo secret).
// Calls the Gemini API with google_search_retrieval tool, asks Gemini to research
// today's plant-based / vegan food industry news, and writes the result to
// data/latest.json (plus an archived copy under data/history/).

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("Missing API KEY environment variable (GEMINI_API_KEY or ANTHROPIC_API_KEY).");
  process.exit(1);
}

const MODEL = "gemini-1.5-flash";

const PROMPT = `你是齋滋味（Vegan Select，台灣純素肉品外銷商，外銷澳洲/加拿大/美國/歐盟/新加坡/俄羅斯/香港）的產業情報分析師。
請上網搜尋最近 24-48 小時內最新的植物性/素食食品產業消息，涵蓋以下範圍：
1. 台灣市場（政策、通路、素食大廠：弘陽/HOYA、大成/Neo Foods、鈺統/三機、松珍）
2. 美國市場（關稅政策、競品動態、零售趨勢）
3. 澳洲市場
4. 歐洲市場（法規、通路）
5. 是否有任何公開評論或討論提及品牌「齋滋味」「齋之味」或「VeganSelect」（Dcard、PTT、Google評論、蝦皮評價、Facebook、Threads、部落格等）

請依據搜尋結果，只能回傳合法 JSON，格式如下（不要加 markdown 代碼框、不要任何說明文字、不要在 JSON 前後加任何文字）：
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

async function callGemini() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{ text: PROMPT }]
      }],
      tools: [{
        google_search_retrieval: {
          dynamic_retrieval_config: {
            mode: "MODE_DYNAMIC",
            dynamic_threshold: 0
          }
        }
      }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API 錯誤 (${res.status}): ${body}`);
  }

  const result = await res.json();
  const textBlock = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textBlock) {
    throw new Error("Gemini 回傳內容為空");
  }

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
  const data = await callGemini();
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
