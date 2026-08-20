# 부하 테스트 (k6)

```bash
# 기본 (pdp-service 대상)
docker compose --profile tools run --rm k6 run /scripts/scenarios/l1-steady.js

# 레거시를 때려서 기준선 만들기
docker compose --profile tools run --rm k6 run \
  -e TARGET=http://legacy:8080 -e RPS=200 /scripts/scenarios/l1-steady.js

# 결과를 Grafana로 흘려보내기
docker compose --profile tools run --rm k6 run \
  --out experimental-prometheus-rw /scripts/scenarios/l1-steady.js
```

| 시나리오 | 무엇을 보는가 | 합격 조건 |
|---|---|---|
| `l1-steady` | 기준선 | p50<25ms, p99<120ms, p99.9<350ms |
| `l2-cold` | 콜드 캐시에서 오리진을 죽이지 않는가 | 오리진 503 발생 0건 |
| `l3-hotkey` | 핫키 · 캐시 스탬피드 | 오리진 호출량이 튀지 않을 것 |
| `l4-spike` | 90초 만에 6배 | 에러율 < 0.1% |
| `l5-longtail` | 캐시 용량 정책 | 오리진 용량 이내 유지 |
| `l6-degraded` | 의존성 격리(벌크헤드) | **의존성 하나가 느려져도 p99<120ms** |
| `l7-peak` | Meridian Day · 용량 산정 | SLO 유지 + 인스턴스 수 산출 |

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `TARGET` | `http://pdp-service:8080` | 부하를 받을 서비스 |
| `RPS` | 시나리오별 | 초당 요청 수 |
| `DURATION` | 시나리오별 | 유지 시간 |
| `DEPSIM_ADMIN` | `http://dependency-sim:9001` | 장애 주입 대상 |

## 측정이 거짓말하지 않게 하는 법

1. **부하 생성기가 병목인지 먼저 확인한다.** k6 요약의 `dropped_iterations`가 0이 아니면
   목표 RPS를 만들지 못한 것이다. k6 컨테이너의 CPU를 늘리거나 RPS를 낮춘다.
2. **dependency-sim이 병목인지 확인한다.** Grafana의 "오리진 부하 / 용량" 패널이 1.0에
   붙어 있으면, 당신이 측정하는 건 당신 서비스가 아니라 시뮬레이터의 한계다.
3. **워밍업 구간을 결과에서 뺀다.** JIT 컴파일과 캐시 워밍 때문에 첫 30초는 항상 느리다.
4. **같은 조건에서 두 번 돌린다.** 한 번의 숫자는 근거가 되지 않는다.
