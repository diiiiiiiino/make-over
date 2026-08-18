# [PDP-1] ADR-001: 캐시 계층 및 fan-out 동시성 모델 결정

**타입**: Spike / Design ・ **SP**: 3 ・ **담당**: 나 ・ **요구자**: Priya Raghavan
**관련**: PRD-001 Q2, Q4, Q5

## 배경
Priya: *"코드보다 결정이 먼저입니다. 이 두 가지를 잘못 정하면 스프린트 2주가 아니라 분기 하나를 날립니다."*
PDP는 420k RPS(피크 1.1M)를 받으며 5개 의존성을 조립한다. 캐시 구조와 동시성 모델이 이 서비스의 성패를 결정한다.

## 해야 할 일
`templates/ADR-template.md` 형식으로 `docs/adr/ADR-001-cache-and-concurrency.md` 작성.

### 결정해야 할 항목
1. **캐시 키 설계** — 무엇을 키에 포함하는가? (productId / marketplaceId / 언어 / 통화 / 회원등급 / 디바이스)
   - 각 차원을 추가할 때 카디널리티가 몇 배가 되는지 **숫자로** 계산할 것. 7.2억 SKU × 21 마켓플레이스 = ?
   - Redis 24TB/리전 안에 들어가는가?
2. **L1(Caffeine) 설계** — 최대 엔트리 수, TTL, 축출 정책. 로컬 캐시가 stale일 때의 영향 범위.
3. **L2(Redis) 설계** — TTL, 샤딩 전략, 핫키 대응(클라이언트 사이드 복제? 키 분산?).
4. **스탬피드 방지** — single-flight / request coalescing / probabilistic early expiration 중 선택과 근거.
5. **fan-out 동시성 모델** — Java 21 Virtual Threads vs `CompletableFuture` + 전용 스레드풀 vs WebFlux.
   - 벌크헤드 격리를 어떻게 구현할 것인가.
   - 전체 예산 200ms를 5개 의존성에 어떻게 배분할 것인가.

## 인수 조건 (AC)
- [ ] **AC1.** 각 항목에 최소 2개 이상의 선택지를 비교하고, 선택하지 **않은** 이유를 적었다.
- [ ] **AC2.** 캐시 키 카디널리티와 예상 메모리 사용량을 숫자로 산출했다.
- [ ] **AC3.** 예상 p99를 의존성별 타임아웃 배분과 함께 계산해 제시했다.
- [ ] **AC4.** "트래픽 10배(11M RPS)에서 이 설계가 어디서 먼저 깨지는가"에 답했다. (Elena 필수 질문)
- [ ] **AC5.** 실패 모드 표를 작성했다 (캐시 클러스터 전체 장애 / 특정 샤드 장애 / L1-L2 불일치).
- [ ] **AC6.** Priya의 질문에 답했다: **"가격 캐시가 3분 stale인 상태에서 고객이 그 가격으로 주문하면 무슨 일이 일어나는가?"**
- [ ] **AC7.** Type 1(되돌릴 수 없음) / Type 2(되돌릴 수 있음) 판정을 명시했다.

## 완료 확인자
Priya Raghavan (필수), Elena Volkov (Tier-0 승인)
