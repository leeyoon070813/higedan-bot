require("dotenv").config();
const express = require("express");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const PORT = process.env.PORT || 10000;

// 감시 대상 상품
const PRODUCTS = [157, 158, 159, 162, 163, 166];

// 6/20 (N), 6/21 (P)
const GROUP_KEYS = [
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
let lastState = {};
let isRunning = false;

// sleep
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 텔레그램 전송
async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: false
    })
  });

  if (!res.ok) {
    console.log(await res.text());
  }
}

// API 호출
async function fetchProduct(productId, groupKey) {
  const url = `https://thevault.bstage.in/svc/shop/api/v1/products/${productId}/options?inventoryItemGroupKey=${groupKey}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json"
    }
  });

  if (!res.ok) return null;

  return res.json();
}

// 재고 체크
async function checkStock() {
  if (isRunning) return;
  isRunning = true;

  try {
    for (const productId of PRODUCTS) {
      for (const group of GROUP_KEYS) {
        const data = await fetchProduct(productId, group.key);
        if (!data || !data.options) continue;

        const option = data.options[0];
	const out = option.outOfStock;
	const key = `${productId}_${group.key}`;

	console.log(productId, group.label, out);

        // 최초 상태 저장
        if (lastState[key] === undefined) {
          lastState[key] = out;
          continue;
        }

        // 품절(true) → 재입고(false)
        if (lastState[key] === true && out === false) {
          const msg =
`🎉 재입고 감지

상품: ${data.productName}
날짜: ${group.label}
https://thevault.bstage.in/shop/kr/products/${productId}`;

          await sendTelegram(msg);
          console.log("재입고:", productId, group.label);

          await sleep(1000);
        }

        lastState[key] = out;
      }
    }

    console.log("체크 완료");
  } catch (e) {
    console.log("에러:", e);
  } finally {
    isRunning = false;
  }
}

// 시작
async function start() {
  console.log("The Vault bot start");

  await checkStock();
  setInterval(checkStock, 180000); // 3분
}

start();