require("dotenv").config();
const express = require("express");
const { Client, GatewayIntentBits } = require("discord.js");

const TOKEN = process.env.TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const COLLECTION_HANDLE = "one-man-tour-2026";
const PORT = process.env.PORT || 10000;

const app = express();
app.get("/", (req, res) => {
  res.status(200).send("higedan restock bot is running");
});
app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let lastAvailability = {};
let cachedProducts = null;
let cachedAt = 0;
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

async function getCollectionProducts() {
  const now = Date.now();

  // 1시간 캐시
  if (cachedProducts && now - cachedAt < 60 * 60 * 1000) {
    return cachedProducts;
  }

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

  cachedProducts = products;
  cachedAt = now;

  console.log(`컬렉션 상품 캐시 완료: ${products.length}개`);
  return products;
}

async function sendRestockMessage(channel, product, variant, isInitial = false) {
  const variantName =
    variant.title && variant.title !== "Default Title"
      ? ` - ${variant.title}`
      : "";

  const prefix = isInitial ? "🎉 재고 있음(초기 감지)!" : "🎉 재입고!";

  const message =
    `${prefix}\n` +
    `${product.title}${variantName}\n` +
    `https://higedan-store.jp/en/products/${product.handle}`;

  await channel.send(message);
}

async function checkRestock() {
  if (isRunning) {
    console.log("이전 작업이 아직 실행 중이라 이번 주기는 건너뜀");
    return;
  }

  isRunning = true;

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    const products = await getCollectionProducts();

    for (const product of products) {
      for (const variant of product.variants) {
        const key = String(variant.id);
        const currentAvailable = Boolean(variant.available);
        const prevAvailable = lastAvailability[key];

        // 서버 재시작 등으로 상태가 비어 있으면:
        // 현재 재고가 있는 경우 초기 감지 알림 발송
        if (prevAvailable === undefined) {
          if (currentAvailable === true) {
            await sendRestockMessage(channel, product, variant, true);
            console.log(`초기 재고 감지: ${product.title} - ${variant.title}`);
            await sleep(1500);
          }

          lastAvailability[key] = currentAvailable;
          continue;
        }

        // 품절(false) -> 재입고(true)
        if (prevAvailable === false && currentAvailable === true) {
          await sendRestockMessage(channel, product, variant, false);
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

client.once("clientReady", async () => {
  console.log(`로그인 완료: ${client.user.tag}`);

  await checkRestock();
  setInterval(checkRestock, 600000); // 10분
});

client.login(TOKEN).catch(err => {
  console.error("디스코드 로그인 실패:", err);
});