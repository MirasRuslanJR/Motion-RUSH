import { describe, expect, it } from 'vitest';
import { analyse, calibrate, FIXTURES } from '../../test/fixtures';
import { diagnose, HintScheduler, type Diagnosis } from './ErrorDiagnosisEngine';
import type { ExpectedMotion } from './types';

const full = calibrate(true);
const upper = calibrate(false);

function check(fixture: keyof typeof FIXTURES, expected: ExpectedMotion, baseline = full): Diagnosis {
  const { f, c } = analyse(FIXTURES[fixture], baseline);
  return diagnose(expected, f, c, baseline);
}

describe('error diagnosis engine', () => {
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
    ['bowInsteadOfSquat', 'CROUCH', 'CROUCH_BEND_KNEES', 'near'],
    ['crouchLeaning', 'CROUCH', 'CROUCH_OFF_CENTER', 'wrong'],
    ['validJump', 'CROUCH', 'CROUCH_DOING_JUMP', 'other'],

    ['neutral', 'CENTER', 'CENTER_OK', 'correct'],
    ['validRightLean', 'CENTER', 'CENTER_OFF', 'wrong'],
  ] as const)('%s while expecting %s → %s (%s)', (fixture, expected, ruleId, verdict) => {
    const d = check(fixture, expected);
    expect(d.ruleId).toBe(ruleId);
    expect(d.verdict).toBe(verdict);
  });

  it('hints are concrete: they name the body part and the direction', () => {
    expect(check('oneHandJump', 'JUMP').message).toContain('правую руку');
    expect(check('oneHandJump', 'JUMP').focus).toEqual(['rightArm']);
    expect(check('invalidLeftLean', 'LEAN_LEFT').message).toContain('левее');
    expect(check('invalidLeftLean', 'LEAN_LEFT').arrow).toBe('left');
    expect(check('wrongDirectionForLeft', 'LEAN_LEFT').message).toContain('ВЛЕВО');
    expect(check('validRightLean', 'CENTER').message).toContain('левее');
    expect(check('almostCrouch', 'CROUCH').arrow).toBe('down');
  });

  it('never produces a generic "not recognised" message', () => {
    for (const fixture of Object.keys(FIXTURES) as (keyof typeof FIXTURES)[]) {
      for (const expected of ['JUMP', 'LEAN_LEFT', 'LEAN_RIGHT', 'CROUCH', 'CENTER'] as const) {
        const d = check(fixture, expected);
        expect(d.message.length).toBeGreaterThan(10);
        expect(d.message.toLowerCase()).not.toMatch(/не распознан|try again|unknown|not recognized/);
      }
    }
  });

  it('progress reflects how close the attempt is', () => {
    const almost = check('almostCrouch', 'CROUCH');
    expect(almost.progress).toBeGreaterThan(0.4);
    expect(almost.progress).toBeLessThan(1);
    expect(check('validCrouch', 'CROUCH').progress).toBe(1);
  });

  it('bend-knees hint only applies when hips are visible', () => {
    expect(check('bowInsteadOfSquat', 'CROUCH', upper).ruleId).not.toBe('CROUCH_BEND_KNEES');
  });
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
