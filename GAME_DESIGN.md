# 게임 기획 문서 — Version 0.5

Version 0.4([../v0.4/GAME_DESIGN.md](../v0.4/GAME_DESIGN.md))의 후속 버전. 이번 버전의
주제는 **Size → 전투력 → 위험 → 보상으로 이어지는 핵심 구조를 완성하고, 그 과정에서 드러난
흡수 시스템의 근본적인 설계 결함을 고치는 것**이다. 구체적 변경 목록은
[CHANGELOG.md](../../CHANGELOG.md), 수치 조정 근거는 [BALANCE_NOTES.md](BALANCE_NOTES.md).

## 1. 흡수 시스템 재설계: 물리적 당김을 완전히 제거

v0.3과 v0.4는 모두 "흡수 대상의 위치를 흡수자 쪽으로 당기는 물리"를 썼고, 두 버전 모두 그
당기는 힘과 대상의 도주 속도가 맞서 싸우다 특정 지점에서 **교착 상태**(완료도 취소도 안 되고
영원히 멈춤)에 빠지는 버그가 실측으로 발견됐다(v0.4 BALANCE_NOTES 참고).

v0.5는 기획안 §10의 "거리 기반 흡수"를 계기로 접근 자체를 바꿨다: **위치를 조작하는 물리를
없애고, 진행 속도를 순수하게 "현재 거리"의 함수로만 정의한다.**

```
maintainDistance(absorber) = baseMaintainDistance + absorber.size × maintainDistancePerSize
proximity = 1 - min(1, distance / maintainDistance)      // 0(가장자리) ~ 1(완전히 겹침)
progress += maxAbsorptionSpeed × proximity × dt
distance > maintainDistance  →  연결 즉시 해제
```

`js/absorption.js#updateAbsorptions()`. 대상은 흡수자에게 물리적으로 끌려가지 않는다 —
아주 약한 장식용 당김(`pullForce`)이 있긴 하지만, 진행도는 오직 거리에만 의존하므로 이
당김의 세기가 얼마든 "완료도 취소도 안 되는 평형점"이 수학적으로 존재할 수 없다. 두 힘이
맞서 싸우는 구조 자체가 사라졌으므로, v0.3/v0.4에서 두 차례 재발했던 버그 클래스가 v0.5에서는
설계상 불가능하다 — 이번 버전에서 가장 중요하게 생각한 결정이다.

시각적으로는 오히려 이전보다 자연스럽다: 연결선이 항상 두 개체의 실제 위치를 그대로 잇기
때문에(`Game.drawAbsorptionLinks`), 겹치지 않은 채로 흡수가 진행되는 모습이 "에너지 빔으로
연결되어 있다"는 느낌을 그대로 준다. 연결선의 두께/밝기도 거리에 비례해 달라진다(§13-14).

## 2. Size 기반 방어력

```
defense = baseDefense + size × defensePerSize
finalDamage = max(minimumDamage, rawDamage - defense)
```

`js/combat.js#defenseForSize()` / `#applyDefense()`. v0.4까지는 Size가 공격력에만 영향을
줬는데, v0.5는 방어에도 영향을 줘서 "크기 = 종합 전투력"이라는 등식을 완성한다.

## 3. Size 기반 공격력 (단순화)

```
damage = baseAttackDamage + size × attackDamagePerSize
```

v0.4는 `size - referenceSize`(기준점 대비 차이)를 사용했지만, v0.5는 기획안 §4의 요구대로
더 단순한 절대 크기 비례 공식으로 바꿨다. `attackDamagePerSize = 1`이 핵심 요구값이다.

## 4. 공격 범위 ↔ 돌진 거리 버그 수정

v0.4까지 공격의 실제 대시 거리는 `attackChargeSpeed × attackChargeDuration`(둘 다 고정
상수)으로 계산되어, `currentAttackRange`가 아무리 커져도 실제로 이동하는 거리는 전혀
늘어나지 않는 버그가 있었다. v0.5는 이를 역산 방식으로 고쳤다:

```
currentChargeDistance = currentAttackRange × chargeDistanceMultiplier   (시작 시 스냅샷)
chargeSpeed = currentChargeDistance / attackChargeDuration              (매 CHARGING 프레임)
```

거리를 고정하고 속도를 그로부터 역산하므로, `attackChargeDuration`(대시가 지속되는 시간)은
그대로 유지하면서 실제 이동 거리만 Size에 정확히 비례하게 됐다. 실측 검증은
BALANCE_NOTES 참고.

## 5. 공격/회피 스택 시스템

기존의 "단일 사용 + 쿨다운" 모델을 "스택(충전) + 스택당 회복 시간" 모델로 교체했다.

```
attackMaxStack = computeMaxStack(size, skills.attackStackThresholds)
dodgeMaxStack  = computeMaxStack(size, skills.dodgeStackThresholds)
```

`js/entity.js#computeMaxStack()`은 `[{size, maxStack}, ...]` 형태의 정렬된 임계값 배열을
스캔하는 범용 함수 하나로 구현했다 — Stage 3, 4를 추가하고 싶으면 배열에 항목만 추가하면
된다(기획안 §25가 명시적으로 요청한 확장성).

`attack.attackCooldown`/`dodge.dodgeCooldown`은 이제 "다음 공격까지의 대기시간"이 아니라
**"스택 1개가 회복되는 데 걸리는 시간"**이라는 의미로 재해석된다(`js/combat.js#updateAttackStack`
/ `#updateDodgeStack`). 스택이 남아있는 한 개별 공격의 텔레그래프/차지/회복 애니메이션이
끝나는 즉시 다음 공격을 낼 수 있다 — "2연속 공격"이 실제로 쿨다운 없이 가능해진다.

Skill Stage 개념(v0.2~v0.4의 `skillStage` 0/1/2)은 공격과 회피가 서로 다른 임계값 세트를
쓰게 되면서 더 이상 하나의 숫자로 표현할 수 없어 폐기했다 — 대신 `attackMaxStack`/
`dodgeMaxStack`을 직접 참조한다.

## 6. Size 기반 HP 리젠 / 적 크기 스케일링

```
regenRate  = healthRegen.baseRate + size × healthRegen.regenPerSize
enemyMaxSize = enemyScaling.baseEnemyMaxSize + playerSize × enemyScaling.enemyMaxSizePerPlayerSize
```

HP 리젠은 v0.4의 고정 5/초에서 Size 비례로 바뀌었고(`js/combat.js#updateHealthRegen`),
딜레이도 2초→5초로 늘어나 "치고 빠지기"의 리스크가 더 커졌다. 적 크기 분포의 중/대형 티어
상한은 플레이어 Size에 실시간으로 연동된다(`js/spawning.js#rollEnemySize`) — 소형 티어는
고정폭을 유지해 항상 만만한 상대도 존재하도록 했다(§17-3).

## 7. 다른 색상 물리적 밀어내기

```
Movement Collision(겹침) → 질량(Size) 비례로 서로 밀어냄
Attack Charge / Dodge 중 → 충돌 무시(통과)
```

`js/game.js#resolvePushApart()`. 공간 그리드로 인접 쌍만 검사하고, 각 쌍을 한 번만
처리하도록(`a.id < b.id`) 가드한다. 같은 색상 쌍은 흡수 시스템이 담당하므로 이 함수에서는
완전히 제외된다. 돌진 공격이나 회피 중인 개체는 물리 충돌에서 빠지므로(§18-2), "돌진
중인데 몸통 충돌 때문에 막힌다"는 어색함이 없다.

## 8. 실행 방식 개선

`run.bat`이 서버를 별도 창에서 백그라운드로 띄운 뒤, 짧은 고정 지연 후 기본 브라우저로
`http://localhost:8000`을 자동으로 연다. 완벽한 "서버 준비 완료" 폴링 대신 고정 지연을 쓴
이유와 한계는 BALANCE_NOTES 참고.

## 9. Size 통합 관계도 (v0.5 최종형)

```
              Size
               │
  ┌───┬───┬───┬┴──┬────┬──────┬────────┬─────────┐
  ↓   ↓   ↓   ↓   ↓    ↓      ↓        ↓         ↓
 HP Damage Def Range Charge Dodge  Absorb   Absorb    Stack
                     Dist   Dist   MaintainD Speed(거리) Capacity
```

여기에 더해 **적 최대 크기**(플레이어 Size 기준)와 **넉백 저항**(대상 Size 기준)도 Size에
연동되어 있다. Player와 AI는 이 모든 공식을 동일하게 공유한다.

## 10. 나머지 시스템

맵/카메라/HUD/파티클/사운드/킬 보상 구조 등은 v0.4와 동일하다(HUD의 스택 표시만 §5에 맞춰
변경). 자세한 내용은 [../v0.4/GAME_DESIGN.md](../v0.4/GAME_DESIGN.md)를 참고.

## 11. 향후 확장 방향

- `computeMaxStack()`이 이미 임계값 배열 구조이므로, Size 150/200 구간에서 3스택째를
  추가하는 것은 `gameBalance.json`에 항목 하나 추가하는 것만으로 가능하다.
- 흡수의 장식용 `pullForce`를 완전히 제거하고 순수하게 거리만으로 연출하는 것도 고려할 수
  있다(현재는 "약간 끌려온다"는 손맛을 위해 남겨뒀다).
- Defense가 선형이라 고성장 구간에서 전투가 다시 길어질 수 있다 — 지수적 방어력 감소 저항
  같은 대안도 검토 가능(BALANCE_NOTES 참고).
