// L4 — 스파이크. 광고 메일이 나가면 90초 만에 평상시의 6배가 들어온다.
//
// 오토스케일링은 2~3분이 걸린다. 즉 **지금 떠 있는 인스턴스로 버텨야 한다.**
// 헤드룸을 남겼는가, 큐가 무한정 길어지지 않는가, 부하 셰딩이 있는가를 본다.
import { pdpRequest } from "../lib/pdp.js";

const BASE = +(__ENV.RPS || 200);

export const options = {
  scenarios: {
    spike: {
      executor: "ramping-arrival-rate",
      startRate: BASE, timeUnit: "1s",
      preAllocatedVUs: BASE * 2,
      maxVUs: BASE * 20,
      stages: [
        { target: BASE,     duration: "60s" },  // 평온
        { target: BASE * 6, duration: "90s" },  // 메일 발송 — 90초 만에 6배
        { target: BASE * 6, duration: "90s" },  // 유지
        { target: BASE,     duration: "60s" },  // 회복
      ],
    },
  },
  thresholds: {
    "http_req_failed": ["rate<0.001"],
    "http_req_duration{name:pdp}": ["p(99)<350"],  // 스파이크 중에는 p99.9 기준으로 완화
  },
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "p(99.9)", "max"],
};

export default function () { pdpRequest("realistic"); }
