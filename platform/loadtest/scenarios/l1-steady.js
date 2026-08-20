// L1 — 정상 부하. 모든 측정의 기준선.
//
//   docker compose run --rm k6 run -e RPS=500 /scripts/scenarios/l1-steady.js
//
// 여기서 SLO를 못 지키면 나머지 시나리오는 볼 필요도 없다.
import { pdpRequest, SLO_THRESHOLDS } from "../lib/pdp.js";

const RPS = +(__ENV.RPS || 500);

export const options = {
  scenarios: {
    steady: {
      executor: "constant-arrival-rate",
      rate: RPS, timeUnit: "1s",
      duration: __ENV.DURATION || "3m",
      preAllocatedVUs: Math.max(50, RPS),
      maxVUs: Math.max(200, RPS * 4),
    },
  },
  thresholds: SLO_THRESHOLDS,
  summaryTrendStats: ["avg", "min", "med", "p(95)", "p(99)", "p(99.9)", "max"],
};

export default function () { pdpRequest("realistic"); }
