// scripts/generate-brief.mjs
// Runs in GitHub Actions (Node 20+, global fetch available).
// Requires the GEMINI_API_KEY or ANTHROPIC_API_KEY environment variable (set as a repo secret).
// Fetches news via public Google News RSS, and uses Gemini to summarize it
// without using the restricted Google Search tool. This works completely free!

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("Missing API KEY environment variable (GEMINI_API_KEY or ANTHROPIC_API_KEY).");
  process.exit(1);
}

const MODEL = "gemini-3.5-flash";

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .trim();
}

async function fetchNews() {
  console.log("正在從 Google News RSS 抓取新聞來源...");
  const items = [];
  const urls = [
    "https://news.google.com/rss/search?q=vegan+OR+plant-based+market+trends&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=植物肉+OR+素食+OR+弘陽+OR+松珍+OR+大成&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const xml = await res.text();
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;
      while ((match = itemRegex.exec(xml)) !== null) {
        const content = match[1];
        const title = decodeHtmlEntities(content.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "");
        const link = content.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
        const pubDate = content.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
        items.push({ title, link, pubDate });
      }
    } catch (e) {
      console.error(`無法從 ${url} 抓取新聞：`, e.message);
    }
  }

  // Deduplicate
  const uniqueItems = [];
  const seen = new Set();
  for (const item of items) {
    if (!seen.has(item.title)) {
      seen.add(item.title);
      uniqueItems.push(item);
    }
  }
  console.log(`新聞抓取完成，共取得 ${uniqueItems.length} 則不重複的新聞項。`);
  return uniqueItems.slice(0, 80); // Limit to top 80 to prevent prompt bloat
}

async function callGemini(newsItems) {
  const prompt = `你是齋滋味（Vegan Select，台灣純素肉品外銷商，外銷澳洲/加拿大/美國/歐盟/新加坡/俄羅斯/香港）的產業情報分析師。
以下是從 Google News 抓取到的最新素食與植物肉相關新聞列表：
${JSON.stringify(newsItems, null, 2)}

請從中篩選出最相關的情報（最多 10 則），並進行整理與翻譯（未入選的新聞請直接忽略）。
特別涵蓋以下範圍：
1. 台灣市場（政策、通路、素食大廠：弘陽/HOYA、大成/Neo Foods、鈺統/三機、松珍）
2. 美國市場（關稅政策、競品動態、零售趨勢）
3. 澳洲市場
4. 歐洲市場（法規、通路）
5. 針對品牌「齋滋味」「齋之味」或「VeganSelect」的評論或討論（若新聞中完全沒有提及，請在 buzz 對應欄位中設為 found: false 並寫 "未偵測到提及"）

請依據篩選出的新聞，回傳符合以下格式的合法 JSON（不要加 markdown 代碼框、不要任何說明文字、不要在 JSON 前後加 any 文字）：
{
  "highlight": "一句話重點提醒，若無重大事件可留空字串",
  "entries": [
    {"region":"tw|us|au|eu","category":"policy|competitor|channel|trend|expo|incumbent|regulation","headline":"標題","summary":"40字內摘要","source":"媒體名稱","time":"發布時間，請填寫相對時間如：幾小時前或幾天前","url":"原文網址"}
  ],
  "recommendations": [
    {"trigger":"觸發的新聞重點","text":"具體建議"}
  ],
  "buzz": {
    "gyu": {"found": true或false, "summary":"偵測結果說明"},
    "veganselect": {"found": true或false, "summary":"偵測結果說明"}
  }
}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{ text: prompt }]
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
  const newsItems = await fetchNews();
  if (newsItems.length === 0) {
    throw new Error("未能抓取到任何 Google News 新聞項目，無法繼續生成報告。");
  }
  const data = await callGemini(newsItems);
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
