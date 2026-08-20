/*
 * dependency-sim — Meridian 플랫폼팀이 제공하는 의존 서비스 시뮬레이터
 * ---------------------------------------------------------------------------
 * PDP가 호출해야 하는 5개 다운스트림(Catalog / Pricing / Inventory / Delivery /
 * Reviews)을 한 프로세스로 흉내낸다. 핵심 가치는 "정상 동작"이 아니라
 * **원할 때 고장낼 수 있다는 것**이다.
 *
 *   - 지연(base/tail), 에러율, 타임아웃율을 런타임에 주입
 *   - 서비스마다 용량(capacityRps)이 있고, 넘기면 503을 던진다
 *     → 캐시 히트율이 떨어지면 남의 팀 서비스를 죽인다는 걸 몸으로 배우는 장치
 *
 * 포트
 *   9000  서비스 트래픽   GET /{service}/{productId}?marketplaceId=KR
 *   9001  관리·관측       /admin, /metrics, /healthz   (primary 프로세스가 소유)
 *
 * 외부 의존성 없음. 메트릭은 Prometheus 텍스트 포맷을 직접 생성한다.
 */
"use strict";
const http = require("http");
const cluster = require("cluster");
const os = require("os");

const SERVICES = ["catalog", "pricing", "inventory", "delivery", "reviews"];
const PORT = +(process.env.PORT || 9000);
const ADMIN_PORT = +(process.env.ADMIN_PORT || 9001);
const WORKERS = +(process.env.WORKERS || Math.min(4, os.cpus().length));

/* ------------------------------------------------------------------ config */

const defaults = () => ({
  // 값의 근거는 company/02-scale-and-traffic.md 의 "의존 서비스와 그 현실" 표
  catalog:   { baseMs: 8,  tailMs: 15,  errorRate: 0.0001, timeoutRate: 0, capacityRps: 12000, enabled: true },
  pricing:   { baseMs: 20, tailMs: 40,  errorRate: 0.0005, timeoutRate: 0, capacityRps: 20000, enabled: true },
  inventory: { baseMs: 35, tailMs: 65,  errorRate: 0.001,  timeoutRate: 0, capacityRps: 15000, enabled: true },
  delivery:  { baseMs: 60, tailMs: 110, errorRate: 0.001,  timeoutRate: 0, capacityRps: 8000,  enabled: true },
  reviews:   { baseMs: 15, tailMs: 30,  errorRate: 0.001,  timeoutRate: 0, capacityRps: 20000, enabled: true },
});

const PRESETS = {
  "normal":         () => defaults(),
  "meridian-day":   () => { const c = defaults(); for (const s of SERVICES) { c[s].baseMs = Math.round(c[s].baseMs * 1.6); c[s].tailMs = Math.round(c[s].tailMs * 2.2); } return c; },
  "inventory-down": () => { const c = defaults(); c.inventory.timeoutRate = 1.0; return c; },
  "delivery-error": () => { const c = defaults(); c.delivery.errorRate = 1.0; return c; },
  "pricing-slow":   () => { const c = defaults(); c.pricing.baseMs = 300; c.pricing.tailMs = 800; return c; },
  "catalog-down":   () => { const c = defaults(); c.catalog.enabled = false; return c; },
  "catalog-tight":  () => { const c = defaults(); c.catalog.capacityRps = 2000; return c; },
  "brownout":       () => { const c = defaults(); for (const s of SERVICES) { c[s].baseMs *= 3; c[s].errorRate = 0.02; } return c; },
};

let cfg = defaults();

/* ----------------------------------------------------------------- metrics */

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.35, 0.5, 1, 2.5, 5, 10];

function newStats() {
  const s = {};
  for (const svc of SERVICES) {
    s[svc] = { outcomes: {}, hist: new Array(BUCKETS.length + 1).fill(0), sum: 0, count: 0, window: 0 };
  }
  return s;
}
let stats = newStats();

function observe(svc, outcome, seconds) {
  const s = stats[svc];
  s.outcomes[outcome] = (s.outcomes[outcome] || 0) + 1;
  s.sum += seconds;
  s.count++;
  let i = 0;
  while (i < BUCKETS.length && seconds > BUCKETS[i]) i++;
  s.hist[i]++;
}

function mergeStats(into, from) {
  for (const svc of SERVICES) {
    const a = into[svc], b = from[svc];
    for (const k in b.outcomes) a.outcomes[k] = (a.outcomes[k] || 0) + b.outcomes[k];
    for (let i = 0; i < a.hist.length; i++) a.hist[i] += b.hist[i];
    a.sum += b.sum; a.count += b.count; a.window += b.window;
  }
}

/* ---------------------------------------------------------------- payloads */

function h32(str) {                       // FNV-1a — 같은 productId면 언제나 같은 데이터
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const BRANDS = ["Aurex", "Northwind", "Kaito", "Vellum", "Orbital", "Pinewood", "Lumen"];
const CATS = ["Electronics", "Home", "Grocery", "Apparel", "Beauty", "Toys", "Sports"];
const CURRENCY = { KR: "KRW", JP: "JPY", DE: "EUR", FR: "EUR", IT: "EUR", UK: "GBP" };

function payload(svc, id, market) {
  const n = h32(id);
  switch (svc) {
    case "catalog":
      return { productId: id,
        title: `${BRANDS[n % BRANDS.length]} ${CATS[n % CATS.length]} ${100 + (n % 900)}`,
        brand: BRANDS[n % BRANDS.length], category: CATS[n % CATS.length].toLowerCase(),
        sellerId: "S" + String(n % 2200000).padStart(8, "0"),
        images: [`/i/${id}/main.jpg`, `/i/${id}/alt1.jpg`, `/i/${id}/alt2.jpg`],
        attributes: { weightGram: 100 + (n % 4000), origin: ["KR", "CN", "VN", "US", "DE"][n % 5] } };
    case "pricing": {
      const amount = 900 + (n % 150000);
      return { productId: id, marketplaceId: market, currency: CURRENCY[market] || "USD",
        amount, listPrice: amount + Math.floor(amount / 8), promotions: [],
        updatedAt: new Date().toISOString() };
    }
    case "inventory": {
      const q = n % 120;
      return { productId: id,
        availability: q === 0 ? "OUT_OF_STOCK" : q < 8 ? "LOW_STOCK" : "IN_STOCK",
        quantityBand: q, fulfillmentCenter: `FC-${market}-${String(n % 14).padStart(2, "0")}` };
    }
    case "delivery":
      return { productId: id,
        arrivesBy: new Date(Date.now() + (24 + (n % 48)) * 3600e3).toISOString(),
        type: ["PRIME_NEXT_DAY", "STANDARD", "SAME_DAY"][n % 3], cutoff: "23:00" };
    default:
      return { productId: id, average: Math.round((30 + (n % 20))) / 10, count: n % 24000,
        distribution: [n % 100, n % 80, n % 60, n % 300, n % 900] };
  }
}

/* ------------------------------------------------------- latency behaviour */

// 실제 서비스처럼 대부분은 빠르고 소수가 느리다. 평균이 아니라 꼬리가 문제다.
function sampleLatency(c) {
  const r = Math.random();
  if (r < 0.90) return c.baseMs * (0.8 + Math.random() * 0.4);
  if (r < 0.99) return c.baseMs * (1.5 + Math.random());
  return c.tailMs * (0.9 + Math.random() * 0.6);
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

/* ------------------------------------------------------------ worker: 트래픽 */

async function handleService(req, res, svc, id, market) {
  const t0 = process.hrtime.bigint();
  const done = (outcome) => observe(svc, outcome, Number(process.hrtime.bigint() - t0) / 1e9);
  const c = cfg[svc];

  stats[svc].window++;                                  // 이번 1초 창의 요청 수

  if (!c.enabled) {                                     // 완전 장애
    res.setHeader("Retry-After", "5");
    send(res, 503, { error: "service unavailable", service: svc });
    return done("unavailable");
  }
  if (c.capacityRps > 0 && stats[svc].window > c.capacityRps / WORKERS) {
    await sleep(c.baseMs * 3);                          // 과부하는 느려지기부터 한다
    res.setHeader("Retry-After", "1");
    send(res, 503, { error: "origin overloaded", service: svc, hint: "캐시 히트율을 확인하세요" });
    return done("overloaded");
  }
  if (c.timeoutRate > 0 && Math.random() < c.timeoutRate) {
    await sleep(30000);                                 // 호출자의 타임아웃 설정을 시험한다
    if (!res.writableEnded) send(res, 504, { error: "gateway timeout" });
    return done("timeout");
  }
  if (c.errorRate > 0 && Math.random() < c.errorRate) {
    await sleep(c.baseMs);
    send(res, 500, { error: "internal error", service: svc });
    return done("error");
  }

  await sleep(sampleLatency(c));
  send(res, 200, payload(svc, id, market));
  done("ok");
}

function workerMain() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 2 && SERVICES.includes(parts[0])) {
      return handleService(req, res, parts[0], parts[1], url.searchParams.get("marketplaceId") || "KR");
    }
    if (url.pathname === "/healthz") { res.writeHead(200); return res.end("ok"); }
    send(res, 404, { error: "not found", hint: "GET /{catalog|pricing|inventory|delivery|reviews}/{productId}" });
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  server.requestTimeout = 0;                            // 타임아웃 주입(30초)을 서버가 먼저 끊지 않게
  server.listen(PORT);

  process.on("message", (m) => { if (m.type === "cfg") cfg = m.cfg; });

  setInterval(() => {                                   // 델타를 primary로 올리고 리셋
    process.send({ type: "stats", stats });
    stats = newStats();
  }, 1000).unref();
}

/* ------------------------------------------------- primary: 설정 · 메트릭 집계 */

function primaryMain() {
  const total = newStats();          // 누적
  let lastWindow = {};               // 직전 1초 RPS
  for (const s of SERVICES) lastWindow[s] = 0;

  for (let i = 0; i < WORKERS; i++) cluster.fork();
  cluster.on("exit", (w) => { console.error(`[depsim] worker ${w.process.pid} 종료 — 재기동`); cluster.fork(); });
  cluster.on("online", (w) => w.send({ type: "cfg", cfg }));

  const pending = newStats();
  cluster.on("message", (_w, m) => { if (m && m.type === "stats") mergeStats(pending, m.stats); });

  setInterval(() => {
    for (const s of SERVICES) { lastWindow[s] = pending[s].window; pending[s].window = 0; }
    mergeStats(total, pending);
    for (const s of SERVICES) { pending[s] = newStats()[s]; }
  }, 1000);

  const broadcast = () => { for (const id in cluster.workers) cluster.workers[id].send({ type: "cfg", cfg }); };

  const admin = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname.replace(/\/+$/, "");

    if (p === "/healthz") { res.writeHead(200); return res.end("ok"); }
    if (p === "/metrics") return renderMetrics(res, total, lastWindow);
    if (p === "/admin" || p === "/admin/config") return send(res, 200, cfg);

    if (p === "/admin/reset") { cfg = defaults(); broadcast(); console.log("[admin] 기본값으로 되돌림"); return send(res, 200, { ok: true, config: cfg }); }

    if (p === "/admin/preset") {
      const name = url.searchParams.get("name");
      if (!PRESETS[name]) return send(res, 400, { error: "unknown preset", available: Object.keys(PRESETS) });
      cfg = PRESETS[name](); broadcast();
      console.log(`[admin] 프리셋 적용: ${name}`);
      return send(res, 200, { ok: true, preset: name, config: cfg });
    }

    const m = p.match(/^\/admin\/(\w+)$/);
    if (m && cfg[m[1]]) {
      const c = cfg[m[1]], q = url.searchParams;
      for (const k of ["baseMs", "tailMs", "capacityRps"]) if (q.has(k)) c[k] = parseInt(q.get(k), 10);
      for (const k of ["errorRate", "timeoutRate"]) if (q.has(k)) c[k] = parseFloat(q.get(k));
      if (q.has("enabled")) c.enabled = q.get("enabled") === "true" || q.get("enabled") === "1";
      broadcast();
      console.log(`[admin] ${m[1]} → ${JSON.stringify(c)}`);
      return send(res, 200, c);
    }
    send(res, 404, { error: "not found", hint: "GET /admin · POST /admin/{service}?baseMs=.. · POST /admin/preset?name=.." });
  });
  admin.listen(ADMIN_PORT);

  console.log(`[depsim] 서비스 :${PORT} (worker ${WORKERS}개) · 관리 :${ADMIN_PORT}`);
  console.log(`[depsim] 프리셋: ${Object.keys(PRESETS).join(", ")}`);
}

function renderMetrics(res, total, lastWindow) {
  const out = [];
  out.push("# HELP depsim_requests_total 의존 서비스별 요청 수", "# TYPE depsim_requests_total counter");
  for (const svc of SERVICES)
    for (const o in total[svc].outcomes)
      out.push(`depsim_requests_total{service="${svc}",outcome="${o}"} ${total[svc].outcomes[o]}`);

  out.push("# HELP depsim_request_duration_seconds 의존 서비스 응답 시간", "# TYPE depsim_request_duration_seconds histogram");
  for (const svc of SERVICES) {
    const s = total[svc];
    let cum = 0;
    for (let i = 0; i < BUCKETS.length; i++) { cum += s.hist[i]; out.push(`depsim_request_duration_seconds_bucket{service="${svc}",le="${BUCKETS[i]}"} ${cum}`); }
    cum += s.hist[BUCKETS.length];
    out.push(`depsim_request_duration_seconds_bucket{service="${svc}",le="+Inf"} ${cum}`);
    out.push(`depsim_request_duration_seconds_sum{service="${svc}"} ${s.sum.toFixed(6)}`);
    out.push(`depsim_request_duration_seconds_count{service="${svc}"} ${s.count}`);
  }
  out.push("# HELP depsim_capacity_rps 설정된 초당 처리 한도", "# TYPE depsim_capacity_rps gauge");
  for (const svc of SERVICES) out.push(`depsim_capacity_rps{service="${svc}"} ${cfg[svc].capacityRps}`);
  out.push("# HELP depsim_current_rps 직전 1초 동안 실제로 들어온 요청 수", "# TYPE depsim_current_rps gauge");
  for (const svc of SERVICES) out.push(`depsim_current_rps{service="${svc}"} ${lastWindow[svc] || 0}`);

  const body = out.join("\n") + "\n";
  res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

if (cluster.isPrimary) primaryMain(); else workerMain();
