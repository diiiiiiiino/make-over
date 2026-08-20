// L3 — 핫키. TV에 상품이 노출되면 단일 상품에 초당 8만 건이 몰린다.
//
// 트래픽의 40%가 상품 하나로 간다. 확인할 것:
//   1. 그 키의 TTL이 만료되는 순간 오리진 호출이 폭증하지 않는가 (스탬피드 방지)
//   2. Redis 단일 샤드가 병목이 되지 않는가
//   3. 오리진 호출량이 depsim 대시보드에서 튀지 않는가
import { pdpRequest, SLO_THRESHOLDS } from "../lib/pdp.js";

const RPS = +(__ENV.RPS || 600);

export const options = {
  scenarios: {
    hotkey: {
      executor: "constant-arrival-rate",
      rate: RPS, timeUnit: "1s",
      duration: __ENV.DURATION || "3m",
      preAllocatedVUs: Math.max(50, RPS),
      maxVUs: Math.max(200, RPS * 4),
    },
  },
  thresholds: SLO_THRESHOLDS,
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "p(99.9)", "max"],
};

export default function () { pdpRequest("hot-only"); }
