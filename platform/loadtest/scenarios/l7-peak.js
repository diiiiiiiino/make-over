// L7 — Meridian Day. 최종 관문.
//
//   docker compose run --rm k6 run -e RPS=2000 -e DURATION=30m /scripts/scenarios/l7-peak.js
//
// 실제 목표는 1.1M RPS다. 노트북에서 그 숫자를 만들 수는 없다.
// 대신 **인스턴스 1대의 한계 RPS를 측정하고 거기서 외삽한다.**
//
//   필요 인스턴스 수 = 1,100,000 / (인스턴스당 안전 RPS)
//   안전 RPS = SLO를 지키면서 처리한 RPS × 0.6   (헤드룸 40%)
//
// 이 계산과 그 가정의 한계를 문서로 쓰는 것이 PDP-9의 진짜 인수 조건이다.
import { pdpRequest, depsim } from "../lib/pdp.js";

const RPS = +(__ENV.RPS || 1000);

export const options = {
  scenarios: {
    peak: {
      executor: "ramping-arrival-rate",
      startRate: Math.round(RPS * 0.2), timeUnit: "1s",
      preAllocatedVUs: RPS, maxVUs: RPS * 10,
      stages: [
        { target: Math.round(RPS * 0.2), duration: "1m" },
        { target: RPS,                   duration: "3m" },   // 세일 시작
        { target: RPS,                   duration: __ENV.DURATION || "10m" },
        { target: Math.round(RPS * 0.2), duration: "2m" },
      ],
    },
  },
  thresholds: {
    "http_req_duration{name:pdp}": ["p(99)<120", "p(99.9)<350"],
    "http_req_failed": ["rate<0.0001"],   // 가용성 99.99%
  },
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "p(99.9)", "max"],
};

export function setup() { depsim("/admin/preset?name=meridian-day"); }
export function teardown() { depsim("/admin/reset"); }

export default function () { pdpRequest("realistic"); }
