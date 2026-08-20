// L2 — 콜드 캐시. 배포 직후, 또는 Redis가 죽었다 살아난 직후의 상황.
//
// 모든 요청이 서로 다른 상품이라 캐시가 아무 도움이 안 된다.
// 이때 오리진(catalog capacityRps=12000)이 버티는지가 핵심이다.
// 캐시가 없는 구조라면 여기서 남의 팀 서비스를 죽인다.
import { pdpRequest } from "../lib/pdp.js";

const RPS = +(__ENV.RPS || 300);

export const options = {
  scenarios: {
    cold: {
      executor: "constant-arrival-rate",
      rate: RPS, timeUnit: "1s",
      duration: __ENV.DURATION || "2m",
      preAllocatedVUs: Math.max(50, RPS),
      maxVUs: Math.max(200, RPS * 4),
    },
  },
  // 콜드 상태에서는 p99 120ms를 지키기 어렵다. 대신 **오리진을 죽이지 않는 것**이 합격 조건이다.
  thresholds: {
    "http_req_failed": ["rate<0.01"],
    "http_req_duration{name:pdp}": ["p(99)<800"],
  },
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "p(99.9)", "max"],
};

export default function () { pdpRequest("cold"); }
