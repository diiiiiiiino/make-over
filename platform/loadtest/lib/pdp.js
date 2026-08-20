// k6 공통 라이브러리 — 트래픽 모양을 결정한다.
//
// 부하 테스트의 정확성은 RPS 숫자가 아니라 **요청 분포**에서 나온다.
// 모든 요청이 서로 다른 상품이면 캐시는 무용지물이고,
// 모두 같은 상품이면 캐시는 마법처럼 보인다. 둘 다 거짓말이다.
import http from "k6/http";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

export const TARGET = __ENV.TARGET || "http://pdp-service:8080";
export const DEPSIM_ADMIN = __ENV.DEPSIM_ADMIN || "http://dependency-sim:9001";

export const degraded = new Counter("pdp_degraded_responses");
export const okRate = new Rate("pdp_ok_rate");
export const assembleTime = new Trend("pdp_assemble_ms", true);

// 마켓플레이스 가중치 — 트래픽의 절반 이상이 상위 3개국에서 온다
const MARKETS = [
  ["US", 0.34], ["KR", 0.18], ["JP", 0.14], ["DE", 0.10],
  ["UK", 0.08], ["IN", 0.08], ["FR", 0.05], ["IT", 0.03],
];

export function pickMarket() {
  let r = Math.random();
  for (const [m, w] of MARKETS) { r -= w; if (r <= 0) return m; }
  return "US";
}

function pid(n) { return "B0" + String(n).padStart(8, "0"); }

// 실제 카탈로그 트래픽의 모양:
//   상위 0.1%(hot) 가 조회의 38%,  다음 5%(warm) 가 30%,  나머지 롱테일이 32%
export function pickProduct(profile) {
  const r = Math.random();
  switch (profile) {
    case "hot-only":                       // L3: 단일 상품에 트래픽 집중
      return r < 0.4 ? pid(1) : pid(Math.floor(Math.random() * 2000));
    case "cold":                           // L2/L5: 매번 새로운 상품 → 캐시 미스
      return pid(Math.floor(Math.random() * 50000000));
    case "realistic":                      // 기본
    default:
      if (r < 0.38) return pid(Math.floor(Math.random() * 500));            // hot
      if (r < 0.68) return pid(500 + Math.floor(Math.random() * 20000));    // warm
      return pid(Math.floor(Math.random() * 5000000));                      // long tail
  }
}

export function pdpRequest(profile) {
  const id = pickProduct(profile);
  const market = pickMarket();
  const res = http.get(`${TARGET}/v1/marketplaces/${market}/products/${id}`, {
    tags: { name: "pdp" },
    headers: { "Accept": "application/json", "X-Request-Id": `${__VU}-${__ITER}` },
  });

  const ok = check(res, {
    "status 200": (r) => r.status === 200,
    "본문에 productId 존재": (r) => r.status === 200 && String(r.body).includes("productId"),
  });
  okRate.add(ok);
  assembleTime.add(res.timings.duration);

  // 부분 실패로 응답했는지 — 이건 실패가 아니라 설계된 동작이다
  if (res.status === 200 && String(res.body).includes('"degradedModules":[') &&
      !String(res.body).includes('"degradedModules":[]')) {
    degraded.add(1);
  }
  return res;
}

// PRD-001 / NFR-1 그대로. 이 문턱을 넘으면 k6가 실패로 종료한다.
export const SLO_THRESHOLDS = {
  "http_req_duration{name:pdp}": ["p(50)<25", "p(99)<120", "p(99.9)<350"],
  "http_req_failed": ["rate<0.001"],
  "pdp_ok_rate": ["rate>0.999"],
};

// dependency-sim 관리 API 호출 (setup/teardown 에서 장애를 주입할 때)
export function depsim(path) {
  const res = http.post(`${DEPSIM_ADMIN}${path}`);
  console.log(`[depsim] POST ${path} -> ${res.status}`);
  return res;
}
