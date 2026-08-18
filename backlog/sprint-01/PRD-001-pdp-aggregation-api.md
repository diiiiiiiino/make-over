# PRD-001: PDP Aggregation API v1

| | |
|---|---|
| 작성자 | 서지훈 (Principal PM, PDP) |
| 상태 | **Approved** (Elena Volkov 문서 승인 2026-08-18 18:40) |
| 스프린트 | Sprint 1 (2026-08-18 ~ 2026-08-29) |
| 티어 | **Tier-0** |
| 관련 회의 | `meetings/2026-08-18-sprint-01-kickoff.md` |

---

## 1. 가상 보도자료 (Working Backwards)

> **메리디안, 상품 페이지 로딩 속도 3배 개선**
> *2026년 9월, 시애틀* — 메리디안은 오늘 전 세계 21개 마켓플레이스의 상품 상세 페이지 응답 속도를 대폭 개선했다고 밝혔다. 새로운 상품 정보 조립 시스템은 배송·재고·리뷰 등 여러 정보를 동시에 불러오며, 일부 정보가 지연되더라도 나머지를 먼저 보여준다. 고객은 더 이상 배송 정보 한 줄 때문에 빈 화면을 기다리지 않는다.
> 또한 재고 정보가 불확실할 때 "재고 있음"이라고 단정하는 대신 "재고 확인 중"으로 정직하게 표시한다. 메리디안 리테일 부문 관계자는 "주문 후 취소 통보만큼 고객 신뢰를 깎는 경험은 없다"고 말했다.

## 2. 고객 FAQ

**Q. 무엇이 달라지나요?**
A. 상품 페이지가 더 빨리 뜨고, 일부 정보가 늦더라도 상품 이름·가격·이미지는 먼저 보입니다.

**Q. "재고 확인 중"이라고 나오면 못 사는 건가요?**
A. 구매는 가능합니다. 다만 저희가 현재 재고를 100% 확신하지 못한다는 뜻이며, 그럴 때 확실하지 않은 정보를 보여드리지 않기로 했습니다.

## 3. 내부 FAQ

**Q. 왜 지금인가요?**
A. (1) PDP p99 340ms 구간의 전환율이 120ms 구간 대비 4.1% 낮음 → 연 $2.4B GMV 영향. (2) 재고 표시 오차 1.4% → 일 4만 건 취소. (3) 11월 Meridian Day에 1.1M RPS를 받아야 하는데 현재 아키텍처로는 불가능.

**Q. 레거시 오케스트레이터를 고치면 안 되나요?**
A. 순차 호출 구조가 근본 원인이고, 의존성이 코드에 하드코딩돼 있어 폴백을 넣을 지점이 없다. 부분 개선의 비용이 신규 작성보다 크다는 것이 Priya의 판단이다.

**Q. 안 하면?**
A. Meridian Day에 PDP가 무너진다. 작년 세일에서 이미 Sev-1이 2회 있었다.

## 4. 문제 정의 (데이터)

| 지표 | 현재 | Sprint 1 목표 |
|---|---|---|
| PDP p99 (서버) | 340ms | **≤ 120ms** |
| PDP p99.9 | 1,240ms | ≤ 350ms |
| 의존성 1개 장애 시 PDP 가용성 | 페이지 전체 실패 | **부분 degrade로 계속 서빙** |
| 재고 표시 오차율 | 1.4% | ≤ 0.8% (오탐을 "확인 중"으로 전환) |
| 캐시 히트율 | 91.2% | **≥ 98.5%** |
| 100만 요청당 비용 | $0.51 | ≤ $0.42 |

## 5. 범위

### In scope
- 단일 상품 PDP 조립 API: `GET /v1/marketplaces/{marketplaceId}/products/{productId}`
- 의존성 5개 통합: Catalog Core / Pricing / Inventory / Delivery Promise / Review Aggregate
- 2계층 캐시(L1 Caffeine + L2 Redis) 및 Kafka 기반 무효화
- 부분 실패 처리 및 `degradedModules` 응답 플래그
- 관측성(메트릭·트레이스·구조화 로그), 알람, 런북
- Gatling 부하 테스트 (평상시 420k RPS, 피크 1.1M RPS 시나리오)

### Out of scope (명시적으로 하지 않는다)
- Ads Service, Seller Profile 통합 → **Sprint 2**
- 다국어 번역 폴백, 통화 변환 정교화 → Sprint 2
- 프론트엔드 렌더링 (Storefront 팀 소관)
- 개인화(추천, 개인별 가격) → Sprint 3+
- 상품 등록/수정 API (쓰기 경로) — 이 팀 소관 아님

## 6. 요구사항

### 기능 요구사항 (FR)

| ID | 요구사항 | 우선순위 |
|---|---|---|
| FR-1 | 상품 ID와 마켓플레이스 ID로 PDP 조립 응답을 반환한다 | P0 |
| FR-2 | 의존 서비스를 **병렬** 호출하고 각각 개별 타임아웃을 적용한다 | P0 |
| FR-3 | Catalog Core 실패 시 `503` + 표준 에러 바디를 반환한다 (하드 디펜던시) | P0 |
| FR-4 | Pricing 실패 시, 캐시된 가격이 **stale 임계값 이내**면 그것을 쓰고, 넘으면 판매 불가 상태로 응답한다 | P0 |
| FR-5 | Inventory 실패/타임아웃 시 재고 상태를 `UNKNOWN`으로 내리고 `degradedModules`에 표기한다 | P0 |
| FR-6 | Delivery Promise 실패 시 해당 필드를 `null`로 두고 `degradedModules`에 표기한다 | P0 |
| FR-7 | Review Aggregate 실패 시 리뷰 요약을 `null`로 둔다 | P1 |
| FR-8 | 응답에 `degradedModules: string[]`과 `dataFreshness` 정보를 포함한다 | P0 |
| FR-9 | 존재하지 않거나 판매 중지된 상품은 `404` / `410`을 구분해 반환한다 | P1 |
| FR-10 | 응답은 마켓플레이스별 통화/언어/세금 표시 규칙을 따른다 | P1 |

### 비기능 요구사항 (NFR) — Diego Alvarez

| ID | 요구사항 | 측정 |
|---|---|---|
| NFR-1 | p50 ≤ 25ms, **p99 ≤ 120ms**, p99.9 ≤ 350ms | Gatling + 프로덕션 메트릭 |
| NFR-2 | 단일 인스턴스 최소 3,500 RPS 처리 (헤드룸 40% 확보) | 부하 테스트 |
| NFR-3 | 캐시 히트율 ≥ 98.5% (L1 + L2 합산) | 메트릭 |
| NFR-4 | 캐시 스탬피드 방지: 동일 키 동시 미스 시 오리진 호출 1회 | 부하 테스트로 증명 |
| NFR-5 | 전체 요청 예산 200ms. 개별 의존성 타임아웃 합이 이를 넘지 않게 병렬화 | 코드 리뷰 + 테스트 |
| NFR-6 | 의존성별 서킷브레이커 + 벌크헤드 격리 | 카오스 테스트 |
| NFR-7 | 의존성 1개가 100% 실패해도 PDP 가용성 ≥ 99.9% 유지 | 게임데이 |
| NFR-8 | 100만 요청당 비용 ≤ $0.42 | 비용 산정 문서 |
| NFR-9 | 무중단 배포, 자동 롤백 조건 설정 | 파이프라인 |
| NFR-10 | 가격 신선도 p99 ≤ 5초 (Kafka 무효화 지연 포함) | 메트릭 |

### 상태 매트릭스 — 이서연 (Design)

| # | 의존성 상태 | HTTP | 응답 처리 | 화면 |
|---|---|---|---|---|
| S1 | 전부 정상 | 200 | 전 필드 채움, `degradedModules: []` | 완전한 PDP |
| S2 | Catalog 실패 | 503 | 에러 바디 | 에러 페이지 + 재시도 버튼 |
| S3 | Pricing 실패 / stale ≤ 임계값 | 200 | 캐시 가격 + `dataFreshness.price.stale: true` | 정상 표시 |
| S4 | Pricing 실패 / stale > 임계값 | 200 | `purchasable: false`, price `null` | "일시적으로 구매 불가" |
| S5 | Inventory 실패 | 200 | `availability: "UNKNOWN"` | "재고 확인 중" 배지 |
| S6 | Delivery Promise 실패 | 200 | `deliveryPromise: null` | **배송 모듈 영역 자체를 제거** (스켈레톤 금지) |
| S7 | Review 실패 | 200 | `reviewSummary: null` | 별점 영역 숨김 |
| S8 | 상품 없음 | 404 | 표준 에러 | 404 페이지 |
| S9 | 판매 종료 | 410 | 기본 정보 + `discontinued: true` | "판매가 종료된 상품" + 대체 상품 |

> 이서연: "S6가 제일 중요합니다. 지금 CS 문의 1위가 '계속 로딩돼요'인데, 원인이 배송 모듈 무한 스켈레톤입니다."

## 7. 성공 지표 — 최민석

| 지표 | 정의 | 목표 | 도구 |
|---|---|---|---|
| PDP p99 | 서버 사이드 응답 시간 | ≤ 120ms | Prometheus |
| Degrade 비율 | `degradedModules`가 비어있지 않은 응답 비율 | ≤ 2% | 이벤트 로그 |
| 재고 오탐률 | "재고 있음" 표시 후 주문 취소 비율 | ≤ 0.8% | 주문 데이터 조인 |
| 캐시 히트율 | (L1+L2 히트)/전체 | ≥ 98.5% | Micrometer |
| PDP → 장바구니 전환율 | 실험군/대조군 비교 | +1.2% (95% 신뢰수준) | 실험 플랫폼 |

**필수 이벤트 스키마**
```json
{ "event": "pdp.render.completed", "requestId": "…", "productId": "…", "marketplaceId": "KR",
  "latencyMs": 42, "cacheLayer": "L1|L2|ORIGIN", "degradedModules": ["deliveryPromise"] }
{ "event": "pdp.dependency.result", "requestId": "…", "dependency": "inventory",
  "outcome": "OK|TIMEOUT|ERROR|CIRCUIT_OPEN|FALLBACK", "latencyMs": 68 }
{ "event": "pdp.price.staleness", "requestId": "…", "productId": "…", "priceAgeMs": 2400 }
```

## 8. 리스크와 미해결 질문

| # | 질문 | 담당 | 기한 | 상태 |
|---|---|---|---|---|
| Q1 | 가격 stale 허용 임계값은 몇 초인가? | 서지훈 + 법무 | 스프린트 3일차 | **미해결** |
| Q2 | 캐시 키 설계 (marketplaceId, 통화, 회원등급 포함 여부) — 카디널리티는? | **나** (ADR-001) | 3일차 | **미해결** |
| Q3 | 봇 트래픽(31%)에 별도 캐시/레이트리밋을 둘 것인가 | Diego | 5일차 | 미해결 |
| Q4 | Virtual Threads vs CompletableFuture — fan-out 동시성 모델 | **나** (ADR-001) | 3일차 | **미해결** |
| Q5 | L1 TTL이 짧으면 히트율이 떨어지고 길면 stale — 어디서 균형? | **나** (ADR-001) | 3일차 | **미해결** |
| Q6 | Inventory `UNKNOWN`일 때 장바구니 담기를 허용하는가 | 서지훈 + Aisha | 4일차 | 미해결 |

> **리스크 R1**: 2주 안에 NFR 전부 충족은 낙관적이다. Diego는 SLO를 양보하지 않으므로, 일정이 밀리면 **기능(FR-9, FR-10)을 자른다.**
> **리스크 R2**: Pricing 팀의 Kafka 토픽 스키마가 9월에 변경 예정. 계약 테스트로 방어할 것.

---

## Sprint 1 티켓 목록

| ID | 제목 | SP | 담당 |
|---|---|---|---|
| PDP-1 | ADR-001: 캐시 계층 및 fan-out 동시성 모델 결정 | 3 | **나** |
| PDP-2 | 프로젝트 스캐폴딩 (Gradle 멀티모듈, Spring Boot 3.4, Java 21) | 2 | **나** |
| PDP-3 | PDP 조립 API v1 — 병렬 fan-out과 부분 실패 처리 | 8 | **나** |
| PDP-4 | 의존 서비스 클라이언트 + Resilience4j (타임아웃/서킷브레이커/벌크헤드) | 5 | 김도현 |
| PDP-5 | 2계층 캐시(L1 Caffeine + L2 Redis) 및 스탬피드 방지 | 5 | **나** |
| PDP-6 | Kafka 캐시 무효화 컨슈머 (가격 신선도 5초) | 5 | 김도현 |
| PDP-7 | 관측성 — 메트릭/트레이싱/이벤트 로그/알람/런북 | 3 | **나** |
| PDP-8 | OpenAPI 3.1 스펙 + 계약 테스트(Pact) | 3 | 김도현 |
| PDP-9 | Gatling 부하 테스트 — 420k RPS 평상시 / 1.1M RPS 피크 | 5 | **나** |
| PDP-10 | 카오스 테스트 — 의존성별 장애 주입 및 폴백 검증 | 3 | 김도현 |

**나의 몫: 26 SP** — 팀 평균 개인 몫(8~10 SP)의 2배가 넘는다.
> 서지훈: "일단 다 올려놨습니다. 스프린트 플래닝에서 조정하시죠. 못 하겠으면 못 하겠다고 말씀하셔야 합니다."
> — **이것이 첫 번째 시험이다. 무엇을 잘라야 하는가?**
