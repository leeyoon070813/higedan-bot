require("dotenv").config();
const express = require("express");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const PORT = process.env.PORT || 10000;

// 감시 상품
const PRODUCTS = [157, 158, 159, 162, 163, 166];

// 세션 (6/20, 6/21)
const GROUPS = [
  { key: "01KTJEB74R10YM86EW4G97GX5N", label: "6/20" },
  { key: "01KTJEB74R10YM86EW4G97GX5P", label: "6/21" }
];

const app = express();

app.get("/", (req, res) => {
  res.status(200).send("The Vault restock bot running");
});

app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

// 상태 저장
const lastState = {};
let isRunning = false;

// sleep
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 텔레그램 전송
async function sendTelegram(text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        disable_web_page_preview: false
      })
    });

    if (!res.ok) {
      console.log("Telegram error:", await res.text());
    }
  } catch (e) {
    console.log("Telegram exception:", e.message);
  }
}

// API 호출
async function fetchProduct(productId, groupKey) {
  try {
    const url = `https://thevault.bstage.in/svc/shop/api/v1/products/${productId}/options?inventoryItemGroupKey=${groupKey}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json"
      }
    });

    if (!res.ok) return null;

    return await res.json();
  } catch (e) {
    return null;
  }
}

// 재고 체크
async function checkStock() {
  if (isRunning) return;
  isRunning = true;

  try {
    for (const productId of PRODUCTS) {
      for (const group of GROUPS) {
        const data = await fetchProduct(productId, group.key);
        if (!data || !data.options || !data.options[0]) continue;

        const out = data.options[0].outOfStock;
        const key = `${productId}_${group.key}`;

        // 최초 상태 저장
        if (lastState[key] === undefined) {
          lastState[key] = out;
          continue;
        }

        // 변화 로그 (필요할 때만)
        if (lastState[key] !== out) {
          console.log(`변화: ${productId} ${group.label} ${lastState[key]} → ${out}`);
        }

        // 품절(true) → 재입고(false)
        if (lastState[key] === true && out === false) {
          await sendTelegram(
`🎉 재입고 감지

상품ID: ${productId}
날짜: ${group.label}
https://thevault.bstage.in/shop/kr/products/${productId}`
          );

          console.log(`🔥 재입고: ${productId} (${group.label})`);

          await sleep(1000);
        }

        lastState[key] = out;
      }
    }

    console.log("체크 완료");
  } catch (e) {
    console.log("check error:", e.message);
  } finally {
    isRunning = false;
  }
}

// 시작
async function start() {
  console.log("The Vault bot start");

  // 즉시 1회 실행
  await checkStock();

  // 1분 주기
  setInterval(checkStock, 60000);
}

start();