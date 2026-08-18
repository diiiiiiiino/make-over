# 기술 스택 · 아키텍처 가이드

## 1. 확정 스택 (Java + Spring Boot)

| 영역 | 선택 | 비고 |
|---|---|---|
| 언어 | **Java 21 (LTS)** | Virtual Threads 사용 가능. Records, Pattern Matching, Sealed Types 적극 사용 |
| 프레임워크 | **Spring Boot 3.4** | Spring MVC + Virtual Threads (또는 필요 시 WebFlux) |
| 빌드 | **Gradle (Kotlin DSL)** | 멀티모듈 |
| API | REST + OpenAPI 3.1 (springdoc), 내부 통신은 gRPC 허용 | 계약 우선(contract-first) |
| 영속성 | Spring Data JPA (관리 데이터) / DynamoDB SDK (핫 경로 KV) | 핫 경로에 JPA 금지 |
| 캐시 | Caffeine(로컬 L1) + Redis Cluster(L2) | 2계층 필수 |
| 메시징 | Apache Kafka | 카탈로그/가격 변경 이벤트, CDC |
| 회복탄력성 | Resilience4j | CircuitBreaker / TimeLimiter / Bulkhead / RateLimiter |
| 관측성 | Micrometer + OpenTelemetry → Prometheus / Tempo / Loki | 구조화 로그(JSON) 필수 |
| 테스트 | JUnit 5, AssertJ, Mockito, **Testcontainers**, WireMock, Pact(계약 테스트) | |
| 부하 테스트 | **Gatling** (Java DSL) | Diego가 시나리오 승인 |
| 배포 | Docker → Kubernetes (EKS), Argo Rollouts 카나리 | 셀 기반 아키텍처 |

### 코딩 표준 (Priya가 리뷰에서 보는 것)
- 생성자 주입만. 필드 `@Autowired` 금지.
- 도메인 객체는 불변(record 또는 final 필드).
- `Optional`을 필드/파라미터로 쓰지 않는다. 반환 타입에만.
- **모든 외부 호출은 타임아웃 명시.** 기본값에 의존 금지.
- checked exception을 삼키지 않는다. 로그에 컨텍스트(productId, marketplaceId, requestId) 포함.
- 로그는 문자열 연결이 아닌 파라미터 방식. PII/시크릿 로깅 금지.
- 공개 API 변경은 하위 호환. 필드 삭제는 2단계 deprecation.

## 2. 서비스 아키텍처 (PDP)

```
                      ┌──────────────┐
   Client ──► CDN ──► │ API Gateway  │ ── 인증/레이트리밋/WAF
                      └──────┬───────┘
                             ▼
                  ┌──────────────────────┐
                  │  pdp-api (우리 서비스) │  Java 21 / Spring Boot
                  │  ┌────────────────┐  │
                  │  │ L1 Caffeine    │  │  ~20ms TTL, 핫키 흡수
                  │  ├────────────────┤  │
                  │  │ Aggregator     │  │  병렬 fan-out + 부분 실패 허용
                  │  └────────────────┘  │
                  └───┬───┬───┬───┬──────┘
          ┌───────────┘   │   │   └────────────┐
          ▼               ▼   ▼                ▼
   ┌────────────┐  ┌──────────────┐     ┌─────────────┐
   │ Redis L2   │  │ Catalog Core │ ... │ Ads Service │
   │ (Cluster)  │  │ Pricing      │     │ (best-effort)│
   └────────────┘  │ Inventory    │     └─────────────┘
                   │ DeliveryProm │
                   │ Reviews      │
                   └──────────────┘
          ▲
          │  Kafka: catalog.changed / price.changed  ──► 캐시 무효화 컨슈머
```

### 핵심 원칙
1. **Aggregation 계층은 얇고 빨라야 한다.** 비즈니스 로직은 각 도메인 서비스에.
2. **Fan-out은 병렬.** `CompletableFuture` 또는 structured concurrency. 전체 예산 200ms를 개별 호출에 배분.
3. **Tiered timeout**: 상위 요청 예산 > 하위 호출 타임아웃 합 ≠ 성립하므로, 병렬 + 개별 타임아웃 + 조기 반환.
4. **Cell-based architecture**: 리전 안에서도 트래픽을 셀(cell)로 나눠 장애 폭발 반경(blast radius)을 제한한다.
5. **Shuffle sharding**: 셀러/상품군을 셔플 샤딩해 특정 셀 장애가 특정 고객군 전체를 죽이지 않게.

## 3. 절대 규칙 (위반 시 PR 반려)

| # | 규칙 | 이유 |
|---|---|---|
| 1 | 핫 경로에 동기 DB 조인 금지 | 480TB 카탈로그 DB는 초당 42만 쿼리를 못 받는다 |
| 2 | 무제한 재시도 금지. 지수 백오프 + 지터 + 최대 시도 수 | 재시도 폭풍이 오리진을 죽인다 |
| 3 | 캐시 미스 시 thundering herd 방지 (single-flight / request coalescing) | 핫키 만료 순간 8만 RPS가 오리진으로 |
| 4 | 응답에 내부 식별자/원본 에러 메시지 노출 금지 | Noah 게이트 |
| 5 | 스레드풀을 의존 서비스별로 격리(bulkhead) | 한 서비스 지연이 전체를 마비시킨다 |
| 6 | 새 메트릭 없이 새 기능 없음 | 관측 불가 = 운영 불가 |
| 7 | 피처 플래그 없이 위험한 변경 금지 | 롤백이 배포보다 빨라야 한다 |

## 4. 예정된 모듈 구조

```
pdp-service/
├── build.gradle.kts
├── pdp-api/            # REST 컨트롤러, DTO, OpenAPI
├── pdp-domain/         # 도메인 모델, 순수 로직 (프레임워크 의존 없음)
├── pdp-aggregation/    # fan-out, 폴백, 조립 규칙
├── pdp-cache/          # L1/L2, 무효화 컨슈머
├── pdp-client/         # 의존 서비스 클라이언트 (Resilience4j 래핑)
├── pdp-infra/          # 설정, 관측성, 부트스트랩
└── pdp-loadtest/       # Gatling 시나리오
```

> 이 구조는 **제안**이다. 실제 확정은 내가 작성할 ADR-001에서 결정한다. Priya가 리뷰한다.
