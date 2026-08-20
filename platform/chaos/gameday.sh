#!/usr/bin/env bash
# gameday.sh — Diego가 던지는 장애 주입 시나리오 (PDP-10)
#
#   ./gameday.sh status          현재 의존 서비스 설정 보기
#   ./gameday.sh c1              Inventory 100% 타임아웃
#   ./gameday.sh reset           전부 정상으로 복구
#
# 각 시나리오를 건 다음 k6를 돌리고, Grafana에서 무슨 일이 벌어지는지 본다.
# 그리고 **알람이 실제로 울렸는지** 확인한다. 안 울렸으면 그건 관측성 결함이다.
set -euo pipefail

ADMIN="${DEPSIM_ADMIN:-http://localhost:9001}"

post() { curl -sS -X POST "${ADMIN}$1" > /dev/null && echo "  적용: $1"; }
say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

case "${1:-help}" in
  status)
    curl -sS "$ADMIN/admin" | python3 -m json.tool 2>/dev/null || curl -sS "$ADMIN/admin"
    ;;

  c1) say "C1 · Inventory 100% 타임아웃"
      echo "  기대: availability=UNKNOWN 으로 degrade, PDP 가용성 99.9% 유지"
      echo "  함정: 타임아웃을 안 걸었으면 여기서 스레드풀이 고갈된다"
      post "/admin/preset?name=inventory-down" ;;

  c2) say "C2 · Delivery Promise 100% 500 에러"
      echo "  기대: deliveryPromise=null, **응답 시간이 늘지 않을 것**"
      echo "  함정: 실패를 기다리면 p99가 그대로 올라간다"
      post "/admin/preset?name=delivery-error" ;;

  c3) say "C3 · Pricing 300ms 지연"
      echo "  기대: 캐시된 가격 사용 + stale 플래그"
      echo "  질문: stale 임계값을 넘으면 판매를 멈추는가?"
      post "/admin/preset?name=pricing-slow" ;;

  c4) say "C4 · Catalog Core 완전 다운"
      echo "  기대: 503 (하드 디펜던시). 단 재시도 폭풍을 만들지 말 것"
      echo "  확인: depsim 대시보드에서 catalog 호출량이 폭증하는가?"
      post "/admin/preset?name=catalog-down" ;;

  c5) say "C5 · Redis 클러스터 다운"
      echo "  기대: L1 + 오리진으로 degrade. 오리진 보호 장치가 동작할 것"
      echo "  주의: 이건 depsim이 아니라 Redis를 직접 멈춥니다"
      docker stop meridian-redis
      echo "  복구: docker start meridian-redis" ;;

  c6) say "C6 · Kafka(Redpanda) 정지 — 캐시 무효화 중단"
      echo "  기대: 서빙은 계속. 복구 후 랙을 따라잡을 것"
      echo "  질문: 가격이 몇 초까지 stale 해도 되는가?"
      docker stop meridian-redpanda
      echo "  복구: docker start meridian-redpanda" ;;

  c7) say "C7 · 전반적 열화 (brownout)"
      echo "  모든 의존성이 3배 느려지고 2% 에러. 가장 판단하기 어려운 상황이다"
      echo "  질문: 이때 서킷을 열어야 하는가, 참아야 하는가?"
      post "/admin/preset?name=brownout" ;;

  tight) say "오리진 용량 조이기 — Catalog capacityRps 12000 → 2000"
      echo "  캐시 히트율이 조금만 떨어져도 남의 팀이 죽는 상황을 만든다"
      post "/admin/preset?name=catalog-tight" ;;

  peak) say "Meridian Day — 모든 의존성이 느려진다"
      post "/admin/preset?name=meridian-day" ;;

  reset) say "전부 정상 복구"
      post "/admin/reset"
      docker start meridian-redis meridian-redpanda 2>/dev/null || true ;;

  *)
    cat <<'HELP'
사용법: ./gameday.sh <시나리오>

  status   현재 설정 조회
  c1       Inventory 타임아웃        c5   Redis 다운
  c2       Delivery 에러             c6   Kafka 정지
  c3       Pricing 지연              c7   전반적 열화
  c4       Catalog 다운              tight 오리진 용량 조이기
  peak     Meridian Day
  reset    전부 복구

개별 조정이 필요하면 관리 API를 직접 부르세요:
  curl -X POST "http://localhost:9001/admin/inventory?baseMs=500&errorRate=0.1"
HELP
    ;;
esac
