# 탑뷰 2D 성장형 액션 게임 — 웹 프로토타입 (Version 0.5)

Version 0.4의 플레이 QA 및 추가 요구사항을 반영한 버전. **Size → 전투력 → 위험 → 보상**으로
이어지는 핵심 구조를 완성하는 데 집중했다 — 방어력 추가, 공격/회피가 스택 기반으로 전환,
흡수가 거리 기반으로 전면 재설계(v0.3/v0.4에서 두 번 발생했던 교착 버그를 구조적으로 제거),
서로 다른 색상 개체끼리 물리적으로 밀어내기 시작, 적 최대 크기가 플레이어 성장에 연동. 배경은
[GAME_DESIGN.md](GAME_DESIGN.md), 실측 결과는 [BALANCE_NOTES.md](BALANCE_NOTES.md), 버전
이력은 [../../CHANGELOG.md](../../CHANGELOG.md).

Version 0.1~0.4는 삭제되지 않고 각 폴더에 그대로 있다.

## 1. 실행 방법

### 가장 쉬운 방법 (Windows)

이 폴더 안의 **`run.bat`을 더블클릭**하세요. 로컬 서버가 자동으로 시작되고, 약 2초 뒤
**기본 브라우저가 자동으로 열립니다** — `localhost` 주소를 직접 입력할 필요가 없습니다.
서버는 별도의 "Ball Game Server" 창에서 실행되며, 그 창을 닫으면 서버가 종료됩니다.

macOS/Linux는 터미널에서 `./run.sh`를 실행하세요(마찬가지로 브라우저가 자동으로 열립니다).

### 수동 실행

```bash
cd game/versions/v0.5
python -m http.server 8000
```

`http://localhost:8000` 접속.

## 2. 조작법

| 입력 | 동작 |
| --- | --- |
| `W` `A` `S` `D` / 방향키 | 이동 |
| 마우스 | 공격 방향 조준 |
| 좌클릭(누르고 있으면 스택이 남는 한 자동 재시도) | 공격 |
| `Space` | 회피 |
| `F1` | 디버그/밸런스 패널 열기·닫기 |

공격과 회피는 이제 **스택(충전) 기반**입니다 — HUD에 ●●/●○/○○ 형태로 표시됩니다. 스택이
남아있으면 쿨다운 없이 연속으로 사용할 수 있고, 스택을 모두 쓰면 일정 시간마다 하나씩
자동으로 채워집니다.

## 3. Version 0.4 대비 달라진 점 (요약)

- **방어력 추가**: Size가 클수록 받는 피해가 줄어듭니다(`finalDamage = max(최소피해,
  공격력 - 방어력)`).
- **공격/회피 스택제**: LOCKED → 1스택 → 2스택으로, Size 40/100(공격)과 50/70(회피)에서
  단계적으로 해금됩니다.
- **공격 범위 ↔ 돌진 거리 버그 수정**: 이제 공격 범위가 커지면 실제 돌진 거리도 함께
  늘어납니다.
- **흡수 시스템 전면 재설계**: 더 이상 겹치지 않아도 흡수가 진행됩니다 — 거리가 가까울수록
  빠르고, 일정 거리(`maintainDistance`, Size 비례) 밖으로 벗어나면 연결이 끊깁니다. 물리적
  당김을 사실상 제거해 v0.3/v0.4의 교착 상태 버그가 구조적으로 재발할 수 없게 만들었습니다.
- **HP 리젠 Size 스케일링**: 회복량이 커지는 대신 딜레이도 5초로 늘었습니다.
- **적 최대 크기가 플레이어 Size에 연동**: 성장할수록 더 크고 위험한 적도 만나게 됩니다
  (단, 쉬운 소형 개체도 항상 존재합니다).
- **다른 색상끼리 물리적으로 밀어냄**: 완전히 겹칠 수 없습니다(단, 공격 돌진/회피 중에는
  그대로 통과).
- **실행 자동화**: `run.bat`/`run.sh`가 서버 실행 후 브라우저를 자동으로 엽니다.

## 4. 프로젝트 구조

```
v0.5/
├── index.html
├── run.bat / run.sh       # 서버 자동 실행 + 브라우저 자동 오픈
├── css/style.css
├── js/
│   ├── main.js
│   ├── game.js              # resolvePushApart, 스택 회복 루프, 적 크기 스케일링 연동
│   ├── player.js             # _recomputeStacks
│   ├── entity.js             # computeMaxStack, 스택/currentChargeDistance 필드
│   ├── ai.js                   # 스택 회복 호출 추가
│   ├── combat.js              # Defense, Size 기반 공격력, 차지거리 버그 수정, 스택 로직
│   ├── absorption.js         # 거리 기반 전면 재설계 (교착 버그 구조적 제거)
│   ├── collision.js
│   ├── spawning.js           # rollEnemySize(balance, playerSize)
│   ├── ui.js                   # 스택 pip HUD, Skills 임계값 디버그 섹션
│   └── audio.js
├── config/gameBalance.json
├── GAME_DESIGN.md
├── BALANCE_NOTES.md
└── README.md
```

## 5. `gameBalance.json`의 새 항목

```json
{
  "skills": {
    "attackStackThresholds": [{"size":40,"maxStack":1},{"size":100,"maxStack":2}],
    "dodgeStackThresholds": [{"size":50,"maxStack":1},{"size":70,"maxStack":2}]
  },
  "defense": { "baseDefense": 0, "defensePerSize": 0.5, "minimumDamage": 1 },
  "absorption": {
    "baseResistanceTime": 0.2, "resistancePerSize": 0.02,
    "baseMaintainDistance": 30, "maintainDistancePerSize": 0.5,
    "maxAbsorptionSpeed": 1.0, "pullForce": 0.15
  },
  "combatScaling": {
    "baseAttackDamage": 10, "attackDamagePerSize": 1,
    "baseAttackRange": 120, "chargeDistanceMultiplier": 1.0, ...
  },
  "healthRegen": { "delay": 5.0, "baseRate": 2.0, "regenPerSize": 0.05 },
  "enemyScaling": { "baseEnemyMaxSize": 40, "enemyMaxSizePerPlayerSize": 0.8 }
}
```

`skills.*StackThresholds`는 `[{size, maxStack}, ...]` 배열입니다 — 새 단계를 추가하려면
항목을 더 넣기만 하면 됩니다(코드 수정 불필요).

## 6. Debug Mode

`F1` 패널에 **Skills**(스택 해금 Size, 배열이라 전용 UI로 편집), **Defense**,
**Absorption**(거리 기반 신규 필드), **Combat Scaling**, **Health Regen**,
**Enemy Scaling** 섹션이 갱신/추가되었습니다.

## 7. 새로운 색상 / AI 추가 방법

Version 0.2~0.4와 동일합니다. 다른 색과의 물리적 밀어내기는 색상 정의와 무관하게 자동으로
적용됩니다(`js/game.js#resolvePushApart`).

## 8. 향후 확장 방법

[GAME_DESIGN.md](GAME_DESIGN.md) §11과 [BALANCE_NOTES.md](BALANCE_NOTES.md)의 "추가로
조정이 필요할 수 있는 수치"를 참고하세요.
