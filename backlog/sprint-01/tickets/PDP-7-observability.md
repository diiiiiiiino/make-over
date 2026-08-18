# [PDP-7] 관측성 — 메트릭 / 트레이싱 / 이벤트 로그 / 알람 / 런북

**타입**: Task ・ **SP**: 3 ・ **담당**: 나 ・ **요구자**: Diego Alvarez, 최민석

## 배경
Priya: *"새벽 3시에 이 로그만 보고 원인을 찾을 수 있나요? 못 찾으면 이 코드는 미완성입니다."*
DoD 항목이다. 이게 없으면 머지되지 않는다.

## 해야 할 일
### 메트릭 (Micrometer → Prometheus)
- `pdp_request_duration_seconds{marketplace,outcome}` (히스토그램, p50/p99/p99.9 산출 가능한 버킷)
- `pdp_dependency_duration_seconds{dependency,outcome}`
- `pdp_cache_access_total{layer,result}`
- `pdp_degraded_total{module}`
- `pdp_circuit_state{dependency}`
- `pdp_price_staleness_seconds`

### 트레이싱 (OpenTelemetry)
- 요청 하나가 5개 의존성으로 분기되는 것이 트레이스에 보일 것
- 샘플링: 정상 0.1%, 에러/느린 요청(> p99) 100%

### 로그
- JSON 구조화, 필수 필드: `timestamp, level, requestId, traceId, productId, marketplaceId, marketplace, degradedModules, cacheLayer, latencyMs`
- **PII·시크릿 로깅 금지** (Noah)
- 일 6.8PB 규모다. 로그 볼륨 예산을 고려해 레벨을 설계할 것

### 알람 + 런북
| 알람 | 조건 | Sev |
|---|---|---|
| PDP 가용성 | 5xx 비율 > 0.1%, 5분 | Sev-1 |
| PDP 지연 | p99 > 120ms, 10분 | Sev-2 |
| 캐시 히트율 | < 97%, 10분 | Sev-2 |
| 서킷 오픈 | 임의 의존성 서킷 오픈 5분 지속 | Sev-2 |
| 가격 신선도 | p99 > 5초 | Sev-2 |

## 인수 조건
- [ ] **AC1.** 위 메트릭이 모두 노출되고 Grafana 대시보드 정의(JSON)가 레포에 있다.
- [ ] **AC2.** 각 알람에 대응하는 런북 문서가 있고, **첫 3단계 조치**가 구체적으로 적혀 있다.
- [ ] **AC3.** 로그에 카드번호/이메일/주소/토큰이 절대 남지 않음을 테스트로 검증한다.
- [ ] **AC4.** 최민석의 3개 이벤트 스키마가 정확히 그대로 나온다. `requestId` 누락 시 CI 실패.
- [ ] **AC5.** 트레이스에서 "어떤 의존성이 느렸는가"를 30초 안에 판별할 수 있다. (Diego가 직접 시연 요구)
