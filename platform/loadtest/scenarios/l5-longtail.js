// L5 — 롱테일. 하위 60% 상품도 합치면 하루 20억 조회다.
//
// 히트율이 낮은 구간만 골라서 때린다. 캐시 용량 정책(LRU / TTL / 무엇을 캐싱할지)이
// 여기서 드러난다. Redis maxmemory 256mb 안에서 무엇을 살리고 무엇을 버릴 것인가.
import { pdpRequest } from "../lib/pdp.js";

const RPS = +(__ENV.RPS || 250);

export const options = {
  scenarios: {
    longtail: {
      executor: "constant-arrival-rate",
      rate: RPS, timeUnit: "1s",
      duration: __ENV.DURATION || "4m",
      preAllocatedVUs: Math.max(50, RPS),
      maxVUs: Math.max(200, RPS * 4),
    },
  },
  thresholds: {
    "http_req_failed": ["rate<0.005"],
    "http_req_duration{name:pdp}": ["p(99)<400"],
  },
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "p(99.9)", "max"],
};

export default function () { pdpRequest("cold"); }
