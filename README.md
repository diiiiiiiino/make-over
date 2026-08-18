# Meridian — 가상 이커머스 회사 시뮬레이션

> **아마존 규모의 가상 이커머스 회사에서, 당신은 백엔드 개발자다.**
> 대표·기획자·디자이너·SRE·QA·CS·물류 담당자가 실제처럼 요구사항을 내고, 당신은 그것을 구현한다.
> 트래픽 가정도 실제 규모다 — 평상시 420k RPS, 피크 1.1M RPS.

## 이게 뭔가요

가상 회사 **Meridian**(21개국 마켓플레이스, 7.2억 SKU, 연 GMV $610B)의 **Product Detail Platform 팀** 소속 SDE II로 일하는 롤플레이 개발 시뮬레이션입니다.

- **당신** = 개발자. 요구사항을 읽고, 질문하고, 반론하고, 직접 구현한다.
- **Claude** = 나머지 전원. CEO 한지우, PM 서지훈, 디자이너 이서연, Principal Engineer Priya, SRE Diego, QA 박하늘, CS 정유진 … 이들이 요구사항을 내고 리뷰하고 장애를 터뜨린다.

기술 스택은 **Java 21 + Spring Boot 3.4**로 확정돼 있습니다.

## 시작하기

```
1. company/05-simulation-guide.md   ← 먼저 읽으세요. 진행 명령어가 있습니다
2. company/02-scale-and-traffic.md  ← 모든 설계의 전제. 이 숫자가 난이도입니다
3. meetings/2026-08-18-sprint-01-kickoff.md  ← Sprint 1이 여기서 시작됐습니다
4. backlog/sprint-01/PRD-001-pdp-aggregation-api.md
5. GitHub Issues에서 티켓을 가져가세요
```

그리고 대화창에 이렇게 말하면 됩니다:

```
스탠드업
서지훈에게 질문: 가격 stale 임계값이 몇 초인가요?
코드 리뷰 요청
장애 발생
```

## 문서 구조

```
company/          회사 설정 — 조직, 사람, 트래픽 가정, 아키텍처, 프로세스
  00-company-overview.md      회사 개요, 리더십 원칙, 문화
  01-org-and-people.md        ⭐ 구성원 페르소나 카드 (누가 무엇을 요구하는가)
  02-scale-and-traffic.md     ⭐ 트래픽·SLO·비용 제약 (모든 설계의 전제)
  03-tech-stack-and-architecture.md   Java/Spring 스택, 절대 규칙
  04-ways-of-working.md       스프린트, DoR/DoD, 코드리뷰, 온콜
  05-simulation-guide.md      ⭐ 시뮬레이션 진행 방법과 명령어
templates/        PRD / 티켓 / ADR / COE(포스트모템) 템플릿
backlog/          로드맵, 스프린트별 PRD와 티켓
meetings/         회의록 (요구사항이 실제로 나오는 자리)
```

## Sprint 1 (진행 중)

**PDP Aggregation API v1** — 5개 의존 서비스를 병렬로 조립해 상품 상세 응답을 만든다.
의존성이 죽어도 페이지는 떠 있어야 하고, p99는 120ms를 넘으면 안 되며, 캐시 히트율 98.5%를 못 맞추면 남의 팀 서비스를 죽인다.

첫 번째 시험은 코드가 아닙니다. **26 SP가 배정됐는데 개인 몫은 8~10 SP입니다. 무엇을 잘라낼 것인가.**

---
*모든 회사명·인물·수치는 시뮬레이션용 허구입니다.*
