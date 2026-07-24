# 齋滋味 產業情報中樞

每日自動彙整台灣／美國／澳洲／歐洲植物性食品市場情報，並生成行動建議與品牌口碑監測，供公司同仁瀏覽。

## 這個 repo 裡有什麼

```
index.html                     ← 網站本體（純靜態頁面）
assets/logo.jpg                ← 公司 LOGO
data/latest.json               ← 目前顯示在網站上的最新一份彙整資料
data/history/YYYY-MM-DD.json   ← 每日歷史存檔
scripts/generate-brief.mjs     ← 呼叫 Claude API 搜尋新聞並產生 JSON 的腳本
.github/workflows/daily-update.yml  ← 排程：每天自動執行上面的腳本並自動 commit
```

## 部署到 GitHub Pages（一次性設定）

1. 把這個資料夾整個推到你的 GitHub repo（例如 `cjw-market-intelligence`）。
2. 到 repo 的 **Settings → Pages**，Source 選擇 `Deploy from a branch`，Branch 選 `main` 、資料夾選 `/ (root)`，儲存。
   - 幾分鐘後就能透過 `https://<你的帳號>.github.io/<repo名稱>/` 瀏覽，公司同仁都能用這個網址看。

## 設定每日自動更新（一次性設定）

1. 準備一組 Anthropic API Key（在 [console.anthropic.com](https://console.anthropic.com) 建立，並確認帳號已開通 **Web search** 工具）。
2. 到 repo 的 **Settings → Secrets and variables → Actions → New repository secret**：
   - Name: `ANTHROPIC_API_KEY`
   - Value: 貼上你的 API Key
3. 完成。GitHub Actions 會依照 `.github/workflows/daily-update.yml` 裡設定的時間（預設每天 UTC 00:00，也就是台北時間早上 8 點）自動執行，搜尋當日新聞、更新 `data/latest.json`，並自動 commit + push，網站會自動顯示最新內容。

### 手動測試

不想等到明天，想馬上跑一次看看：到 repo 的 **Actions** 分頁 → 左側選 `每日彙整更新` → 右上角 `Run workflow` → 綠色按鈕點下去，等 1-2 分鐘看結果。

### 調整更新時間

打開 `.github/workflows/daily-update.yml`，修改這一行的 cron 時間（UTC 時區）：
```yaml
- cron: "0 0 * * *"   # 分 時 日 月 星期，此為每天 UTC 00:00
```

## 修改追蹤範圍 / 分類 / 語氣

打開 `scripts/generate-brief.mjs`，修改裡面的 `PROMPT` 常數即可，例如：
- 想再加入其他同業（例如鈺統/三機、松珍）的追蹤重點，直接寫進 prompt
- 想改變摘要語氣或字數限制，調整 prompt 裡的說明文字

改完後不需要重新部署，下次排程執行或手動 Run workflow 時就會套用新的 prompt。

## 注意事項

- API Key 請務必透過 **Secrets** 設定，不要直接寫進程式碼或 commit 進 repo，避免外流。
- 每次執行會用到少量 Anthropic API 額度（含幾次網頁搜尋），成本很低，但建議留意用量。
- AI 搜尋整理的內容建議仍由人工複核，尤其是關稅、法規等會影響決策的資訊。
- `data/history/` 會持續累積每日檔案，如果檔案數量太多，可以之後視需要清理舊檔。
