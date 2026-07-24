// scripts/generate-brief.mjs
// Runs in GitHub Actions (Node 20+, global fetch available).
// Requires the GEMINI_API_KEY environment variable (set as a repo secret).
// Fetches news via public Google News RSS, and uses Gemini to summarize it
// without using the restricted Google Search tool. This works completely free!

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("Missing GEMINI_API_KEY environment variable.");
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
    // 美國/全球市場（植物肉與素食趨勢）
    "https://news.google.com/rss/search?q=vegan+OR+plant-based+market+trends&hl=en&gl=US&ceid=US:en",
    // 關稅與貿易政策（全球）
    "https://news.google.com/rss/search?q=plant-based+OR+vegan+tariff+OR+import+duty+OR+trade+policy&hl=en&gl=US&ceid=US:en",
    // 台灣與主要出口國的植物肉關稅、進口法規與政策
    "https://news.google.com/rss/search?q=植物肉+關稅+OR+進口稅+OR+法規+OR+貿易&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
    // 台灣市場（鎖定植物肉與產業關鍵字，排除一般食譜/餐廳雜訊）
    "https://news.google.com/rss/search?q=植物肉+OR+素肉+OR+植物蛋白&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
    // 台灣本土各大素食大廠動態
    "https://news.google.com/rss/search?q=弘陽+OR+松珍+OR+鈺統+OR+三機+OR+大成+植物肉&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
    // 台灣食力 Foodnext（指定關鍵字：植物肉/素食/食安）
    "https://news.google.com/rss/search?q=site:foodnext.net+(植物肉+OR+素食+OR+食安)&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
    // 台灣上下游 Newsmarket（指定關鍵字：植物肉/素食/食安）
    "https://news.google.com/rss/search?q=site:newsmarket.com.tw+(植物肉+OR+素食+OR+食安)&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
    // 品牌口碑關鍵字監測（齋滋味/齋之味/VeganSelect）
    "https://news.google.com/rss/search?q=" + encodeURIComponent('"齋滋味" OR "齋之味" OR "VeganSelect"') + "&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const xml = await res.text();
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;
      while ((match = 0, match = itemRegex.exec(xml)) !== null) {
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
  return uniqueItems.slice(0, 150); // Keep up to 150 items
}

async function callGemini(newsItems) {
  const prompt = `你是齋滋味（Vegan Select，台灣純素肉品外銷商，外銷澳洲/加拿大/美國/歐盟/新加坡/俄羅斯/香港）的產業情報分析師。
以下是從 Google News 抓取到的最新相關新聞與提及列表：
${JSON.stringify(newsItems, null, 2)}

請從中篩選出最相關的情報（最多 10 則），並進行整理與翻譯（未入選的新聞請直接忽略）。

【常駐關注重點與要求】
1. 關稅（tariffs / import duties）、進口法規與貿易政策對植物性食品外銷的影響。
2. 台灣市場的「食力 (Foodnext)」與「上下游 (Newsmarket)」這兩家專業媒體關於素食、植物肉、以及重要「食品安全（食安）」的深度報導。
3. 台灣本土素食大廠（弘陽、大成、松珍、鈺統/三機）的最新商業動態。
* 請確保篩選出的 10 則日報中，必須包含上述台灣本地報導或大廠動向至少 3 則。

【品牌口碑雷達監測】
* 請仔細檢查上述列表中是否有任何標題或內容提及了「齋滋味」、「齋之味」或「VeganSelect」。
* 如果有偵測到相關新聞或公開評論討論，請在 "buzz" 欄位中將對應品牌設為 "found": true，並在 "summary" 中摘要討論內容。
* 如果完全沒有提到，請設為 "found": false，並填寫 "未偵測到提及"。

請依據篩選出的新聞，回傳符合以下格式的合法 JSON（不要加 markdown 代碼框、不要任何說明文字、不要在 JSON 前後加 any 文字）：
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
    {"region":"tw|us|au|eu","category":"policy|competitor|channel|trend|expo|incumbent|regulation","headline":"標題","summary":"40字內摘要","source":"媒體名稱","time":"發布時間，請填寫相對時間如：幾小時前或幾天前","url":"原文網址"}
  ],
  "recommendations": [
    {"trigger":"觸發的新聞重點或關稅變動","text":"具體外銷戰略建議"}
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
