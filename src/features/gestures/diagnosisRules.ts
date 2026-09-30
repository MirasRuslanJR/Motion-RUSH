import { GESTURE_CONFIG } from '../../config/gesture.config';
import type { BodyPart } from '../tracking/landmarks';
import type { Baseline } from './calibration';
import type { BodyFeatures } from './FeatureExtractor';
import type { Classification, GestureReading } from './GestureClassifier';
import type { Arrow, ControlScheme, ExpectedMotion } from './types';

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
  scheme: ControlScheme;
  f: BodyFeatures;
  c: Classification;
  baseline: Baseline;
  /** Reading of the expected gesture (null for CENTER). */
  reading: GestureReading | null;
  /** -1 = left, 1 = right, 0 = n/a — for lateral wording. */
  dir: -1 | 0 | 1;
  /** Sideways offset of the body in this scheme (hips when standing, shoulders when seated), SW. */
  lateral: number;
}

export interface RuleOutput {
  message: string;
  focus: BodyPart[];
  arrow: Arrow | null;
}

export interface DiagnosisRule {
  id: string;
  expects: readonly ExpectedMotion[];
  /** Control schemes the rule applies to (default: both). */
  schemes?: readonly ControlScheme[];
  /** Higher = evaluated first. The first matching rule wins. */
  priority: number;
  verdict: Verdict;
  when: (ctx: RuleContext) => boolean;
  build: (ctx: RuleContext) => RuleOutput;
}

const LEAN = GESTURE_CONFIG.lean;
const JUMP = GESTURE_CONFIG.jump;
const CROUCH = GESTURE_CONFIG.crouch;
const BODY = GESTURE_CONFIG.body;

const SEATED = ['seated'] as const;
const STANDING = ['body'] as const;
const LEANS = ['LEAN_LEFT', 'LEAN_RIGHT'] as const;

const toward = (dir: number) => (dir < 0 ? 'влево' : 'вправо');
const further = (dir: number) => (dir < 0 ? 'левее' : 'правее');
const sideArrow = (dir: number): Arrow => (dir < 0 ? 'left' : 'right');
const body = (ctx: RuleContext) => ctx.scheme === 'body';
/** How to move sideways in this scheme: "шагни" (whole body) or "наклонись" (seated). */
const move = (ctx: RuleContext) => (body(ctx) ? 'шагни' : 'наклонись');
const lateralFocus = (ctx: RuleContext): BodyPart[] => (body(ctx) ? ['hips', 'legs'] : ['shoulders', 'torso']);
const legsFocus: BodyPart[] = ['hips', 'legs'];

/** Lateral shift toward the requested side, in SW (scheme-aware). */
const towardShift = (ctx: RuleContext) => ctx.dir * ctx.lateral;
const metric = (ctx: RuleContext) => ctx.reading?.metric ?? 0;
const near = (ctx: RuleContext) => ctx.reading?.thresholds.near ?? 0;

const lowerHand = (f: BodyFeatures) => (f.leftHandLiftEffective <= f.rightHandLiftEffective ? 'left' : 'right');
const higherLift = (f: BodyFeatures) => Math.max(f.leftHandLiftEffective, f.rightHandLiftEffective);
const lowerLift = (f: BodyFeatures) => Math.min(f.leftHandLiftEffective, f.rightHandLiftEffective);
const armPart = (side: 'left' | 'right'): BodyPart => (side === 'left' ? 'leftArm' : 'rightArm');
const handName = (side: 'left' | 'right') => (side === 'left' ? 'левую' : 'правую');
const handNameNom = (side: 'left' | 'right') => (side === 'left' ? 'Левая' : 'Правая');

/**
 * Rule table: condition → diagnosis → instruction → priority.
 * Every condition reads real landmark-derived features; the instruction names
 * the body part, the direction and (via the metric bar) how much is missing.
 */
export const DIAGNOSIS_RULES: readonly DiagnosisRule[] = [
  // ─── JUMP ────────────────────────────────────────────────────────────
  {
    id: 'JUMP_OK',
    expects: ['JUMP'],
    priority: 100,
    verdict: 'correct',
    when: (ctx) => ctx.c.readings.JUMP.active,
    build: (ctx) =>
      body(ctx)
        ? { message: 'Есть прыжок!', focus: legsFocus, arrow: null }
        : { message: 'Есть прыжок — руки над головой!', focus: ['leftArm', 'rightArm'], arrow: null },
  },
  {
    id: 'JUMP_DOING_CROUCH',
    expects: ['JUMP'],
    priority: 90,
    verdict: 'other',
    when: (ctx) => ctx.c.readings.CROUCH.active && (body(ctx) ? metric(ctx) < near(ctx) : higherLift(ctx.f) < JUMP.near),
    build: (ctx) =>
      body(ctx)
        ? { message: 'Это присед. Оттолкнись и подпрыгни вверх', focus: legsFocus, arrow: 'up' }
        : { message: 'Это присед. Для прыжка выпрямись и подними обе руки вверх', focus: ['leftArm', 'rightArm'], arrow: 'up' },
  },
  {
    id: 'JUMP_ARMS_ONLY',
    expects: ['JUMP'],
    schemes: STANDING,
    priority: 85,
    verdict: 'other',
    when: (ctx) => higherLift(ctx.f) >= BODY.jump.armsOnlyLift && metric(ctx) < near(ctx),
    build: () => ({ message: 'Руки не считаются — подпрыгни всем телом!', focus: legsFocus, arrow: 'up' }),
  },
  {
    id: 'JUMP_TOO_LOW',
    expects: ['JUMP'],
    schemes: STANDING,
    priority: 60,
    verdict: 'near',
    when: (ctx) => metric(ctx) >= near(ctx),
    build: () => ({ message: 'Прыжок низковат — оттолкнись сильнее', focus: legsFocus, arrow: 'up' }),
  },
  {
    id: 'JUMP_HANDS_OUT_OF_FRAME',
    expects: ['JUMP'],
    schemes: SEATED,
    priority: 85,
    verdict: 'near',
    when: (ctx) =>
      !ctx.f.leftWristVisible &&
      !ctx.f.rightWristVisible &&
      Math.max(ctx.f.leftElbowLift, ctx.f.rightElbowLift) > 0 &&
      !ctx.c.readings.JUMP.active,
    build: () => ({ message: 'Кисти выходят за верх кадра — отойди на шаг назад', focus: ['leftArm', 'rightArm'], arrow: null }),
  },
  {
    id: 'JUMP_ONE_HAND',
    expects: ['JUMP'],
    schemes: SEATED,
    priority: 80,
    verdict: 'wrong',
    when: (ctx) => higherLift(ctx.f) >= JUMP.activation && lowerLift(ctx.f) < JUMP.near,
    build: (ctx) => {
      const side = lowerHand(ctx.f);
      return { message: `Подними и ${handName(side)} руку — нужны обе руки над головой`, focus: [armPart(side)], arrow: 'up' };
    },
  },
  {
    id: 'JUMP_ONE_HAND_LOW',
    expects: ['JUMP'],
    schemes: SEATED,
    priority: 75,
    verdict: 'near',
    when: (ctx) => higherLift(ctx.f) >= JUMP.activation && lowerLift(ctx.f) >= JUMP.near,
    build: (ctx) => {
      const side = lowerHand(ctx.f);
      return { message: `${handNameNom(side)} рука ниже цели — подними её выше головы`, focus: [armPart(side)], arrow: 'up' };
    },
  },
  {
    id: 'JUMP_ELBOWS_BENT',
    expects: ['JUMP'],
    schemes: SEATED,
    priority: 70,
    verdict: 'near',
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
    schemes: SEATED,
    priority: 60,
    verdict: 'near',
    when: (ctx) => lowerLift(ctx.f) >= JUMP.near,
    build: (ctx) => ({
      message: lowerLift(ctx.f) < 0.12 ? 'Руки на уровне плеч — подними их выше головы' : 'Почти! Тянись руками ещё выше',
      focus: ['leftArm', 'rightArm'],
      arrow: 'up',
    }),
  },
  {
    id: 'JUMP_IDLE',
    expects: ['JUMP'],
    priority: 0,
    verdict: 'idle',
    when: () => true,
    build: (ctx) =>
      body(ctx)
        ? { message: 'Подпрыгни — оторвись от пола', focus: legsFocus, arrow: 'up' }
        : { message: 'Подними обе руки над головой', focus: ['leftArm', 'rightArm'], arrow: 'up' },
  },

  // ─── SIDEWAYS (step when standing, lean when seated) ─────────────────
  {
    id: 'LEAN_OK',
    expects: LEANS,
    priority: 100,
    verdict: 'correct',
    when: (ctx) => ctx.reading?.active === true,
    build: (ctx) => ({
      message: body(ctx) ? `Есть! Ты в ${ctx.dir < 0 ? 'левой' : 'правой'} полосе` : `Есть! Держи наклон ${toward(ctx.dir)}`,
      focus: lateralFocus(ctx),
      arrow: null,
    }),
  },
  {
    id: 'LEAN_WRONG_DIRECTION',
    expects: LEANS,
    priority: 90,
    verdict: 'wrong',
    when: (ctx) => towardShift(ctx) <= -near(ctx) * 1.5,
    build: (ctx) => ({
      message: `Не в ту сторону — ${move(ctx)} ${toward(ctx.dir).toUpperCase()}`,
      focus: lateralFocus(ctx),
      arrow: sideArrow(ctx.dir),
    }),
  },
  {
    id: 'LEAN_DOING_CROUCH',
    expects: LEANS,
    priority: 85,
    verdict: 'other',
    when: (ctx) => ctx.c.readings.CROUCH.active && towardShift(ctx) < near(ctx),
    build: (ctx) => ({
      message: `Приседать не нужно — ${move(ctx)} ${toward(ctx.dir)}`,
      focus: lateralFocus(ctx),
      arrow: sideArrow(ctx.dir),
    }),
  },
  {
    id: 'LEAN_DOING_JUMP',
    expects: LEANS,
    priority: 84,
    verdict: 'other',
    when: (ctx) => ctx.c.readings.JUMP.active && towardShift(ctx) < near(ctx),
    build: (ctx) => ({
      message: body(ctx) ? `Прыгать не нужно — шагни ${toward(ctx.dir)}` : `Руки тут не помогут — наклони корпус ${toward(ctx.dir)}`,
      focus: lateralFocus(ctx),
      arrow: sideArrow(ctx.dir),
    }),
  },
  {
    id: 'LEAN_SHOULDERS_ONLY',
    expects: LEANS,
    schemes: STANDING,
    priority: 80,
    verdict: 'wrong',
    when: (ctx) => ctx.dir * ctx.f.leanX >= BODY.step.shouldersOnlyShift && towardShift(ctx) < near(ctx),
    build: (ctx) => ({
      message: `Двигаются только плечи — шагни ${toward(ctx.dir)} всем телом`,
      focus: ['hips', 'legs', 'shoulders'],
      arrow: sideArrow(ctx.dir),
    }),
  },
  {
    id: 'LEAN_HEAD_ONLY',
    expects: LEANS,
    schemes: SEATED,
    priority: 80,
    verdict: 'wrong',
    when: (ctx) => ctx.dir * ctx.f.headX >= LEAN.headOnlyHeadShift && towardShift(ctx) < LEAN.headOnlyShoulderShift,
    build: (ctx) => ({
      message: `Наклоняется только голова — сдвинь плечи ${toward(ctx.dir)} вместе с корпусом`,
      focus: ['shoulders', 'head'],
      arrow: sideArrow(ctx.dir),
    }),
  },
  {
    id: 'LEAN_TURNED',
    expects: LEANS,
    priority: 75,
    verdict: 'wrong',
    when: (ctx) => ctx.f.scaleRatio < LEAN.turnedScaleRatio,
    build: (ctx) => ({
      message: `Ты развернулся боком — встань лицом к камере и ${move(ctx)} ${toward(ctx.dir)}`,
      focus: ['shoulders'],
      arrow: sideArrow(ctx.dir),
    }),
  },
  {
    id: 'LEAN_INSUFFICIENT',
    expects: LEANS,
    priority: 60,
    verdict: 'near',
    when: (ctx) => towardShift(ctx) >= near(ctx),
    build: (ctx) => ({
      message: body(ctx)
        ? `Шагни ещё ${further(ctx.dir)} — всем телом`
        : `Наклон недостаточный — сместись ещё ${further(ctx.dir)}`,
      focus: lateralFocus(ctx),
      arrow: sideArrow(ctx.dir),
    }),
  },
  {
    id: 'LEAN_IDLE',
    expects: LEANS,
    priority: 0,
    verdict: 'idle',
    when: () => true,
    build: (ctx) => ({
      message: body(ctx) ? `Шагни ${toward(ctx.dir)} всем телом` : `Наклони корпус ${toward(ctx.dir)}`,
      focus: lateralFocus(ctx),
      arrow: sideArrow(ctx.dir),
    }),
  },

  // ─── CROUCH / SQUAT ──────────────────────────────────────────────────
  {
    id: 'CROUCH_OK',
    expects: ['CROUCH'],
    priority: 100,
    verdict: 'correct',
    when: (ctx) => ctx.c.readings.CROUCH.active,
    build: () => ({ message: 'Отлично — ты под лучом!', focus: ['hips', 'torso'], arrow: null }),
  },
  {
    id: 'CROUCH_DOING_JUMP',
    expects: ['CROUCH'],
    priority: 90,
    verdict: 'other',
    when: (ctx) => ctx.c.readings.JUMP.active || (!body(ctx) && higherLift(ctx.f) >= JUMP.activation),
    build: (ctx) =>
      body(ctx)
        ? { message: 'Не прыгай — присядь и опусти таз', focus: legsFocus, arrow: 'down' }
        : { message: 'Руки вниз — под лучом нужно присесть, а не прыгать', focus: ['leftArm', 'rightArm'], arrow: 'down' },
  },
  {
    id: 'CROUCH_BOW',
    expects: ['CROUCH'],
    schemes: STANDING,
    priority: 80,
    verdict: 'wrong',
    when: (ctx) => ctx.f.crouchDepth >= BODY.squat.bowShoulderDrop && metric(ctx) < near(ctx),
    build: () => ({ message: 'Не наклоняйся — сгибай колени и опускай таз', focus: legsFocus, arrow: 'down' }),
  },
  {
    id: 'CROUCH_HEAD_ONLY',
    expects: ['CROUCH'],
    schemes: SEATED,
    priority: 80,
    verdict: 'wrong',
    when: (ctx) => ctx.f.noseDrop >= CROUCH.headOnlyNoseDrop && ctx.f.crouchDepth < CROUCH.near,
    build: () => ({ message: 'Опускается только голова — присядь всем корпусом', focus: ['head', 'shoulders'], arrow: 'down' }),
  },
  {
    id: 'CROUCH_OFF_CENTER',
    expects: ['CROUCH'],
    priority: 75,
    verdict: 'wrong',
    when: (ctx) =>
      metric(ctx) >= near(ctx) && Math.abs(ctx.lateral) >= (body(ctx) ? BODY.squat.maxLateralDrift : CROUCH.maxLateralDrift),
    build: () => ({ message: 'Сделай присед ниже, сохраняя корпус по центру', focus: ['torso', 'hips'], arrow: 'down' }),
  },
  {
    id: 'CROUCH_INSUFFICIENT',
    expects: ['CROUCH'],
    priority: 60,
    verdict: 'near',
    when: (ctx) => metric(ctx) >= near(ctx),
    build: (ctx) =>
      body(ctx)
        ? { message: 'Присядь глубже — таз ниже', focus: legsFocus, arrow: 'down' }
        : { message: 'Присядь глубже — ещё немного вниз', focus: ['shoulders', 'torso'], arrow: 'down' },
  },
  {
    id: 'CROUCH_IDLE',
    expects: ['CROUCH'],
    priority: 0,
    verdict: 'idle',
    when: () => true,
    build: (ctx) =>
      body(ctx)
        ? { message: 'Присядь — опусти таз', focus: legsFocus, arrow: 'down' }
        : { message: 'Присядь — опусти плечи вниз', focus: ['hips', 'torso'], arrow: 'down' },
  },

  // ─── CENTER (return to neutral) ──────────────────────────────────────
  {
    id: 'CENTER_OK',
    expects: ['CENTER'],
    priority: 100,
    verdict: 'correct',
    when: (ctx) => Math.abs(ctx.lateral) < GESTURE_CONFIG.center.tolerance,
    build: (ctx) => ({ message: 'Ровно по центру — так держать', focus: lateralFocus(ctx), arrow: null }),
  },
  {
    id: 'CENTER_OFF',
    expects: ['CENTER'],
    priority: 50,
    verdict: 'wrong',
    when: () => true,
    build: (ctx) => ({
      message: body(ctx)
        ? `Вернись в центр — шагни ${ctx.lateral < 0 ? 'правее' : 'левее'}`
        : `Верни корпус в центр — сместись ${ctx.lateral < 0 ? 'правее' : 'левее'}`,
      focus: lateralFocus(ctx),
      arrow: ctx.lateral < 0 ? 'right' : 'left',
    }),
  },
];

/** Caption of the live progress meter for the expected motion. */
export function metricCaption(expected: ExpectedMotion, scheme: ControlScheme): string {
  switch (expected) {
    case 'JUMP':
      return scheme === 'body' ? 'Высота прыжка' : 'Высота рук';
    case 'LEAN_LEFT':
    case 'LEAN_RIGHT':
      return scheme === 'body' ? 'Шаг в сторону' : 'Наклон корпуса';
    case 'CROUCH':
      return 'Глубина приседа';
    case 'CENTER':
      return 'Центровка';
  }
}
