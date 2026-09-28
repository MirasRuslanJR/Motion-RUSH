import { GESTURE_CONFIG } from '../../config/gesture.config';
import type { BodyPart } from '../tracking/landmarks';
import type { Baseline } from './calibration';
import type { BodyFeatures } from './FeatureExtractor';
import type { Classification, GestureReading } from './GestureClassifier';
import type { Arrow, ExpectedMotion } from './types';

/**
 * correct — the expected motion is recognised
 * near    — right motion, not enough of it (e.g. hands at 80% height)
 * wrong   — the motion is performed incorrectly (one hand, wrong direction…)
 * other   — the user performs a DIFFERENT gesture than expected
 * idle    — no attempt yet; we only show a cue, never an error
 */
export type Verdict = 'correct' | 'near' | 'wrong' | 'other' | 'idle';

export interface RuleContext {
  expected: ExpectedMotion;
  f: BodyFeatures;
  c: Classification;
  baseline: Baseline;
  /** Reading of the expected gesture (null for CENTER). */
  reading: GestureReading | null;
  /** -1 = left, 1 = right, 0 = n/a — for lean-related wording. */
  dir: -1 | 0 | 1;
}

export interface RuleOutput {
  message: string;
  focus: BodyPart[];
  arrow: Arrow | null;
}

export interface DiagnosisRule {
  id: string;
  expects: readonly ExpectedMotion[];
  /** Higher = evaluated first. The first matching rule wins. */
  priority: number;
  verdict: Verdict;
  /** Short caption for the metric bar. */
  metric: string;
  when: (ctx: RuleContext) => boolean;
  build: (ctx: RuleContext) => RuleOutput;
}

const LEAN = GESTURE_CONFIG.lean;
const JUMP = GESTURE_CONFIG.jump;
const CROUCH = GESTURE_CONFIG.crouch;

const toward = (dir: number) => (dir < 0 ? 'влево' : 'вправо');
const further = (dir: number) => (dir < 0 ? 'левее' : 'правее');
const leanArrow = (dir: number): Arrow => (dir < 0 ? 'left' : 'right');

/** Lateral shift toward the requested side, in SW. */
const leanToward = (ctx: RuleContext) => ctx.dir * ctx.f.leanX;

const lowerHand = (f: BodyFeatures) => (f.leftHandLiftEffective <= f.rightHandLiftEffective ? 'left' : 'right');
const higherLift = (f: BodyFeatures) => Math.max(f.leftHandLiftEffective, f.rightHandLiftEffective);
const lowerLift = (f: BodyFeatures) => Math.min(f.leftHandLiftEffective, f.rightHandLiftEffective);
const armPart = (side: 'left' | 'right'): BodyPart => (side === 'left' ? 'leftArm' : 'rightArm');
const handName = (side: 'left' | 'right') => (side === 'left' ? 'левую' : 'правую');
const handNameNom = (side: 'left' | 'right') => (side === 'left' ? 'Левая' : 'Правая');

const LEANS = ['LEAN_LEFT', 'LEAN_RIGHT'] as const;

/**
 * Rule table: condition → diagnosis → instruction → priority.
 * Every condition reads real landmark-derived features; the instruction names
 * the body part, the direction and (via the metric bar) how much is missing.
 */
export const DIAGNOSIS_RULES: readonly DiagnosisRule[] = [
  // ─── JUMP (both arms up) ─────────────────────────────────────────────
  {
    id: 'JUMP_OK',
    expects: ['JUMP'],
    priority: 100,
    verdict: 'correct',
    metric: 'Высота рук',
    when: (ctx) => ctx.c.readings.JUMP.active,
    build: () => ({ message: 'Есть прыжок — руки над головой!', focus: ['leftArm', 'rightArm'], arrow: null }),
  },
  {
    id: 'JUMP_DOING_CROUCH',
    expects: ['JUMP'],
    priority: 90,
    verdict: 'other',
    metric: 'Высота рук',
    when: (ctx) => ctx.c.readings.CROUCH.active && higherLift(ctx.f) < JUMP.near,
    build: () => ({
      message: 'Это присед. Для прыжка выпрямись и подними обе руки вверх',
      focus: ['leftArm', 'rightArm'],
      arrow: 'up',
    }),
  },
  {
    id: 'JUMP_HANDS_OUT_OF_FRAME',
    expects: ['JUMP'],
    priority: 85,
    verdict: 'near',
    metric: 'Высота рук',
    when: (ctx) =>
      !ctx.f.leftWristVisible &&
      !ctx.f.rightWristVisible &&
      Math.max(ctx.f.leftElbowLift, ctx.f.rightElbowLift) > 0 &&
      !ctx.c.readings.JUMP.active,
    build: () => ({
      message: 'Кисти выходят за верх кадра — отойди на шаг назад',
      focus: ['leftArm', 'rightArm'],
      arrow: null,
    }),
  },
  {
    id: 'JUMP_ONE_HAND',
    expects: ['JUMP'],
    priority: 80,
    verdict: 'wrong',
    metric: 'Высота рук',
    when: (ctx) => higherLift(ctx.f) >= JUMP.activation && lowerLift(ctx.f) < JUMP.near,
    build: (ctx) => {
      const side = lowerHand(ctx.f);
      return {
        message: `Подними и ${handName(side)} руку — нужны обе руки над головой`,
        focus: [armPart(side)],
        arrow: 'up',
      };
    },
  },
  {
    id: 'JUMP_ONE_HAND_LOW',
    expects: ['JUMP'],
    priority: 75,
    verdict: 'near',
    metric: 'Высота рук',
    when: (ctx) => higherLift(ctx.f) >= JUMP.activation && lowerLift(ctx.f) >= JUMP.near,
    build: (ctx) => {
      const side = lowerHand(ctx.f);
      return {
        message: `${handNameNom(side)} рука ниже цели — подними её выше головы`,
        focus: [armPart(side)],
        arrow: 'up',
      };
    },
  },
  {
    id: 'JUMP_ELBOWS_BENT',
    expects: ['JUMP'],
    priority: 70,
    verdict: 'near',
    metric: 'Высота рук',
    when: (ctx) =>
      lowerLift(ctx.f) >= JUMP.near &&
      Math.min(ctx.f.leftElbowAngle, ctx.f.rightElbowAngle) < JUMP.bentElbowDeg &&
      ctx.f.leftWristVisible &&
      ctx.f.rightWristVisible,
    build: (ctx) => {
      const bentLeft = ctx.f.leftElbowAngle < JUMP.bentElbowDeg;
      const bentRight = ctx.f.rightElbowAngle < JUMP.bentElbowDeg;
      const focus: BodyPart[] = bentLeft && bentRight ? ['leftArm', 'rightArm'] : [bentLeft ? 'leftArm' : 'rightArm'];
      const which = bentLeft && bentRight ? 'Руки согнуты в локтях' : `${bentLeft ? 'Левая' : 'Правая'} рука согнута`;
      return { message: `${which} — выпрями их вверх над головой`, focus, arrow: 'up' };
    },
  },
  {
    id: 'JUMP_HANDS_LOW',
    expects: ['JUMP'],
    priority: 60,
    verdict: 'near',
    metric: 'Высота рук',
    when: (ctx) => lowerLift(ctx.f) >= JUMP.near,
    build: (ctx) => ({
      message:
        lowerLift(ctx.f) < 0.12
          ? 'Руки на уровне плеч — подними их выше головы'
          : 'Почти! Тянись руками ещё выше',
      focus: ['leftArm', 'rightArm'],
      arrow: 'up',
    }),
  },
  {
    id: 'JUMP_IDLE',
    expects: ['JUMP'],
    priority: 0,
    verdict: 'idle',
    metric: 'Высота рук',
    when: () => true,
    build: () => ({ message: 'Подними обе руки над головой', focus: ['leftArm', 'rightArm'], arrow: 'up' }),
  },

  // ─── LEAN LEFT / RIGHT ───────────────────────────────────────────────
  {
    id: 'LEAN_OK',
    expects: LEANS,
    priority: 100,
    verdict: 'correct',
    metric: 'Наклон корпуса',
    when: (ctx) => ctx.reading?.active === true,
    build: (ctx) => ({ message: `Есть! Держи наклон ${toward(ctx.dir)}`, focus: ['shoulders', 'torso'], arrow: null }),
  },
  {
    id: 'LEAN_WRONG_DIRECTION',
    expects: LEANS,
    priority: 90,
    verdict: 'wrong',
    metric: 'Наклон корпуса',
    when: (ctx) => leanToward(ctx) <= -LEAN.near * 1.5,
    build: (ctx) => ({
      message: `Не в ту сторону — наклонись ${toward(ctx.dir).toUpperCase()}`,
      focus: ['shoulders', 'torso'],
      arrow: leanArrow(ctx.dir),
    }),
  },
  {
    id: 'LEAN_DOING_CROUCH',
    expects: LEANS,
    priority: 85,
    verdict: 'other',
    metric: 'Наклон корпуса',
    when: (ctx) => ctx.c.readings.CROUCH.active && leanToward(ctx) < LEAN.near,
    build: (ctx) => ({
      message: `Приседать не нужно — наклони корпус ${toward(ctx.dir)}`,
      focus: ['shoulders', 'torso'],
      arrow: leanArrow(ctx.dir),
    }),
  },
  {
    id: 'LEAN_DOING_JUMP',
    expects: LEANS,
    priority: 84,
    verdict: 'other',
    metric: 'Наклон корпуса',
    when: (ctx) => ctx.c.readings.JUMP.active && leanToward(ctx) < LEAN.near,
    build: (ctx) => ({
      message: `Руки тут не помогут — наклони корпус ${toward(ctx.dir)}`,
      focus: ['shoulders', 'torso'],
      arrow: leanArrow(ctx.dir),
    }),
  },
  {
    id: 'LEAN_HEAD_ONLY',
    expects: LEANS,
    priority: 80,
    verdict: 'wrong',
    metric: 'Наклон корпуса',
    when: (ctx) => ctx.dir * ctx.f.headX >= LEAN.headOnlyHeadShift && leanToward(ctx) < LEAN.headOnlyShoulderShift,
    build: (ctx) => ({
      message: `Наклоняется только голова — сдвинь плечи ${toward(ctx.dir)} вместе с корпусом`,
      focus: ['shoulders', 'head'],
      arrow: leanArrow(ctx.dir),
    }),
  },
  {
    id: 'LEAN_TURNED',
    expects: LEANS,
    priority: 75,
    verdict: 'wrong',
    metric: 'Наклон корпуса',
    when: (ctx) => ctx.f.scaleRatio < LEAN.turnedScaleRatio,
    build: (ctx) => ({
      message: `Ты развернулся боком — встань лицом к камере и наклонись ${toward(ctx.dir)}`,
      focus: ['shoulders'],
      arrow: leanArrow(ctx.dir),
    }),
  },
  {
    id: 'LEAN_INSUFFICIENT',
    expects: LEANS,
    priority: 60,
    verdict: 'near',
    metric: 'Наклон корпуса',
    when: (ctx) => leanToward(ctx) >= LEAN.near,
    build: (ctx) => ({
      message: `Наклон недостаточный — сместись ещё ${further(ctx.dir)}`,
      focus: ['shoulders', 'torso'],
      arrow: leanArrow(ctx.dir),
    }),
  },
  {
    id: 'LEAN_IDLE',
    expects: LEANS,
    priority: 0,
    verdict: 'idle',
    metric: 'Наклон корпуса',
    when: () => true,
    build: (ctx) => ({
      message: `Наклони корпус ${toward(ctx.dir)}`,
      focus: ['shoulders', 'torso'],
      arrow: leanArrow(ctx.dir),
    }),
  },

  // ─── CROUCH ──────────────────────────────────────────────────────────
  {
    id: 'CROUCH_OK',
    expects: ['CROUCH'],
    priority: 100,
    verdict: 'correct',
    metric: 'Глубина приседа',
    when: (ctx) => ctx.c.readings.CROUCH.active,
    build: () => ({ message: 'Отлично — ты под лучом!', focus: ['hips', 'torso'], arrow: null }),
  },
  {
    id: 'CROUCH_DOING_JUMP',
    expects: ['CROUCH'],
    priority: 90,
    verdict: 'other',
    metric: 'Глубина приседа',
    when: (ctx) => ctx.c.readings.JUMP.active || higherLift(ctx.f) >= JUMP.activation,
    build: () => ({
      message: 'Руки вниз — под лучом нужно присесть, а не прыгать',
      focus: ['leftArm', 'rightArm'],
      arrow: 'down',
    }),
  },
  {
    id: 'CROUCH_HEAD_ONLY',
    expects: ['CROUCH'],
    priority: 80,
    verdict: 'wrong',
    metric: 'Глубина приседа',
    when: (ctx) => ctx.f.noseDrop >= CROUCH.headOnlyNoseDrop && ctx.f.crouchDepth < CROUCH.near,
    build: () => ({
      message: 'Опускается только голова — присядь всем корпусом',
      focus: ['head', 'shoulders'],
      arrow: 'down',
    }),
  },
  {
    id: 'CROUCH_OFF_CENTER',
    expects: ['CROUCH'],
    priority: 75,
    verdict: 'wrong',
    metric: 'Глубина приседа',
    when: (ctx) => ctx.f.crouchDepth >= CROUCH.near && Math.abs(ctx.f.leanX) >= CROUCH.maxLateralDrift,
    build: () => ({
      message: 'Сделай присед ниже, сохраняя корпус по центру',
      focus: ['torso', 'hips'],
      arrow: 'down',
    }),
  },
  {
    id: 'CROUCH_BEND_KNEES',
    expects: ['CROUCH'],
    priority: 70,
    verdict: 'near',
    metric: 'Глубина приседа',
    when: (ctx) =>
      ctx.baseline.mode === 'full' &&
      ctx.f.hipDrop !== null &&
      ctx.f.crouchDepth >= CROUCH.near &&
      ctx.f.hipDrop < ctx.f.crouchDepth * CROUCH.minHipShare,
    build: () => ({
      message: 'Сгибай колени — опускай таз, а не только плечи',
      focus: ['hips', 'legs'],
      arrow: 'down',
    }),
  },
  {
    id: 'CROUCH_INSUFFICIENT',
    expects: ['CROUCH'],
    priority: 60,
    verdict: 'near',
    metric: 'Глубина приседа',
    when: (ctx) => ctx.f.crouchDepth >= CROUCH.near,
    build: (ctx) => ({
      message: 'Присядь глубже — ещё немного вниз',
      focus: ctx.baseline.mode === 'full' ? ['hips', 'legs'] : ['shoulders', 'torso'],
      arrow: 'down',
    }),
  },
  {
    id: 'CROUCH_IDLE',
    expects: ['CROUCH'],
    priority: 0,
    verdict: 'idle',
    metric: 'Глубина приседа',
    when: () => true,
    build: () => ({ message: 'Присядь — опусти плечи вниз', focus: ['hips', 'torso'], arrow: 'down' }),
  },

  // ─── CENTER (return to neutral) ──────────────────────────────────────
  {
    id: 'CENTER_OK',
    expects: ['CENTER'],
    priority: 100,
    verdict: 'correct',
    metric: 'Центровка',
    when: (ctx) => Math.abs(ctx.f.leanX) < GESTURE_CONFIG.center.tolerance,
    build: () => ({ message: 'Ровно по центру — так держать', focus: ['shoulders', 'torso'], arrow: null }),
  },
  {
    id: 'CENTER_OFF',
    expects: ['CENTER'],
    priority: 50,
    verdict: 'wrong',
    metric: 'Центровка',
    when: () => true,
    build: (ctx) => ({
      message: `Верни корпус в центр — сместись ${ctx.f.leanX < 0 ? 'правее' : 'левее'}`,
      focus: ['shoulders', 'torso'],
      arrow: ctx.f.leanX < 0 ? 'right' : 'left',
    }),
  },
];
