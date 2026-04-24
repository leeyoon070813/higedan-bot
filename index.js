require("dotenv").config();
const express = require("express");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const COLLECTION_HANDLE = "one-man-tour-2026";
const PORT = process.env.PORT || 10000;

const app = express();

app.get("/", (req, res) => {
  res.status(200).send("higedan telegram restock bot is running");
});

app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

let lastAvailability = {};
let isRunning = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, {
      ...options,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
        ...(options.headers || {})
      }
    });

    if (res.status !== 429) {
      return res;
    }

    const retryAfter = res.headers.get("retry-after");
    const waitMs = retryAfter
      ? Number(retryAfter) * 1000
      : Math.min(30000, 5000 * (attempt + 1));

    console.log(`429 발생: ${waitMs}ms 대기 후 재시도`);
    await sleep(waitMs);
  }

  throw new Error("429가 반복되어 요청 실패");
}

async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      disable_web_page_preview: false
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`텔레그램 전송 실패: ${res.status} ${errorText}`);
  }
}

async function getCollectionProducts() {
  let products = [];
  let page = 1;

  while (true) {
    const url = `https://higedan-store.jp/en/collections/${COLLECTION_HANDLE}/products.json?limit=250&page=${page}`;
    const res = await fetchWithRetry(url);

    if (!res.ok) {
      throw new Error(`컬렉션 조회 실패: ${res.status}`);
    }

    const data = await res.json();

    if (!data.products || data.products.length === 0) {
      break;
    }

    products = products.concat(data.products);
    page++;

    await sleep(3000);
  }

  console.log(`컬렉션 상품 새로 조회 완료: ${products.length}개`);
  return products;
}

async function sendRestockMessage(product, variant) {
  const variantName =
    variant.title && variant.title !== "Default Title"
      ? ` - ${variant.title}`
      : "";

  const message =
    `🎉 재입고!\n` +
    `${product.title}${variantName}\n` +
    `https://higedan-store.jp/en/products/${product.handle}`;

  await sendTelegramMessage(message);
}

async function checkRestock() {
  if (isRunning) {
    console.log("이전 작업이 아직 실행 중이라 이번 주기는 건너뜀");
    return;
  }

  isRunning = true;

  try {
    const products = await getCollectionProducts();

    for (const product of products) {
      for (const variant of product.variants) {
        const key = String(variant.id);
        const currentAvailable = Boolean(variant.available);
        const prevAvailable = lastAvailability[key];

        // 첫 실행은 기준값 저장만, 알림 안 보냄
        if (prevAvailable === undefined) {
          lastAvailability[key] = currentAvailable;
          continue;
        }

        // 품절 → 재입고만 알림
        if (prevAvailable === false && currentAvailable === true) {
          await sendRestockMessage(product, variant);
          console.log(`재입고 감지: ${product.title} - ${variant.title}`);
          await sleep(1500);
        }

        lastAvailability[key] = currentAvailable;
      }
    }

    console.log("재입고 확인 완료");
  } catch (e) {
    console.error("재입고 확인 에러:", e);
  } finally {
    isRunning = false;
  }
}

async function startBot() {
  console.log("텔레그램 재입고 봇 시작");

  await sendTelegramMessage("✅ 히게단 텔레그램 재입고 봇 정상 작동 중");

  await checkRestock();
  setInterval(checkRestock, 300000); // 5분
}

startBot();