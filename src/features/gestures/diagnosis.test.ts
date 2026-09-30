import { describe, expect, it } from 'vitest';
import { analyse, BODY_FIXTURES, calibrate, FIXTURES } from '../../test/fixtures';
import { diagnose, HintScheduler, type Diagnosis } from './ErrorDiagnosisEngine';
import type { ExpectedMotion } from './types';

const full = calibrate(true);
const upper = calibrate(false);

function seated(fixture: keyof typeof FIXTURES, expected: ExpectedMotion): Diagnosis {
  const { f, c } = analyse(FIXTURES[fixture], upper);
  return diagnose(expected, f, c, upper);
}

function standing(fixture: keyof typeof BODY_FIXTURES, expected: ExpectedMotion): Diagnosis {
  const { f, c } = analyse(BODY_FIXTURES[fixture], full);
  return diagnose(expected, f, c, full);
}

describe('error diagnosis — body scheme (whole body)', () => {
  it.each([
    ['validStepLeft', 'LEAN_LEFT', 'LEAN_OK', 'correct'],
    ['almostStepLeft', 'LEAN_LEFT', 'LEAN_INSUFFICIENT', 'near'],
    ['shouldersOnlyLeft', 'LEAN_LEFT', 'LEAN_SHOULDERS_ONLY', 'wrong'],
    ['validStepRight', 'LEAN_LEFT', 'LEAN_WRONG_DIRECTION', 'wrong'],
    ['neutral', 'LEAN_RIGHT', 'LEAN_IDLE', 'idle'],
    ['validRealJump', 'JUMP', 'JUMP_OK', 'correct'],
    ['lowJump', 'JUMP', 'JUMP_TOO_LOW', 'near'],
    ['armsOnlyJump', 'JUMP', 'JUMP_ARMS_ONLY', 'other'],
    ['validSquat', 'JUMP', 'JUMP_DOING_CROUCH', 'other'],
    ['validSquat', 'CROUCH', 'CROUCH_OK', 'correct'],
    ['almostSquat', 'CROUCH', 'CROUCH_INSUFFICIENT', 'near'],
    ['bowInsteadOfSquat', 'CROUCH', 'CROUCH_BOW', 'wrong'],
    ['validRealJump', 'CROUCH', 'CROUCH_DOING_JUMP', 'other'],
    ['neutral', 'CENTER', 'CENTER_OK', 'correct'],
    ['validStepRight', 'CENTER', 'CENTER_OFF', 'wrong'],
  ] as const)('%s while expecting %s → %s (%s)', (fixture, expected, ruleId, verdict) => {
    const d = standing(fixture, expected);
    expect(d.ruleId).toBe(ruleId);
    expect(d.verdict).toBe(verdict);
  });

  it('asks for whole-body movement, not shoulders or arms', () => {
    expect(standing('shouldersOnlyLeft', 'LEAN_LEFT').message).toContain('всем телом');
    expect(standing('armsOnlyJump', 'JUMP').message).toContain('подпрыгни');
    expect(standing('bowInsteadOfSquat', 'CROUCH').message).toContain('таз');
    expect(standing('almostStepLeft', 'LEAN_LEFT').metric).toBe('Шаг в сторону');
    expect(standing('lowJump', 'JUMP').metric).toBe('Высота прыжка');
  });
});

describe('error diagnosis — seated scheme (upper body)', () => {
  it.each([
    ['validJump', 'JUMP', 'JUMP_OK', 'correct'],
    ['almostJump', 'JUMP', 'JUMP_HANDS_LOW', 'near'],
    ['oneHandJump', 'JUMP', 'JUMP_ONE_HAND', 'wrong'],
    ['oneHandLowJump', 'JUMP', 'JUMP_ONE_HAND_LOW', 'near'],
    ['bentArmsJump', 'JUMP', 'JUMP_ELBOWS_BENT', 'near'],
    ['handsOutOfFrame', 'JUMP', 'JUMP_HANDS_OUT_OF_FRAME', 'near'],
    ['validCrouch', 'JUMP', 'JUMP_DOING_CROUCH', 'other'],
    ['neutral', 'JUMP', 'JUMP_IDLE', 'idle'],

    ['validLeftLean', 'LEAN_LEFT', 'LEAN_OK', 'correct'],
    ['invalidLeftLean', 'LEAN_LEFT', 'LEAN_INSUFFICIENT', 'near'],
    ['wrongDirectionForLeft', 'LEAN_LEFT', 'LEAN_WRONG_DIRECTION', 'wrong'],
    ['headOnlyLeft', 'LEAN_LEFT', 'LEAN_HEAD_ONLY', 'wrong'],
    ['turnedSideways', 'LEAN_LEFT', 'LEAN_TURNED', 'wrong'],
    ['validCrouch', 'LEAN_RIGHT', 'LEAN_DOING_CROUCH', 'other'],
    ['validJump', 'LEAN_RIGHT', 'LEAN_DOING_JUMP', 'other'],
    ['neutral', 'LEAN_RIGHT', 'LEAN_IDLE', 'idle'],

    ['validCrouch', 'CROUCH', 'CROUCH_OK', 'correct'],
    ['almostCrouch', 'CROUCH', 'CROUCH_INSUFFICIENT', 'near'],
    ['headOnlyCrouch', 'CROUCH', 'CROUCH_HEAD_ONLY', 'wrong'],
    ['crouchLeaning', 'CROUCH', 'CROUCH_OFF_CENTER', 'wrong'],
    ['validJump', 'CROUCH', 'CROUCH_DOING_JUMP', 'other'],

    ['neutral', 'CENTER', 'CENTER_OK', 'correct'],
    ['validRightLean', 'CENTER', 'CENTER_OFF', 'wrong'],
  ] as const)('%s while expecting %s → %s (%s)', (fixture, expected, ruleId, verdict) => {
    const d = seated(fixture, expected);
    expect(d.ruleId).toBe(ruleId);
    expect(d.verdict).toBe(verdict);
  });

  it('hints are concrete: they name the body part and the direction', () => {
    expect(seated('oneHandJump', 'JUMP').message).toContain('правую руку');
    expect(seated('oneHandJump', 'JUMP').focus).toEqual(['rightArm']);
    expect(seated('invalidLeftLean', 'LEAN_LEFT').message).toContain('левее');
    expect(seated('invalidLeftLean', 'LEAN_LEFT').arrow).toBe('left');
    expect(seated('wrongDirectionForLeft', 'LEAN_LEFT').message).toContain('ВЛЕВО');
    expect(seated('validRightLean', 'CENTER').message).toContain('левее');
    expect(seated('almostCrouch', 'CROUCH').arrow).toBe('down');
  });

  it('progress reflects how close the attempt is', () => {
    const almost = seated('almostCrouch', 'CROUCH');
    expect(almost.progress).toBeGreaterThan(0.4);
    expect(almost.progress).toBeLessThan(1);
    expect(seated('validCrouch', 'CROUCH').progress).toBe(1);
  });
});

it('never produces a generic "not recognised" message in either scheme', () => {
  const motions = ['JUMP', 'LEAN_LEFT', 'LEAN_RIGHT', 'CROUCH', 'CENTER'] as const;
  const check = (d: Diagnosis) => {
    expect(d.message.length).toBeGreaterThan(10);
    expect(d.message.toLowerCase()).not.toMatch(/не распознан|try again|unknown|not recognized/);
  };
  for (const fixture of Object.keys(FIXTURES) as (keyof typeof FIXTURES)[]) {
    for (const expected of motions) check(seated(fixture, expected));
  }
  for (const fixture of Object.keys(BODY_FIXTURES) as (keyof typeof BODY_FIXTURES)[]) {
    for (const expected of motions) check(standing(fixture, expected));
  }
});

describe('hint scheduler', () => {
  const d = (ruleId: string, verdict: Diagnosis['verdict'], expected: ExpectedMotion = 'JUMP'): Diagnosis => ({
    expected,
    verdict,
    ruleId,
    message: ruleId,
    focus: [],
    arrow: null,
    metric: '',
    progress: 0,
    timestamp: 0,
  });

  it('shows the first hint immediately, then debounces changes', () => {
    const s = new HintScheduler({ debounceMs: 200, minDisplayMs: 800 });
    expect(s.update(d('JUMP_IDLE', 'idle'), 0)).toBe(true);
    expect(s.update(d('JUMP_HANDS_LOW', 'near'), 50)).toBe(false);
    expect(s.update(d('JUMP_HANDS_LOW', 'near'), 300)).toBe(true);
    expect(s.current?.ruleId).toBe('JUMP_HANDS_LOW');
  });

  it('keeps a hint on screen for the minimum time (no flicker)', () => {
    const s = new HintScheduler({ debounceMs: 200, minDisplayMs: 800 });
    s.update(d('JUMP_HANDS_LOW', 'near'), 0);
    s.update(d('JUMP_ONE_HAND', 'wrong'), 100);
    expect(s.update(d('JUMP_ONE_HAND', 'wrong'), 400)).toBe(false);
    expect(s.update(d('JUMP_ONE_HAND', 'wrong'), 850)).toBe(true);
  });

  it('success is shown instantly', () => {
    const s = new HintScheduler({ debounceMs: 200, minDisplayMs: 800 });
    s.update(d('JUMP_HANDS_LOW', 'near'), 0);
    expect(s.update(d('JUMP_OK', 'correct'), 10)).toBe(true);
  });

  it('a new target resets immediately', () => {
    const s = new HintScheduler({ debounceMs: 200, minDisplayMs: 800 });
    s.update(d('JUMP_HANDS_LOW', 'near'), 0);
    expect(s.update(d('LEAN_IDLE', 'idle', 'LEAN_LEFT'), 10)).toBe(true);
    expect(s.update(null, 20)).toBe(true);
    expect(s.current).toBeNull();
  });
});
