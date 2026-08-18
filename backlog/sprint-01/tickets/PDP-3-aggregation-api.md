# [PDP-3] PDP 조립 API v1 — 병렬 fan-out과 부분 실패 처리

**타입**: Story ・ **SP**: 8 ・ **담당**: 나 ・ **요구자**: 서지훈, 이서연
**관련**: PRD-001 FR-1~FR-10, 상태 매트릭스 S1~S9
> ⚠️ 이 스프린트의 **핵심 티켓**. Tier-0 코드.

## 배경
현재 레거시 오케스트레이터는 의존성을 순차 호출한다. 배송 약속 서비스(p99 110ms)가 느려지면 상품명조차 안 나온다.
정유진(CS): *"'계속 로딩돼요' 문의가 지난 30일 4,830건입니다."*

## 해야 할 일
`GET /v1/marketplaces/{marketplaceId}/products/{productId}` 구현.

- 5개 의존성 **병렬** 호출: Catalog Core / Pricing / Inventory / Delivery Promise / Review Aggregate
- 의존성별 개별 타임아웃, 전체 요청 예산 200ms
- 상태 매트릭스 S1~S9 전부 구현
- `degradedModules[]`, `dataFreshness` 응답 필드
- 하드/소프트 디펜던시 구분: Catalog = 하드, 나머지 = 소프트

### 응답 스키마 초안 (확정은 PDP-8 OpenAPI에서)
```json
{
  "productId": "B0CX1234ZZ",
  "marketplaceId": "KR",
  "title": "…",
  "images": [ … ],
  "price": { "amount": 129000, "currency": "KRW", "listPrice": 159000 },
  "availability": "IN_STOCK | LOW_STOCK | OUT_OF_STOCK | UNKNOWN",
  "purchasable": true,
  "deliveryPromise": { "arrivesBy": "2026-08-20T23:59:59+09:00", "type": "PRIME_NEXT_DAY" },
  "reviewSummary": { "average": 4.3, "count": 1820 },
  "discontinued": false,
  "degradedModules": ["deliveryPromise"],
  "dataFreshness": { "price": { "ageMs": 1200, "stale": false } }
}
```

## 인수 조건 (AC) — 박하늘 검증 대상
- [ ] **AC1.** Given 5개 의존성 모두 정상, When 조회, Then 200 + `degradedModules`가 빈 배열.
- [ ] **AC2.** Given Catalog Core가 타임아웃, When 조회, Then **503** + 표준 에러 바디(내부 예외 메시지 노출 금지).
- [ ] **AC3.** Given Inventory가 타임아웃, When 조회, Then 200 + `availability: "UNKNOWN"` + `degradedModules`에 `"inventory"` 포함.
- [ ] **AC4.** Given Delivery Promise가 500, When 조회, Then 200 + `deliveryPromise: null` + degrade 표기. **응답 시간이 정상 대비 유의미하게 늘지 않는다** (실패를 기다리지 않는다).
- [ ] **AC5.** Given Pricing 실패 + 캐시 가격 나이가 임계값 이내, When 조회, Then 200 + 캐시 가격 + `dataFreshness.price.stale: true`.
- [ ] **AC6.** Given Pricing 실패 + 캐시 가격 나이가 임계값 초과, When 조회, Then 200 + `price: null` + `purchasable: false`.
- [ ] **AC7.** Given 존재하지 않는 productId, Then 404. Given 판매 종료 상품, Then 410 + `discontinued: true`.
- [ ] **AC8.** 5개 의존성이 각각 최대 지연으로 응답해도 **전체 응답이 200ms를 넘지 않는다** (병렬 증명).
- [ ] **AC9.** Testcontainers + WireMock으로 S1~S9 전 케이스 통합 테스트가 존재한다.
- [ ] **AC10.** 응답 어디에도 내부 식별자(셀러 정산 ID, 내부 벤더 코드), 스택트레이스가 포함되지 않는다. (Noah)

## 비기능 요구사항
| 항목 | 기준 |
|---|---|
| p99 | ≤ 120ms (캐시 히트 기준) |
| 전체 예산 | 200ms, 초과 시 부분 응답 반환 |
| 의존성 격리 | 서비스별 벌크헤드. 한 의존성 지연이 다른 호출을 굶기지 않을 것 |
| 스레드 안전 | 요청당 상태 공유 금지 |

## 관측성
- 메트릭: `pdp_request_duration_seconds{outcome}`, `pdp_degraded_total{module}`, `pdp_dependency_duration_seconds{dependency,outcome}`
- 로그: `requestId`, `productId`, `marketplaceId`, `degradedModules`, `cacheLayer` — JSON 구조화
- 이벤트: `pdp.render.completed`, `pdp.dependency.result` (최민석 스키마 준수)

## 명시적으로 정해지지 않은 것 (찾아서 물어볼 것)
1. 가격 stale 임계값 (PRD Q1) — **미확정**
2. `availability: UNKNOWN`일 때 `purchasable`은 true인가? (Q6)
3. 동일 요청에 대해 부분 실패한 응답을 캐시해도 되는가? ← **이걸 놓치면 장애가 난다**
4. `LOW_STOCK` 판단 기준(수량 임계값)은 누가 정하는가?
