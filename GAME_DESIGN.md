# 게임 기획 문서 — Version 0.6

Version 0.5([../v0.5/GAME_DESIGN.md](../v0.5/GAME_DESIGN.md))의 후속 버전. 이번 버전은 새로운
핵심 시스템보다 **기존 시스템의 다듬기와 지속가능한 플레이 루프(Life/Score/Reset) 구축,
그리고 배포**에 집중했다. 구체적 변경 목록은 [CHANGELOG.md](../../CHANGELOG.md), 수치 조정
근거는 [BALANCE_NOTES.md](BALANCE_NOTES.md).

## 1. Debug Panel 구조 정리 — Defense는 Combat Scaling의 일부

v0.5까지 `defense`는 `combatScaling`과 나란한 독립 최상위 섹션이었다. v0.6은 이를
`combatScaling` 안으로 합쳤다(`js/combat.js#defenseForSize`가 `balance.combatScaling`을
직접 읽도록 변경) — Defense도 Size에 비례해 증가하는 전투 스케일링 요소일 뿐, 별도
서브시스템이 아니라는 관점을 코드 구조에도 반영한 것이다. `knockbackForce`와 새로 추가된
Charge Duration 공식도 같은 이유로 이 섹션에 함께 산다.

## 2. AI 공격 페이스 조정 — 두 겹의 브레이크

v0.5 말미에 "스택 회복 타이머가 이중 호출되어 2배 속도로 충전되던 버그"를 고쳤음에도, 실제
플레이에서는 여전히 AI가 스택이 쌓이는 대로 거의 곧장 다시 공격해 지나치게 빠르게 느껴진다는
피드백이 있었다. v0.6은 두 가지 독립적인 장치로 대응한다.

1. **AI 전용 쿨다운**: `balance.attack.attackCooldown`(플레이어용, 1.5초)과 별개로
   `balance.ai.attackCooldown`(2.5초)을 스택 회복 간격으로 사용한다
   (`js/game.js`의 공용 루프가 엔티티 종류에 따라 어떤 쿨다운을 넘길지 고른다).
2. **공격 게이트 타이머**: 공격을 시작하는 순간 `aiAttackGateTimer`가
   `ai.attackCooldown`으로 설정되고(`js/combat.js#startAttack`), 이 타이머가 남아있는 동안은
   `canStartAttack()`이 무조건 거짓을 반환한다 — **스택이 남아있어도** 막힌다. 이게 핵심이다:
   스택 자체는 여전히 2개까지 쌓일 수 있지만(Size 100+), 쌓인 스택을 순식간에 연속으로 터뜨릴
   수는 없다.

실측: Size 110(2스택) AI를 고정 시나리오에 놓고 관찰한 결과, 스택이 남아있음에도 공격
시도가 정확히 2.5초 간격으로만 발생하는 것을 확인했다(BALANCE_NOTES 참고).

## 3. Size 기반 공격 텔레그래프 & 차지 시간

```
telegraphTime = attackTelegraphTimeBase + size × attackTelegraphTimePerSize
chargeDuration = attackChargeDurationBase + size × attackChargeDurationPerSize
```

최초 초안은 텔레그래프를 모든 크기에 동일한 고정값(0.4초)으로 뒀지만, 곧바로 이어진 밸런스
피드백에서 텔레그래프도 차지 시간과 똑같이 Size에 비례하도록 바뀌었다(`js/combat.js`
`attackTelegraphTimeForSize`/`attackChargeDurationForSize`) — 둘 다 "Size 50→0.2초,
Size 100→0.4초"를 만족하는 계수(`base=0, perSize=0.004`)로 통일했다. 기존에는 모든 크기의
공이 동일한 차지 시간을 가졌지만, 이제 큰 공은 더 멀리·강하게 치는 대신 예고 동작도, 준비
자세도 더 오래 유지해야 한다 — 작은 공은 거의 즉발에 가깝게 찌르고 빠질 수 있는 반면, 큰
공의 공격은 멀리서도 알아보고 대응할 여유가 상대적으로 더 크다.

이때 돌진 **거리**는 여전히 v0.5의 방식(`currentAttackRange × chargeDistanceMultiplier`)을
그대로 쓰고, 돌진 **속도**만 `거리 ÷ (이제는 Size에 따라 달라지는) 시간`으로 재계산된다 —
v0.5에서 고친 "공격 범위가 커져도 돌진 거리가 늘지 않던 버그"가 이번 변경으로 재발하지
않는다는 것을 반드시 확인해야 했다(실측은 BALANCE_NOTES 참고).

## 4. 카메라: 커질수록 넓게 본다

```
zoomOutFactor = min(maxZoomOut, 1 + size × zoomOutPerSize)
targetZoom = baseZoom / zoomOutFactor
```

`js/game.js#updateCamera()`. Size가 커질수록 `zoomOutFactor`가 커져 `targetZoom`이 줄어들고,
줌이 작을수록(이 코드베이스의 관례상) 더 넓은 영역이 보인다. `maxZoomOut`으로 상한을 둬서
극단적으로 커져도 한없이 축소되지는 않는다. 목적은 명확하다 — 몸집이 커지면 자기 몸통 때문에
주변 위협을 못 보는 문제를 방지하고, "커지는 것"에 순수한 생존 이점(시야)을 더한다.

## 5. Dodge Distance: 지수 공식 → 선형 공식

```
dodgeDistance = baseDistance(100) + size × distanceGrowth(0.8)
```

v0.5는 공격 범위와 동일하게 지수 곡선(`baseDodgeDistance × (size/reference)^exponent`)을
썼는데, v0.6은 회피만 단순한 선형 공식으로 바꿨다(`js/combat.js#dodgeDistanceForSize`) —
기획안이 명시적으로 이 형태를 요구했고, 공격 범위(지수, 더 가파르게 성장)와 회피 거리(선형,
안정적으로 성장)가 서로 다른 곡률을 갖게 되어 "크게 성장할수록 공격이 회피보다 상대적으로
더 유리해진다"는 v0.4 이후의 설계 의도가 한층 뚜렷해진다.

## 6. 아군 흡수 ON/OFF

우클릭으로 `player.allyAbsorptionEnabled`를 토글한다(`js/main.js`). OFF 상태에서는
`Game.resolveConsumption()`이 플레이어가 흡수자인 경우에 한해 흡수 시작 자체를 건너뛴다 —
아군에 대한 다른 상호작용(밀어내기는 애초에 같은 색끼리는 적용 안 됨, 공격도 같은 색은
`isHostile()`이 걸러서 불가능)은 전혀 영향받지 않는다. AI는 이 토글과 무관하게 자신의
흡수 로직(§7)을 그대로 따른다 — 이건 플레이어 전용 컨트롤이다.

## 7. AI 흡수 행동의 확률화

```
willAttemptAbsorption = bestAbsorbable && random() < absorptionAttemptChance(0.6)
```

`js/ai.js#decideAI()`. 매 의사결정 주기(~0.2~0.35초)마다 새로 굴린다 — 흡수 가능한 대상을
발견해도 매번 반드시 시도하지는 않는다. 통계적으로 60%에 가깝게 수렴하는 것을 2만 회 시행으로
확인했다(BALANCE_NOTES). 이 확률 게이트는 "적극적으로 노리는" 상위/일반 우선순위 흡수
시도에만 적용되고, 맨 아래 우선순위의 "어차피 가장 가까운 걸 먹는다" 케이스는 그대로 둬서
완전히 무작위로 보이지 않게 했다.

## 8. 저체력 AI도 완전히 무력화되지 않음

```
if (survival 조건 충족) {
  if (random() >= lowHealthAttackChance(0.15)) → 도주
  else → 도주 생략, 아래 우선순위(반격 등)로 진행
}
```

`js/ai.js#decideAI()`. 기존에는 HP가 `fleeThreshold` 이하로 떨어지고 위협이 더 크면 무조건
도주였다. v0.6은 15% 확률로 그 도주를 건너뛰고 원래의 우선순위 사다리(반격 등)로 넘어가게
한다 — "생존 행동이 기본이지만 완전히 0%가 되지는 않는다"는 요구사항을 정확히 구현한다.
decideAI 300회 직접 호출 테스트에서 관측된 미도주 비율은 15.0%로 설정값과 정확히 일치했다.

## 9. 흡수 사운드: 연속·진행률 기반

v0.4~v0.5는 흡수 시작/성공에 각각 한 번씩 울리는 단발 사운드였다. v0.6은 그 위에 **진행 중
계속 재생되는 드론**을 추가한다(`js/audio.js#startAbsorbDrone/updateAbsorbDrone/stopAbsorbDrone`).
오실레이터·필터·게인 노드를 흡수 시작 시 한 번만 만들고, 이후로는 진행률(0~1)에 따라
`setTargetAtTime`으로 주파수(220→680Hz)·필터 밝기·음량을 매 프레임 부드럽게 갱신한다 — 새
오디오 객체를 프레임마다 생성하지 않는다(기획안 §25-8 명시 요구사항). 플레이어가 흡수자든
피흡수자든 관여만 하면 재생되고(`Game.updatePlayerAbsorbDrone`), AI끼리의 흡수는 여전히
조용하다(v0.4 이후 원칙 유지).

## 10. 처치 보상 재구성 — 즉시 성장에서 "가서 주워야 하는" 보상으로

```
직접 Growth 보상 = 기존 공식 × growthRewardMultiplier(0.5)
Orb 생성 개수 = min(orbMaxCount, orbBaseCount + 적 Size × orbPerEnemySize)
```

`js/game.js#onEntityDeath`, `js/spawning.js#spawnDeathOrbs`. 처치 즉시 받는 Growth를
절반으로 줄이고, 대신 시체 자리에 떨어지는 Orb 개수를 적의 Size에 비례해 크게 늘렸다 — 큰
적을 잡을수록 눈에 띄게 많은 Orb가 흩뿌려진다(Size 20→5개, Size 150→18개, 실측치는
BALANCE_NOTES). 플레이어는 그 보상을 직접 걸어가서 모아야 하므로, 처치 직후에도 위험한
전장에 잠시 더 머물러야 하는 순간이 생긴다 — "처치 = 즉시 안전하게 강해짐"이 아니라
"처치 = 위험을 감수하고 거둬야 할 보상"으로 바뀐다.

Fragment는 v0.2부터 이미 Orb로 완전히 통합되어 있었다(별도 타입/렌더링/충돌 경로가 존재한
적이 없음) — v0.6에서 새로 제거할 것은 없었고, 이번 처치-보상 개편이 그 원칙을 재확인한다.

## 11. Life 시스템 — Size를 잃지 않는 부활

```
Life = 3 (시작)
사망(전투 또는 완전 흡수) → Life -1 → Life > 0이면 Size/Growth 그대로 부활
Life = 0 → Game Over
```

`js/game.js#handlePlayerDefeat()`가 전투 사망(`onEntityDeath`)과 완전 흡수
(`absorption.js#completeAbsorption`) 양쪽에서 공유되는 단일 진입점이다 — v0.5까지는 흡수로
죽는 경로가 `respawnPlayer()`를 직접 불러 Life 시스템을 완전히 우회하고 있었는데(이번에 함께
발견/수정), 이제 두 죽음 경로 모두 정확히 동일하게 Life를 소모한다. v0.5까지 있던 "부활 시
Growth 50% 감소" 페널티는 제거됐다 — v0.6에서는 Life 자체가 리스크의 단위이고, Size는 그
안에서 보호된다.

## 12. Score와 Top 10 (로컬)

```
Score += 주운 Orb의 growthValue
Score += 흡수로 얻은 Growth
Score += 킬 리워드 Growth + 100(킬 고정 보너스)
```

Game Over 시 `js/storage.js#submitScore()`가 `localStorage`에 상위 10개만 정렬·보관한다 —
서버가 없는 정적 배포이므로 전역 랭�킹이 아니라 **브라우저별 로컬 기록**이며, README에 이
사실을 명시한다(기획안 §15가 명시적으로 요구).

## 13. 전체 초기화 vs Scoreboard — 완전히 분리된 두 액션

`Game.reset()`은 플레이어·엔티티·타이머·카메라·Life·Score·오디오 드론 상태를 전부 생성자와
동일한 방식으로 재구성하지만, **`localStorage`는 단 한 줄도 건드리지 않는다**
(`js/storage.js`의 함수들은 오직 스코어보드/음소거 버튼 핸들러에서만 호출됨). Full Reset
버튼은 확인을 한 번 받는다(로컬 실수 방지 목적, 기획 요구사항은 아니지만 자연스러운 안전
장치) — 처음엔 `window.confirm()`을 썼는데, 일부 브라우저/임베딩 환경에서 사용자 조작 없이
조용히 `false`를 반환하는 것이 실측으로 확인되어(버튼을 눌러도 아무 일도 안 일어나는 것처럼
보였다) 게임 내 커스텀 확인창(`#reset-confirm-overlay`)으로 교체했다 — 자세한 경위는
BALANCE_NOTES 참고.
아니지만 UX상 자연스러운 안전장치).

## 14. 음소거

`AudioManager.setMuted()`가 `balance.audio.masterVolume`을 0으로 밀어넣는 방식으로
구현됐다 — 모든 사운드 함수(`tone/sweep/noiseBurst`, 그리고 흡수 드론)가 이미 매번
`volume()`을 통해 이 값을 실시간으로 읽으므로, 별도의 마스터 게인 노드 없이 이 한 줄만으로
모든 SFX가 즉시 음소거된다. 상태는 `localStorage`에 저장되어 새로고침 후에도 유지된다.

## 15. GitHub Pages 배포 대응

모든 리소스 경로가 이미 상대 경로였다(`fetch('config/gameBalance.json')`,
`<script src="js/main.js">` 등) — 서버 종속 기능이나 절대 경로가 없어 별도의 코드 변경 없이
정적 호스팅에 그대로 올라간다. 실제 배포/확인 절차는 README §1, BALANCE_NOTES 참고.

## 16. Size 통합 관계도 (v0.6 최종형)

```
              Size
               │
  ┌───┬───┬───┬┴──┬────┬──────┬────────┬─────────┬────────┐
  ↓   ↓   ↓   ↓   ↓    ↓      ↓        ↓         ↓        ↓
 HP Damage Def Range Charge Charge  Dodge    Absorb    Stack  Camera
                     Dist   Time    Dist     MaintainD Cap.   ZoomOut
```

v0.5까지의 관계도에 **Charge Time**(공격 준비가 느려짐 — 위험 요소)과 **Camera Zoom
Out**(시야가 넓어짐 — 보상 요소)이 새로 추가됐다. "커질수록 무조건 유리해지지 않는다"는
기획 원칙(§22)이 Charge Time을 통해 처음으로 명시적인 페널티 축을 갖게 됐다는 점이 이번
버전에서 구조적으로 가장 중요한 지점이다.

## 17. 향후 확장 방향

- Score 공식(오브/흡수/킬 보너스의 가중치)은 초기 추정치다 — 실제 플레이에서 "Score가
  성취감을 제대로 반영하는지" 별도 확인이 필요하다.
- 전역 온라인 랭킹으로 확장하려면 별도 백엔드(또는 서버리스 함수 + DB)가 필요하다 —
  현재는 명시적으로 범위 밖이다(README에 고지).
- `aiAttackGateTimer`가 사실상 "스택과 별개의 두 번째 쿨다운"이라 두 값(`ai.attackCooldown`과
  스택 회복 간격)이 우연히 같은 값을 공유하고 있다 — 나중에 이 둘을 의도적으로 분리하고 싶다면
  별도 필드로 나누는 것을 고려할 수 있다.
