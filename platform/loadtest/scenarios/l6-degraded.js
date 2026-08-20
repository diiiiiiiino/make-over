// L6 — 의존성 열화. Inventory 하나가 느려졌을 때 나머지가 멀쩡한가.
//
// 시작할 때 Inventory의 지연을 500ms로 주입하고, 끝나면 원복한다.
// 합격 조건: **Inventory 지연이 전체 응답시간을 끌고 가지 않는다.**
//   - 벌크헤드가 없으면 스레드풀이 Inventory 대기로 가득 차서 전부 느려진다
//   - 타임아웃이 없으면 500ms를 그대로 기다린다
//   - 폴백이 없으면 그냥 실패한다
import { pdpRequest, depsim } from "../lib/pdp.js";

const RPS = +(__ENV.RPS || 400);

export const options = {
  scenarios: {
    degraded: {
      executor: "constant-arrival-rate",
      rate: RPS, timeUnit: "1s",
      duration: __ENV.DURATION || "3m",
      preAllocatedVUs: Math.max(50, RPS),
      maxVUs: Math.max(200, RPS * 4),
    },
  },
  thresholds: {
    // 의존성 하나가 죽어도 SLO는 그대로다. 이게 이 시나리오의 전부다.
    "http_req_duration{name:pdp}": ["p(99)<120"],
    "http_req_failed": ["rate<0.001"],
  },
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "p(99.9)", "max"],
};

export function setup() {
  depsim("/admin/inventory?baseMs=500&tailMs=900");
  console.log("Inventory 지연 500ms 주입됨 — 이제 당신의 격리 설계를 봅니다");
}
export function teardown() { depsim("/admin/reset"); }

export default function () { pdpRequest("realistic"); }
