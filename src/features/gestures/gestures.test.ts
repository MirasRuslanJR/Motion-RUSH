import { describe, expect, it } from 'vitest';
import { GESTURE_CONFIG } from '../../config/gesture.config';
import { analyse, BODY_FIXTURES, calibrate, FIXTURES, makePose } from '../../test/fixtures';
import { Calibrator, adaptBaselineDrift, type Baseline } from './calibration';
import { extractFeatures, extractGeometry } from './FeatureExtractor';
import { classify } from './GestureClassifier';
import { GestureStateMachine } from './GestureStateMachine';
import { buildTargetPose } from './targetPose';
import type { GestureEvent } from './types';

/** Full body visible → "body" scheme (steps, real jumps, squats). */
const full = calibrate(true);
/** Upper body only → "seated" scheme (lean, arms up, duck). */
const upper = calibrate(false);

describe('calibration', () => {
  it('captures a body-relative baseline', () => {
    expect(full.mode).toBe('full');
    expect(full.scale).toBeCloseTo(0.16, 3);
    expect(full.armLength / full.scale).toBeCloseTo(1.57, 1);
    expect(full.hipCenter).not.toBeNull();
    expect(upper.mode).toBe('upper');
    expect(upper.hipCenter).toBeNull();
  });

  it('restarts when the arms are up or the player moves', () => {
    const c = new Calibrator();
    c.push(extractGeometry(makePose()), true, 0);
    const armsUp = c.push(extractGeometry(makePose({ leftArm: 1 })), true, 33);
    expect(armsUp.issue).toBe('ARMS_UP');
    expect(armsUp.progress).toBe(0);

    c.push(extractGeometry(makePose()), true, 66);
    const moved = c.push(extractGeometry(makePose({ shift: 0.5 })), true, 99);
    expect(moved.issue).toBe('MOVING');

    const lost = c.push(null, false, 130);
    expect(lost.issue).toBe('NOT_TRACKED');
  });

  it('thresholds scale with the body: same gesture, different distance', () => {
    for (const lowerBodyVisible of [true, false]) {
      const far = new Calibrator();
      for (let t = 0; t <= 2600; t += 33) far.push(extractGeometry(makePose({ sw: 0.09, lowerBodyVisible })), true, t);
      const baseline = far.baseline as Baseline;
      const move = lowerBodyVisible ? { shift: -0.7 } : { leanDeg: -22 };
      const f = extractFeatures(makePose({ sw: 0.09, lowerBodyVisible, ...move }), baseline);
      expect(classify(f, baseline.mode).readings.LEAN_LEFT.active).toBe(true);
    }
  });

  it('slowly re-centres small drift but never absorbs a real move', () => {
    const b = calibrate(true);
    const startX = b.shoulderCenter.x;
    adaptBaselineDrift(b, extractGeometry(makePose({ shift: 0.05 })), 5000);
    expect(b.shoulderCenter.x).toBeGreaterThan(startX);
    const afterDrift = b.shoulderCenter.x;
    adaptBaselineDrift(b, extractGeometry(makePose({ shift: -0.7 })), 5000);
    expect(b.shoulderCenter.x).toBe(afterDrift);
  });
});

describe('gesture classifier — body scheme (whole body)', () => {
  it('neutral pose triggers nothing', () => {
    expect(analyse(BODY_FIXTURES.neutral, full).c.candidates).toEqual({ lateral: null, vertical: null });
  });

  it.each([
    ['validStepLeft', 'lateral', 'LEAN_LEFT'],
    ['validStepRight', 'lateral', 'LEAN_RIGHT'],
    ['validRealJump', 'vertical', 'JUMP'],
    ['validSquat', 'vertical', 'CROUCH'],
  ] as const)('%s → %s %s', (name, channel, expected) => {
    expect(analyse(BODY_FIXTURES[name], full).c.candidates[channel]).toBe(expected);
  });

  it('moving only the shoulders is NOT a step', () => {
    const { c } = analyse(BODY_FIXTURES.shouldersOnlyLeft, full);
    expect(c.candidates.lateral).toBeNull();
  });

  it('raising the arms is NOT a jump — the body has to leave the floor', () => {
    const { c } = analyse(BODY_FIXTURES.armsOnlyJump, full);
    expect(c.readings.JUMP.active).toBe(false);
  });

  it('bowing is NOT a squat — the hips have to go down', () => {
    const { c } = analyse(BODY_FIXTURES.bowInsteadOfSquat, full);
    expect(c.readings.CROUCH.active).toBe(false);
  });

  it('a jump is a fast gesture; step and jump combine on separate channels', () => {
    const { c } = analyse(BODY_FIXTURES.jumpWhileStepping, full);
    expect(c.candidates).toEqual({ lateral: 'LEAN_LEFT', vertical: 'JUMP' });
    expect(c.readings.JUMP.fast).toBe(true);
    expect(c.readings.LEAN_LEFT.fast).toBe(false);
  });
});

describe('gesture classifier — seated scheme (upper body)', () => {
  it('neutral pose triggers nothing', () => {
    expect(analyse(FIXTURES.neutral, upper).c.candidates).toEqual({ lateral: null, vertical: null });
  });

  it.each([
    ['validLeftLean', 'lateral', 'LEAN_LEFT'],
    ['validRightLean', 'lateral', 'LEAN_RIGHT'],
    ['validJump', 'vertical', 'JUMP'],
    ['validCrouch', 'vertical', 'CROUCH'],
    ['elbowsUpWristsHidden', 'vertical', 'JUMP'],
  ] as const)('%s → %s %s', (name, channel, expected) => {
    expect(analyse(FIXTURES[name], upper).c.candidates[channel]).toBe(expected);
  });

  it.each([
    ['invalidLeftLean', 'LEAN_LEFT'],
    ['almostJump', 'JUMP'],
    ['oneHandJump', 'JUMP'],
    ['almostCrouch', 'CROUCH'],
  ] as const)('%s is attempting but NOT active (%s)', (name, gesture) => {
    expect(analyse(FIXTURES[name], upper).c.readings[gesture].active).toBe(false);
  });

  it('almost-correct poses report partial progress', () => {
    const { c } = analyse(FIXTURES.almostJump, upper);
    expect(c.readings.JUMP.attempting).toBe(true);
    expect(c.readings.JUMP.progress).toBeGreaterThan(0.5);
    expect(c.readings.JUMP.progress).toBeLessThan(1);
  });

  it('resolves conflicts deterministically: arms up beats crouch on the vertical channel', () => {
    const { c } = analyse(FIXTURES.crouchWithArmsUp, upper);
    expect(c.readings.CROUCH.active).toBe(true);
    expect(c.candidates.vertical).toBe('JUMP');
  });

  it('lean and arms-up coexist on separate channels', () => {
    const { c } = analyse({ leanDeg: -22, leftArm: 1, rightArm: 1 }, upper);
    expect(c.candidates).toEqual({ lateral: 'LEAN_LEFT', vertical: 'JUMP' });
  });
});

describe('gesture state machine', () => {
  const run = (sm: GestureStateMachine, fixture: keyof typeof FIXTURES, t: number): GestureEvent[] =>
    sm.update(analyse(FIXTURES[fixture], upper).c, null, t);

  it('requires stable frames, emits once, then releases with hysteresis', () => {
    const sm = new GestureStateMachine('lateral');
    expect(run(sm, 'validLeftLean', 0)).toEqual([]);
    expect(sm.current.phase).toBe('CANDIDATE');
    expect(run(sm, 'validLeftLean', 33)).toEqual([]);
    const started = [...run(sm, 'validLeftLean', 66), ...run(sm, 'validLeftLean', 100)];
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ type: 'LEAN_LEFT', phase: 'start', source: 'pose-rules' });
    expect(sm.confirmed).toBe('LEAN_LEFT');

    // holding: no repeated events; between release and activation still held
    for (let t = 133; t < 600; t += 33) expect(run(sm, 'validLeftLean', t)).toEqual([]);
    expect(run(sm, 'holdLeftLean', 633)).toEqual([]);
    expect(sm.confirmed).toBe('LEAN_LEFT');

    const ended = run(sm, 'neutral', 666);
    expect(ended).toHaveLength(1);
    expect(ended[0]?.phase).toBe('end');
    expect(sm.current.phase).toBe('COOLDOWN');
  });

  it('rejects a single noisy frame', () => {
    const sm = new GestureStateMachine('lateral');
    run(sm, 'validLeftLean', 0);
    run(sm, 'neutral', 33);
    expect(sm.current.phase).toBe('NEUTRAL');
    expect(sm.confirmed).toBeNull();
  });

  it('confirms a real jump on its first clear frame (it only lasts ~350 ms)', () => {
    const sm = new GestureStateMachine('vertical');
    const events = sm.update(analyse(BODY_FIXTURES.validRealJump, full).c, null, 0);
    expect(events).toEqual([expect.objectContaining({ type: 'JUMP', phase: 'start' })]);
    const landed = sm.update(analyse(BODY_FIXTURES.neutral, full).c, null, 60);
    expect(landed).toEqual([expect.objectContaining({ type: 'JUMP', phase: 'end' })]);
  });

  it('cooldown blocks the same gesture but not a different one', () => {
    const sm = new GestureStateMachine('lateral');
    for (let t = 0; t <= 100; t += 33) run(sm, 'validLeftLean', t);
    run(sm, 'neutral', 133);
    run(sm, 'validLeftLean', 166);
    expect(sm.current.phase).toBe('COOLDOWN');
    run(sm, 'validRightLean', 180);
    expect(sm.current).toMatchObject({ phase: 'CANDIDATE', gesture: 'LEAN_RIGHT' });
  });

  it('a blocked gesture becomes available again after the cooldown', () => {
    const sm = new GestureStateMachine('lateral');
    for (let t = 0; t <= 100; t += 33) run(sm, 'validLeftLean', t);
    run(sm, 'neutral', 133);
    run(sm, 'validRightLean', 150);
    run(sm, 'neutral', 170);
    const cooldown = GESTURE_CONFIG.stateMachine.cooldownMs;
    run(sm, 'validLeftLean', 133 + cooldown + 10);
    expect(sm.current).toMatchObject({ phase: 'CANDIDATE', gesture: 'LEAN_LEFT' });
  });

  it('higher priority takes over a confirmed gesture', () => {
    const sm = new GestureStateMachine('vertical');
    for (let t = 0; t <= 100; t += 33) run(sm, 'validCrouch', t);
    expect(sm.confirmed).toBe('CROUCH');
    const events = run(sm, 'crouchWithArmsUp', 133);
    expect(events).toEqual([expect.objectContaining({ type: 'CROUCH', phase: 'end' })]);
    expect(sm.current).toMatchObject({ phase: 'CANDIDATE', gesture: 'JUMP' });
  });

  it('tracking loss ends a confirmed gesture', () => {
    const sm = new GestureStateMachine('vertical');
    for (let t = 0; t <= 100; t += 33) run(sm, 'validJump', t);
    const events = sm.update(null, null, 140);
    expect(events).toEqual([expect.objectContaining({ type: 'JUMP', phase: 'end' })]);
    expect(sm.current.phase).toBe('NEUTRAL');
  });
});

describe('ghost target pose', () => {
  it.each(['JUMP', 'LEAN_LEFT', 'LEAN_RIGHT', 'CROUCH'] as const)('ghost for %s satisfies the gesture in both schemes', (expected) => {
    for (const baseline of [full, upper]) {
      const pose = makePose({ lowerBodyVisible: baseline.mode === 'full' });
      const ghost = buildTargetPose(pose, expected, baseline);
      const c = classify(extractFeatures(ghost, baseline), baseline.mode);
      expect(c.readings[expected].active).toBe(true);
    }
  });
});
