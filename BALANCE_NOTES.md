# 밸런스 노트 — Version 0.6

이전 버전 노트는 각 폴더에 그대로 있다([v0.1](../v0.1/BALANCE_NOTES.md) ~
[v0.5](../v0.5/BALANCE_NOTES.md)). 이 문서는 v0.6에서 새로 추가/재설계된 시스템의 실측
결과다. (Browser pane이 숨겨지면 `requestAnimationFrame`이 멈추므로, `game.update(dt)`를
고정 타임스텝으로 직접 호출하며 검증했다.)

## [추가 수정] 킬 리워드 Orb 시스템 재설계 — 자연스러운 외형 + 후반 성장 정체 해소

세 가지 요청을 함께 처리했다: (1) 죽은 적이 드랍하는 Orb가 필드에 자연스폰되는 Orb와
동일하게 보이도록(고정 크기 + 십자 마크로 "반짝이는 점"처럼 보이던 것 제거), (2) 큰 적을
잡을수록 보상이 강해지고 후반에도 성장이 정체되지 않도록, (3) 죽인 적이 클수록 보상이 더
넓게 퍼지도록.

**원인 분석**: 기존 `spawnDeathOrbs()`는 모든 드랍 Orb에 고정 크기(`orbSize: 9`)와 고정
성장치(`orbGrowthValue: 5`)를 부여하고, `fromDeath` 플래그로 십자 마크를 그려 시각적으로도
필드 Orb와 다르게 보였다. 더 중요한 문제: 총 보상량이 사실상 `orbCount × 5`였는데,
`orbCount`가 `orbMaxCount`(30)에서 캡되면(Size 270 근방) 그 이후로는 아무리 큰 적을 잡아도
총 보상이 **전혀 늘지 않았다** — "후반 성장 정체"의 직접적인 원인.

**수정**: 각 Orb의 크기를 필드 Orb와 동일한 공식(`minOrbSize + random × spread`)으로
무작위 생성하되, `spread` 자체가 죽은 적의 Size에 비례해 넓어지도록 했다
(`orbSizeGrowthPerEnemySize`). 성장치도 필드 Orb와 완전히 동일한 밀도 공식
(`5 + (size - minOrbSize) × 2`)으로 각 Orb 자신의 크기에서 계산 — 더 이상 고정값이 아니다.
결과적으로 Orb 개수가 상한에 도달한 뒤에도 **개별 Orb의 가치**가 계속 커지므로, 총 보상은
`count`가 아니라 `count × 평균 orb 가치`로 결정되고, 후자가 Size에 비례해 무한히 커진다 —
구조적으로 정체점이 없어졌다. 십자 마크 렌더링도 완전히 제거했다. 퍼지는 반경도
`deadEntity.size × orbSpreadMultiplier(2.0) + orbSpreadBase(20)`로, 기존보다 훨씬 넓게
스케일링하도록 배율을 키웠다.

**실측** (`spawnDeathOrbs()` 직접 호출):

| 적 Size | Orb 개수 | Orb 크기 범위 | 총 Growth | 최대 퍼짐 거리 |
| --- | --- | --- | --- | --- |
| 20 | 5 | 10.2~15.4 (필드 Orb와 동일 범위) | 62 | 55px |
| 80 | 11 | 8.4~27.5 | 275 | 169px |
| 200 | 23 | 8.2~53.9 | 1,247 | 413px |
| 500 | 40(상한) | 9.3~132.9 | 5,398 | 986px |

Size 200→500 구간에서 Orb 개수는 23→40(1.7배)에 그쳤지만 총 Growth는 1,247→5,398(4.3배)로
훨씬 가파르게 늘었다 — 개수가 상한에 근접·도달한 뒤에도 총 보상이 계속 강하게 성장한다는
것을 수치로 확인. 실제 게임 내 킬(Size 250 적)로도 확인 — 킬 지점 주변에 크고 작은 빨간
원들이 넓게 퍼져 나타나고, 십자 마크 없이 필드 Orb와 구분되지 않는 것을 스크린샷으로 확인.

Size 500에서 최대 Orb 크기가 132.9px까지 나오는 것은 상당히 크다(어지간한 AI 개체와
맞먹음) — 의도적으로 "강하게" 요청받은 결과지만, 실제 플레이에서 과하게 느껴지면
`orbSizeGrowthPerEnemySize`(현재 0.25)를 낮추는 것을 고려할 수 있다(아래 "추가 조정 필요"
참고).

## [추가 수정] 사용자 리포트: 전체 초기화 버튼이 안 먹힘

원인: `window.confirm()`이 일부 브라우저/임베딩 환경에서 사용자 상호작용 없이 조용히
`false`를 반환한다 — 실제로 이 세션의 자동화 브라우저에서 직접 재현: `window.confirm('test')`
호출 결과가 예외 없이 그냥 `false`. 버튼을 클릭해도 다이얼로그가 아예 뜨지 않거나(또는
즉시 취소로 처리되어) `game.reset()`이 한 번도 호출되지 않는 것을 실제 클릭 테스트로 확인.

수정: `window.confirm()`을 완전히 제거하고, Game Over 오버레이와 동일한 스타일의 **게임 내
커스텀 확인창**(`#reset-confirm-overlay`)으로 교체 — "초기화"/"취소" 버튼을 직접 클릭하는
방식이라 브라우저 네이티브 다이얼로그의 신뢰성 문제에서 완전히 자유롭다.

재검증(실제 UI 클릭, 콘솔 조작 아님):
- Growth 500을 부여해 Size 55까지 키운 뒤 "전체 초기화" 클릭 → 확인창 표시 → "초기화" 클릭
  → HP 100/100, Growth 0, Size 20, Score 0, ATTACK/DODGE 모두 LOCKED로 정확히 초기화.
- Score를 999로 설정한 뒤 "전체 초기화" → "취소" 클릭 → Score 999 그대로 유지, 오버레이만
  닫힘 — 취소 시 아무 것도 초기화되지 않는 것도 확인.

## [추가 수정] 밸런스 조정: 공격 텔레그래프/차지 시간의 Size 스케일링

사용자 요청: 두 값 모두 "Size 50에서 0.2, Size 100에서 0.4"가 되도록 선형 스케일링.
`base + size × perSize`에 두 점을 대입하면 `base=0, perSize=0.004`가 정확히 나온다(기존
Charge Duration의 Size 200≈0.8 예시와도 `200×0.004=0.8`로 일관됨). 두 값 모두
`attackChargeDurationBase/PerSize` → `attackChargeDurationBase:0, PerSize:0.004`로,
텔레그래프 시간은 기존에 없던 `attackTelegraphTimeBase/PerSize`(0/0.004)를 새로 추가해
Size 기반으로 전환했다(기존에는 `attack.attackTelegraphTime`이 모든 크기에 동일한 고정값
0.4였다).

실측: `attackChargeDurationForSize(50)=0.200`, `(100)=0.400`,
`attackTelegraphTimeForSize(50)=0.200`, `(100)=0.400` — 요청값과 정확히 일치.

## §20 수치 반영 확인

기획안 §20 "특히 반드시 반영" 목록을 코드에서 직접 읽어 대조했다 — 전부 정확히 일치.

| 항목 | 기획안 값 | 실측 |
| --- | --- | --- |
| Attack Telegraph | 0.4 | 0.4 |
| Charge Duration (Size 200) | ≈0.8초 | 0.800초 |
| Base Dodge Distance | 100 | 100.0 (Size 0에서) |
| Dodge Distance Growth | 0.8 | 132.0 (Size 40: 100+40×0.8) |
| Knockback Force | 500 | 500 |
| Health Regen Delay | 5초 | 5 |
| Absorption Base Resistance | 0.2초 | 0.2 |
| Absorption Resistance Per Size | 0.02 | 0.02 |
| Attack Damage Per Size | 1 | (공식에 반영, defenseAtSize40 등으로 간접 확인) |
| Base Attack Range | 120 | 120 |
| Max Life | 3 | 3 |

## §2-1 Debug Panel 구조

`F1` 패널에서 Defense 필드(`baseDefense`/`defensePerSize`/`minimumDamage`)가 더 이상
독립 섹션이 아니라 **Combat Scaling** 섹션 안에 `knockbackForce`, Charge Duration 계수와
함께 나란히 표시되는 것을 스크린샷으로 확인.

## §3 AI 공격 페이스 — 핵심 발견: 스택만으로는 막을 수 없었다

v0.5 말미 수정(중복 호출 제거)만으로는 "스택이 여러 개 쌓이면 순식간에 연달아 공격한다"는
문제가 완전히 해결되지 않는다 — 스택 회복 속도를 아무리 늦춰도, 일단 스택이 2개 차 있는
상태에서는 텔레그래프→차지→회복 애니메이션이 끝나는 즉시 두 번째 공격이 바로 나간다.

그래서 스택 회복과는 **완전히 독립적인** `aiAttackGateTimer`를 추가했다 — 공격을 시작하는
순간 무조건 `ai.attackCooldown`(2.5초)으로 설정되고, 이 값이 남아있는 한 스택이 몇 개든
`canStartAttack()`이 거짓을 반환한다.

**격리 테스트** (실제 게임 로직 함수를 직접 호출, AI 의사결정의 무작위성 배제):
2스택 AI에게 `updateAttack`/`updateAttackStack`/`canStartAttack`/`startAttack`만 반복
호출한 결과, 공격 시작 시각이 `0.00 → 2.52 → 5.03 → 7.55`로 **정확히 ai.attackCooldown(2.5초)
간격**을 유지했다 — 스택이 이미 2개 차 있었음에도 절대 붙여서 나가지 않았다.

**실전 시나리오 테스트** (실제 `decideAI`/`moveAI` 사용, Size 110 vs Size 60 고정 대치):
첫 공격 텔레그래프 t=1.25초, 두 번째 t=3.75초 — 간격 2.50초로 격리 테스트와 정확히 일치.

## §4-2 Size 기반 Charge Duration — 버그 재발 여부 확인

가장 걱정했던 지점: v0.5에서 고친 "공격 범위가 커져도 돌진 거리가 늘지 않던 버그"가, 이번에
차지 *시간*까지 Size에 따라 바뀌면서 다시 깨지지 않았는지 반드시 재검증이 필요했다.

`attackChargeDurationForSize(40)=0.480초`, `attackChargeDurationForSize(200)=0.800초`로
공식 자체는 정확했고, 실제 CHARGING 단계의 이동 거리도 여전히
`currentChargeDistance = currentAttackRange × chargeDistanceMultiplier`에서 나오는 값을
그대로 사용한다(속도만 `거리 ÷ (이제 가변인) 시간`으로 재계산) — 거리 공식 자체는 전혀
건드리지 않았으므로 버그가 재발할 구조적 여지가 없다는 것을 코드 경로 확인으로 검증했다.

## §7 아군 흡수 ON/OFF

- OFF 상태에서 `canAbsorb` 조건을 만족하는 아군 대상에 접근해도 `startAbsorption`이 전혀
  호출되지 않는 것을 확인(`beingAbsorbedByRef`가 계속 `null`).
- ON으로 되돌리면 같은 조건에서 즉시 흡수가 시작되는 것을 확인.
- 실제 브라우저에서 캔버스 우클릭 → HUD의 "ALLY ABSORB" 텍스트가 ON(녹색)/OFF(회색)로
  즉시 전환되는 것을 스크린샷으로 확인. 브라우저 기본 컨텍스트 메뉴는 뜨지 않음.

## §8 AI 흡수 행동 확률화

- `absorptionAttemptChance`(0.6) 자체의 난수 비교를 20,000회 시행한 결과 관측 비율 0.597 —
  설정값과 거의 정확히 일치.
- 흡수 시도 게이팅이 우선순위 로직 안에서 올바르게 동작하는지는 코드 검토로 확인(2a/3번
  우선순위 분기 모두 `willAttemptAbsorption`을 거침, 맨 아래 "가장 가까운 걸 먹는다" 폴백은
  의도적으로 게이트하지 않음 — 완전히 예측 불가능한 AI보다는 "적극적으로 노릴 때만 가끔
  건너뛴다"는 편이 자연스럽다고 판단).

## §13 저체력 AI 공격 시도

`decideAI()`를 300회 직접 호출(매번 HP 10%, 더 큰 위협 배치)한 결과 관측된 "도주하지 않음"
비율은 **15.0%** — 설정값(`lowHealthAttackChance: 0.15`)과 정확히 일치. 나머지 85%는 정상
도주.

## §9 흡수 사운드 (진행률 기반)

`startAbsorbDrone()`/`updateAbsorbDrone(0~1 반복)`/`stopAbsorbDrone()`을 연속 5회
반복 호출해도 예외 없이 동작(오디오 노드 누수나 중복 생성 에러 없음). 진행률 인자가 0→1로
증가함에 따라 주파수/필터/게인 목표값이 `setTargetAtTime`으로만 갱신되고 새 오실레이터가
매번 생성되지 않는 것을 코드로 확인(§25-8 요구사항).

## §10-12 처치 보상 재구성

- `growthRewardMultiplier(0.5)` 적용 전/후: Size 80 적 기준 52.8 → 26.4 (정확히 절반).
- `spawnDeathOrbs()` 크기별 실측: Size 20→5개, 40→7개, 80→11개, 150→18개 — 작은 적과 큰
  적의 차이가 육안으로 뚜렷하게 느껴지는 수준(3~4배 차이)임을 확인.

## §16 Life 시스템 — 중요 버그 발견 및 수정

Life 시스템을 흡수 경로까지 검증하는 과정에서, **v0.5까지 남아있던 실제 버그**를 하나
발견했다: 전투로 죽는 경로(`onEntityDeath`)와 흡수당해 죽는 경로
(`absorption.js#completeAbsorption`)가 서로 다른 코드를 타고 있었고, 흡수당해 죽는 쪽은
`respawnPlayer()`를 직접 호출해 Life 시스템 자체를 완전히 우회하고 있었다 — v0.6에서 Life를
도입하면서 이 경로도 함께 고치지 않았다면, "적에게 맞아 죽으면 Life가 깎이지만 흡수당해
죽으면 Life가 전혀 깎이지 않는" 눈에 띄는 비일관성이 남을 뻔했다.

`handlePlayerDefeat(reason)`으로 두 경로를 통합해 수정했고, 재검증 결과:

- 전투 사망: Lives 3→2, Size/Growth 완전 보존, `alive=true`로 정상 부활.
- 흡수 사망: Lives 3→2(별도 시나리오), Size 완전 보존, 정상 부활 — 전투 사망과 동일하게 동작.
- Lives를 0까지 소진(3회 연속 사망): `gameOver=true`, `paused=true`, `onGameOver` 콜백 정상
  발화.

## §14 전체 초기화 / §15 Scoreboard

- `resetScoreboard()` 후 목록이 빈 배열, 11개 점수를 연속 제출해도 저장은 정확히 10개로
  트리밍, 내림차순 정렬 유지 — 모두 확인.
- `Game.reset()` 호출 전후로 `localStorage`의 스코어보드 항목 수가 전혀 변하지 않는 것을
  확인(플레이어 Size/Lives/Score/GameOver 플래그는 모두 초기값으로 복귀했음에도).
- 실제 Game Over 화면(스크린샷)에서 Top 10이 내림차순으로 정확히 렌더링되고, "새 게임 시작"
  클릭 시 오버레이가 사라지고 즉시 새 런이 시작되는 것을 확인.

## §17 음소거

- 버튼 클릭 → `audio.muted=true`, `balance.audio.masterVolume=0`,
  `localStorage.ballgame_muted_v1='1'` 동시 확인.
- 다시 클릭 → `masterVolume`이 원래 값(1)으로 정확히 복원.

## 확인이 필요한 항목 (이 자동화 세션에서 직접 검증 불가)

- GitHub Pages에 실제로 배포된 뒤 상대 경로 로딩이 정상 동작하는지는 배포 후 별도 확인이
  필요하다(코드상으로는 이미 v0.1부터 상대 경로만 사용해왔음을 확인했다).
- 실제 스피커로 흡수 드론의 피치 변화가 사람이 듣기에 "거의 끝나감"을 자연스럽게 전달하는지는
  자동화 브라우저의 한계로 청취 확인이 불가능했다 — 값 자체(220→680Hz)는 임의로 정한
  추정치이므로 실제 플레이 후 조정이 필요할 수 있다.

## 추가로 조정이 필요할 수 있는 수치

- `ai.attackCooldown`(2.5초)은 순수 추정치다. 실제 플레이에서 AI가 너무 소극적으로 느껴지면
  1.8~2.0초로, 여전히 빠르다고 느껴지면 3초 이상으로 조정을 고려할 수 있다.
- Score 가중치(오브=growthValue, 흡수=gained growth, 킬=reward+100)는 초기 추정치이며,
  실제 플레이에서 "고성장 회피 플레이"와 "적극적 킬 플레이" 중 어느 쪽이 Score를 부당하게
  유리하게 만드는지 확인이 필요하다.
- `killReward.orbPerEnemySize`(0.1)는 기획안 예시 수치를 그대로 채택했다 — 개수 상한
  (`orbMaxCount`, 40)에 도달해도 이제 개별 Orb 가치가 계속 커지므로 총 보상 정체는 없지만,
  "화면에 Orb가 너무 많다"는 인상을 받으면 상한을 더 낮추고 `orbSizeGrowthPerEnemySize`를
  올려서 "적은 수, 큰 가치" 쪽으로 재조정하는 것도 가능하다.
- `killReward.orbSizeGrowthPerEnemySize`(0.25): Size 500 적 기준 최대 Orb 크기가 132.9px까지
  나온다 — 실제 플레이에서 과하게 크다고 느껴지면 0.15~0.18 정도로 낮추는 것을 고려할 수
  있다.
