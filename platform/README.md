# Meridian 로컬 플랫폼

> 사내 플랫폼팀이 제공하는 개발 환경입니다. Redis도, Kafka도, 관측 스택도, 부하 테스트
> 인프라도 이미 준비돼 있습니다. **당신이 만들 것은 `services/pdp-service` 하나입니다.**

---

## 왜 로컬에서 대용량을 배울 수 있는가

먼저 이것부터 짚고 갑니다. 노트북에서 1.1M RPS는 못 만듭니다. 그런데도 이 환경이 의미 있는 이유:

**대용량에서 겪는 문제의 본질은 "숫자가 크다"가 아니라 "자원이 한계에 부딪힌다"입니다.**

| 아마존 규모에서 일어나는 일 | 이 환경에서 재현하는 방법 |
|---|---|
| 꼬리 지연(p99.9) 폭발 | CPU 2코어로 묶고 부하를 올린다 |
| 캐시 스탬피드 | 핫키 시나리오(L3) + TTL 만료 |
| 오리진 과부하로 남의 팀 서비스 사망 | `capacityRps` 를 넘기면 depsim이 503을 뱉는다 |
| 재시도 폭풍 | 의존성을 죽이고(C4) 호출량 그래프를 본다 |
| 스레드풀 고갈 | Inventory를 500ms로 늘린다(L6) |
| 오토스케일링보다 빠른 트래픽 급증 | 90초에 6배 스파이크(L4) |
| 백프레셔 붕괴 | 처리량을 넘는 부하 + 큐 관찰 |

**재현되지 않는 것**도 정직하게 적어둡니다: 멀티리전 일관성, 셀/셔플 샤딩의 실제 효과,
수천 대 규모의 배포 안전성. 이건 코드가 아니라 **ADR과 설계 리뷰**로 훈련합니다.
Elena의 "트래픽 10배에서 어디가 먼저 깨집니까?"가 그 훈련입니다.

---

## 5분 만에 시작하기

```bash
make up          # 플랫폼 기동 (첫 실행은 이미지 받느라 2~3분)
make baseline    # 레거시에 부하를 걸어 "이겨야 할 숫자"를 만든다
make dash        # Grafana 에서 결과 확인
```

| 주소 | 무엇 |
|---|---|
| http://localhost:3000 | Grafana — PDP SLO 대시보드 |
| http://localhost:9090/alerts | Prometheus — SLO 알람 상태 |
| http://localhost:9001/admin | 의존 서비스 설정 조회·변경 |
| http://localhost:9000/catalog/B000000001 | 의존 서비스 직접 호출해보기 |
| http://localhost:8081 | 레거시 오케스트레이터 (비교 기준선) |
| http://localhost:8080 | **당신의 pdp-service** (아직 없음) |

---

## 첫날 과제

플랫폼 설명서를 다 읽기 전에, 이것부터 해보세요.

```bash
make up
make baseline
```

`make baseline`은 레거시 오케스트레이터에 200 RPS를 90초간 겁니다. 결과에서 이 줄을 찾으세요:

```
http_req_duration..............: p(99)=___ms  p(99.9)=___ms
```

**이 숫자를 적어두세요.** SLO는 p99 120ms, p99.9 350ms입니다. 레거시는 아마 두세 배쯤
초과할 겁니다. 이유는 `services/legacy-orchestrator/LegacyOrchestrator.java` 를 열면
바로 보입니다 — 다섯 번을 차례대로 기다립니다.

이어서 이걸 해보세요:

```bash
make chaos C=c2       # Delivery만 죽인다
curl -s http://localhost:8081/v1/marketplaces/KR/products/B000000001 -o /dev/null -w '%{http_code}\n'
```

`503`이 나옵니다. 배송 정보 하나 못 가져왔다고 **상품 페이지 전체가 죽습니다.**
이서연이 상태 매트릭스에서 말한 게 이겁니다. `make chaos C=reset` 으로 복구하세요.

---

## 무엇이 들어 있는가

```
platform/
├── docker-compose.yml       전체 스택 정의 (자원 제한 포함)
├── Makefile → 루트의 Makefile 참조
├── dependency-sim/          ★ 의존 서비스 5개 시뮬레이터 (고장낼 수 있음)
├── observability/
│   ├── prometheus/          스크레이프 설정 + SLO 기록·알람 규칙
│   └── grafana/             데이터소스 + PDP SLO 대시보드 (자동 프로비저닝)
├── loadtest/                k6 시나리오 L1~L7
└── chaos/gameday.sh         장애 주입 시나리오 C1~C7
```

자원 제한이 걸려 있습니다. **이 값을 늘려서 SLO를 맞추는 건 반칙입니다.**

| 컨테이너 | CPU | 메모리 | 왜 |
|---|---|---|---|
| pdp-service | 2 | 1g | 프로덕션 인스턴스 1대와 같은 조건 |
| dependency-sim | 2 | 512m | 남의 팀 서비스 |
| redis | 1 | 384m | maxmemory 256mb — 7.2억 SKU를 다 담을 수 없다 |
| k6 | 3 | 1g | 부하 생성기가 병목이면 측정이 거짓말을 한다 |

---

## dependency-sim — 이 환경의 심장

PDP가 호출해야 하는 5개 다운스트림을 흉내냅니다. 중요한 건 정상 동작이 아니라
**원할 때 고장낼 수 있다는 것**입니다.

### 호출

```
GET http://localhost:9000/{service}/{productId}?marketplaceId=KR
     service ∈ catalog | pricing | inventory | delivery | reviews
```

같은 productId는 언제나 같은 데이터를 돌려줍니다(FNV 해시 기반). DB가 필요 없습니다.

### 기본 설정 — `company/02-scale-and-traffic.md` 의 표 그대로

| 서비스 | base | tail(p99) | 에러율 | 용량(RPS) | 실패하면 |
|---|---|---|---|---|---|
| catalog | 8ms | 15ms | 0.01% | 12,000 | **하드 디펜던시** — 503 |
| pricing | 20ms | 40ms | 0.05% | 20,000 | 캐시 가격, stale 임계 초과 시 판매 중단 |
| inventory | 35ms | 65ms | 0.1% | 15,000 | `UNKNOWN` 으로 degrade |
| delivery | 60ms | 110ms | 0.1% | 8,000 | 필드 숨김 |
| reviews | 15ms | 30ms | 0.1% | 20,000 | 별점 숨김 |

> 직렬로 부르면 base 합계만 138ms입니다. p99를 합치면 260ms. **SLO 120ms는 병렬 호출
> 없이는 산술적으로 불가능합니다.** 이게 PDP-3의 출발점입니다.

### 고장내기

```bash
# 프리셋
curl -X POST "http://localhost:9001/admin/preset?name=inventory-down"
#   normal · meridian-day · inventory-down · delivery-error · pricing-slow
#   catalog-down · catalog-tight · brownout

# 개별 조정
curl -X POST "http://localhost:9001/admin/inventory?baseMs=500&tailMs=900"
curl -X POST "http://localhost:9001/admin/delivery?errorRate=0.5"
curl -X POST "http://localhost:9001/admin/catalog?timeoutRate=1.0"     # 30초 무응답
curl -X POST "http://localhost:9001/admin/catalog?capacityRps=2000"    # 용량 조이기
curl -X POST "http://localhost:9001/admin/reviews?enabled=false"       # 완전 사망

curl -X POST "http://localhost:9001/admin/reset"                       # 복구
curl -s     "http://localhost:9001/admin"                              # 현재 설정
```

### 용량 초과가 이 환경의 백미입니다

각 서비스에는 `capacityRps`가 있고, 넘기면 **먼저 느려지고 그다음 503을 뱉습니다.**

```
캐시 히트율 91% → 420 RPS × 9% × 5호출 = 189 RPS 가 오리진으로
캐시 히트율 0%  → 420 RPS × 5호출 = 2,100 RPS
capacityRps 2000 (make chaos C=tight) → 여기서 무너진다
```

Diego가 "캐시 히트율 98.5% 못 맞추면 우리가 Catalog Core를 죽입니다"라고 한 게
비유가 아니었다는 걸 그래프로 보게 됩니다.

---

## 매일 일하는 루프

```
아침   make up && make dash
       Claude에게 `스탠드업` → 팀이 진행 상황을 묻는다

작업   티켓 구현 → make load S=l1-steady → 숫자 확인
       숫자가 나빠졌으면 되돌린다. 나아졌으면 기록한다

오후   make chaos C=c1 → 폴백이 실제로 도는지 확인
       Claude에게 `코드 리뷰 요청` → Priya가 실제 코드를 읽고 지적한다

마무리 오늘의 p99 / 히트율 / 오리진 부하를 커밋 메시지나 이슈에 남긴다
       Claude에게 `QA 제출` 또는 `스프린트 리뷰`
```

**핵심은 "측정 → 변경 → 재측정"을 매일 반복하는 것입니다.** 숫자 없이 "빨라진 것 같다"는
이 회사에서 통하지 않습니다. Elena도, Priya도, Diego도 전부 숫자로 묻습니다.

---

## 런북

알람이 울렸을 때 무엇부터 볼 것인가. (당신이 PDP-7에서 이 문서를 확장하게 됩니다)

### PdpLatencyBreach — p99가 120ms를 넘었다

1. Grafana "의존 서비스 p99" 패널 — 특정 의존성이 느려졌는가?
2. "캐시 계층별 히트/미스" — 히트율이 떨어졌는가?
3. "오리진 부하 / 용량" — 오리진이 과부하인가?
4. 위 셋 다 정상이면 우리 서비스 내부다. GC, 스레드풀, 커넥션풀 순으로 본다.

### OriginOverloaded — 남의 팀 서비스를 죽이는 중

1. **즉시 완화**: 캐시 TTL을 늘리거나 부하 셰딩을 켠다. 원인 분석은 그다음이다.
2. 히트율이 왜 떨어졌는가 — 배포? 캐시 클러스터 장애? 트래픽 패턴 변화?
3. 재시도 폭풍이 원인인지 확인 — 호출량이 정상의 2배 이상이면 의심한다.

### CacheHitRatioLow — 히트율 98.5% 미만

1. Redis가 살아 있는가 (`docker logs meridian-redis`)
2. maxmemory 축출이 일어나고 있는가 (`redis-cli info stats | grep evicted`)
3. 캐시 키가 예상보다 잘게 쪼개졌는가 — 마켓플레이스/통화/회원등급을 다 넣으면 이렇게 된다

---

## 자주 겪는 문제

**k6 결과에 `dropped_iterations`가 있다**
부하 생성기가 목표 RPS를 못 만든 것입니다. 측정값이 무의미합니다. RPS를 낮추거나
k6 컨테이너 CPU를 늘리세요.

**Grafana 대시보드가 비어 있다**
`pdp-service`가 `/actuator/prometheus`를 열지 않았거나 메트릭 이름이 다릅니다.
http://localhost:9090/targets 에서 스크레이프 상태를 확인하세요.

**depsim이 병목인 것 같다**
Grafana "오리진 부하 / 용량"이 1.0에 붙어 있으면 시뮬레이터의 한계를 측정하고 있는
겁니다. `docker-compose.yml`에서 `dependency-sim`의 `WORKERS`와 `cpus`를 올리세요.
(이건 반칙이 아닙니다 — 측정 도구를 고치는 것이지 SLO를 깎는 게 아닙니다)

**포트가 이미 사용 중이다**
`make down` 후 다시. 그래도 안 되면 `docker ps`로 남은 컨테이너를 확인하세요.
