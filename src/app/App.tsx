import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { DebugPanel } from '../components/DebugPanel';
import { TopBar } from '../components/TopBar';
import { classifyCameraError, type CameraErrorKind } from '../features/camera/cameraErrors';
import { MotionEngine } from '../features/engine/MotionEngine';
import type { SessionResult } from '../features/gameplay/types';
import { getMode, type GameModeId } from '../features/modes/modes';
import { DuelRoom, newRoomCode, normalizeRoomCode } from '../features/online/DuelRoom';
import { QuickMatch } from '../features/online/QuickMatch';
import { ONLINE_ENABLED } from '../lib/supabase';
import { loadPoseBackend } from '../features/tracking/poseBackend';
import { computeSessionStats } from '../features/results/sessionStats';
import { useMotionUi } from '../hooks/useEngine';
import { sfx } from '../lib/audio/sfx';
import { DEBUG } from '../lib/env';
import { loadProfile, recordAchievements, recordSession, saveMuted, type Profile, type RecordedSession } from '../lib/storage';
import { runnerFacts, type AchievementId, type SessionFacts } from '../features/achievements/achievements';
import { AchievementToast } from '../components/AchievementToast';
import { ArcadeScreen, type ArcadeRunResult } from '../screens/arcade/ArcadeScreen';
import { CalibrationScreen } from '../screens/CalibrationScreen';
import { CameraCheckScreen } from '../screens/CameraCheckScreen';
import { CameraErrorScreen } from '../screens/CameraErrorScreen';
import { DanceScreen, type DanceRunResult } from '../screens/dance/DanceScreen';
import { DuelLobbyScreen } from '../screens/DuelLobbyScreen';
import { GameScreen } from '../screens/game/GameScreen';
import { LeaderboardScreen } from '../screens/LeaderboardScreen';
import { MenuScreen } from '../screens/menu/MenuScreen';
import { PermissionScreen } from '../screens/PermissionScreen';
import { ResultsScreen } from '../screens/results/ResultsScreen';
import { TutorialScreen } from '../screens/TutorialScreen';
import { VersusScreen } from '../screens/versus/VersusScreen';
import { flowReducer, INITIAL_FLOW, type Phase } from './flow';

/** Phases during which an online room stays open. */
const ROOM_PHASES: readonly Phase[] = ['lobby', 'game', 'results', 'leaderboard'];

/** Routes runtime camera/model failures (e.g. camera unplugged mid-game) into the flow. */
function EngineWatcher({ engine, onFail }: { engine: MotionEngine; onFail: (kind: CameraErrorKind) => void }) {
  const camera = useMotionUi(engine, (s) => s.camera);
  const error = useMotionUi(engine, (s) => s.cameraError);
  useEffect(() => {
    if (camera === 'error' && error) onFail(error);
  }, [camera, error, onFail]);
  return null;
}

export function App() {
  const [flow, dispatch] = useReducer(flowReducer, INITIAL_FLOW);
  const [engine, setEngine] = useState<MotionEngine | null>(null);
  const engineRef = useRef<MotionEngine | null>(null);
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const [muted, setMuted] = useState(profile.muted);
  const [recorded, setRecorded] = useState<RecordedSession | null>(null);
  const [room, setRoom] = useState<DuelRoom | null>(null);
  const roomRef = useRef<DuelRoom | null>(null);
  /** Invite link: ?room=CODE opens the duel lobby with that code once the camera is set up. */
  const [inviteCode] = useState(() => normalizeRoomCode(new URLSearchParams(location.search).get('room') ?? ''));

  const replaceRoom = useCallback((next: DuelRoom | null) => {
    void roomRef.current?.leave();
    roomRef.current = next;
    setRoom(next);
    if (next) void next.connect();
  }, []);

  // Leaving the duel flow (menu, recalibration, home) closes the online room.
  useEffect(() => {
    if (roomRef.current && (flow.mode !== 'duel' || !ROOM_PHASES.includes(flow.phase))) replaceRoom(null);
  }, [flow.mode, flow.phase, replaceRoom]);

  // Preload the pose model while the player looks around the menu.
  useEffect(() => {
    void loadPoseBackend().catch(() => undefined);
  }, []);

  useEffect(() => {
    sfx.setMuted(muted);
  }, [muted]);

  // Every step starts at the top (matters on phones where setup screens scroll).
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [flow.phase]);

  // Release the camera when the page goes away.
  useEffect(() => {
    const release = () => {
      engineRef.current?.dispose();
      void roomRef.current?.leave();
    };
    window.addEventListener('pagehide', release);
    return () => window.removeEventListener('pagehide', release);
  }, []);

  const replaceEngine = useCallback((next: MotionEngine | null) => {
    engineRef.current?.dispose();
    engineRef.current = next;
    setEngine(next);
  }, []);

  /** Turns the camera on (a new engine); the flow moves on when it is live or has failed. */
  const startCamera = useCallback(() => {
    sfx.unlock();
    const next = new MotionEngine();
    replaceEngine(next);
    next
      .start()
      .then(() => {
        if (engineRef.current === next) dispatch({ type: 'CAMERA_READY' });
      })
      .catch((error: unknown) => {
        if (engineRef.current === next) dispatch({ type: 'CAMERA_FAILED', kind: classifyCameraError(error) });
      });
  }, [replaceEngine]);

  const cameraOn = useCallback(() => engineRef.current?.ui.get().camera === 'live', []);
  /** Plays a mode from the menu: right away once the camera is set up, after the setup otherwise. */
  const onPlay = useCallback(
    (mode: GameModeId) => {
      sfx.unlock();
      const on = cameraOn();
      if (!on && !engineRef.current) startCamera();
      dispatch({ type: 'PLAY', mode, cameraOn: on });
    },
    [cameraOn, startCamera],
  );
  const onTutorial = useCallback(() => {
    sfx.unlock();
    const on = cameraOn();
    if (!on && !engineRef.current) startCamera();
    dispatch({ type: 'TUTORIAL', cameraOn: on });
  }, [cameraOn, startCamera]);
  const onRetry = useCallback(() => {
    dispatch({ type: 'RETRY' });
    startCamera();
  }, [startCamera]);

  const onCameraFail = useCallback((kind: CameraErrorKind) => dispatch({ type: 'CAMERA_FAILED', kind }), []);
  const onCheckPassed = useCallback(() => dispatch({ type: 'CHECK_PASSED' }), []);
  const onCalibrated = useCallback(() => dispatch({ type: 'CALIBRATED' }), []);
  const onTutorialDone = useCallback(() => dispatch({ type: 'TUTORIAL_DONE' }), []);
  const onPlayAgain = useCallback(() => {
    sfx.play('confirm');
    void roomRef.current?.rematch();
    dispatch({ type: 'PLAY_AGAIN' });
  }, []);
  const onRecalibrate = useCallback(() => dispatch({ type: 'RECALIBRATE' }), []);
  const onModes = useCallback(() => dispatch({ type: 'MENU' }), []);
  const onLeaderboard = useCallback(() => dispatch({ type: 'LEADERBOARD' }), []);
  const onBack = useCallback(() => dispatch({ type: 'BACK' }), []);
  const onDuelStart = useCallback((seed: number) => dispatch({ type: 'DUEL_START', seed }), []);

  const openRoom = useCallback(
    (code: string) => {
      const me = loadProfile();
      replaceRoom(new DuelRoom(code, { id: me.playerId, name: me.nickname, scheme: engineRef.current?.ui.get().scheme ?? 'body' }));
    },
    [replaceRoom],
  );
  const onCreateRoom = useCallback(() => openRoom(newRoomCode()), [openRoom]);
  const [searching, setSearching] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const quickRef = useRef<QuickMatch | null>(null);
  const cancelQuick = useCallback(() => {
    void quickRef.current?.cancel();
    quickRef.current = null;
    setSearching(false);
  }, []);
  const onQuickMatch = useCallback(() => {
    const me = loadProfile();
    const quick = new QuickMatch({ id: me.playerId, name: me.nickname });
    quickRef.current = quick;
    setSearching(true);
    setQuickError(null);
    void quick.find().then((code) => {
      if (quickRef.current !== quick) return;
      quickRef.current = null;
      setSearching(false);
      if (code) openRoom(code);
      else setQuickError('Не удалось подключиться к онлайну — проверь интернет');
    });
  }, [openRoom]);
  // Leaving the lobby stops the search.
  useEffect(() => {
    if (flow.phase !== 'lobby' && quickRef.current) cancelQuick();
  }, [flow.phase, cancelQuick]);
  const onLeaveRoom = useCallback(() => {
    if (roomRef.current) replaceRoom(null);
    else dispatch({ type: 'MENU' });
  }, [replaceRoom]);

  /** Achievements unlocked by the last game, shown for a few seconds over any screen. */
  const [fresh, setFresh] = useState<{ id: number; list: AchievementId[] } | null>(null);
  const clearFresh = useCallback(() => setFresh(null), []);
  /** Every finished game counts towards the achievements (after its own record is saved). */
  const unlock = useCallback((facts: SessionFacts) => {
    const { profile: next, unlocked } = recordAchievements(facts);
    setProfile(next);
    if (unlocked.length > 0) {
      setFresh({ id: Date.now(), list: unlocked });
      sfx.play('combo');
    }
  }, []);

  const onFinish = useCallback((result: SessionResult) => {
    if (getMode(result.mode).ranked) {
      const stats = computeSessionStats(result);
      const saved = recordSession(result.mode, {
        score: result.score,
        accuracy: stats.accuracy,
        bestCombo: result.bestCombo,
        outcome: result.outcome,
        date: new Date().toISOString(),
      });
      setRecorded(saved);
      setProfile(saved.profile);
    } else {
      setRecorded(null);
    }
    unlock(runnerFacts(result));
    dispatch({ type: 'GAME_OVER', result });
  }, [unlock]);

  const onDanceRecord = useCallback((run: DanceRunResult): RecordedSession | null => {
    if (!getMode(run.mode).ranked) {
      unlock({ dodges: 0, perfectStreak: 0, durationMs: 0, score: run.score });
      return null;
    }
    const saved = recordSession(run.mode, {
      score: run.score,
      accuracy: run.accuracy,
      bestCombo: run.bestCombo,
      outcome: 'complete',
      date: new Date().toISOString(),
    });
    setProfile(saved.profile);
    unlock({ dodges: 0, perfectStreak: 0, durationMs: 0, score: run.score });
    return saved;
  }, [unlock]);

  /** Mini-games: a record on this device, kept apart from the overall best score. */
  const onArcadeRecord = useCallback((run: ArcadeRunResult): RecordedSession => {
    const saved = recordSession(
      run.mode,
      { score: run.score, accuracy: run.accuracy, bestCombo: run.bestCombo, outcome: 'complete', date: new Date().toISOString() },
      { countsForProfile: false },
    );
    setProfile(saved.profile);
    unlock(run.facts);
    return saved;
  }, [unlock]);

  /** The logo goes to the main menu; the camera stays on, so the next game starts right away. */
  const goHome = useCallback(() => {
    setProfile(loadProfile());
    dispatch({ type: 'MENU' });
  }, []);

  const toggleMute = useCallback(() => {
    sfx.unlock();
    setMuted((m) => {
      saveMuted(!m);
      return !m;
    });
  }, []);

  let screen: ReactNode = null;
  switch (flow.phase) {
    case 'menu':
      screen = (
        <MenuScreen
          engine={engine}
          ready={flow.ready}
          profile={profile}
          lastMode={flow.mode}
          invite={inviteCode.length === 4 && ONLINE_ENABLED ? inviteCode : null}
          muted={muted}
          onToggleMute={toggleMute}
          onPlay={onPlay}
          onTutorial={onTutorial}
          onLeaderboard={onLeaderboard}
          onProfile={setProfile}
        />
      );
      break;
    case 'leaderboard':
      screen = <LeaderboardScreen profile={profile} initialMode={flow.mode} onBack={onBack} />;
      break;
    case 'permission':
      screen = <PermissionScreen />;
      break;
    case 'camera-error':
      screen = <CameraErrorScreen kind={flow.errorKind ?? 'unknown'} onRetry={onRetry} />;
      break;
    case 'check':
      if (engine) screen = <CameraCheckScreen engine={engine} onReady={onCheckPassed} />;
      break;
    case 'calibration':
      if (engine) screen = <CalibrationScreen engine={engine} onDone={onCalibrated} />;
      break;
    case 'tutorial':
      if (engine) screen = <TutorialScreen engine={engine} onDone={onTutorialDone} />;
      break;
    case 'dance':
      if (engine) {
        screen = (
          <DanceScreen
            key={flow.runId}
            engine={engine}
            mode={getMode(flow.mode)}
            difficulty={profile.difficulty}
            profile={profile}
            onRecord={onDanceRecord}
            onProfile={setProfile}
            onAgain={onPlayAgain}
            onModes={onModes}
            onLeaderboard={onLeaderboard}
          />
        );
      }
      break;
    case 'versus':
      if (engine) screen = <VersusScreen key={flow.runId} engine={engine} mode={getMode(flow.mode)} difficulty={profile.difficulty} onAgain={onPlayAgain} onModes={onModes} />;
      break;
    case 'arcade':
      if (engine) {
        screen = (
          <ArcadeScreen
            key={flow.runId}
            engine={engine}
            mode={getMode(flow.mode)}
            difficulty={profile.difficulty}
            profile={profile}
            onRecord={onArcadeRecord}
            onAgain={onPlayAgain}
            onModes={onModes}
          />
        );
      }
      break;
    case 'lobby':
      if (engine) {
        screen = (
          <DuelLobbyScreen
            engine={engine}
            room={room}
            initialCode={inviteCode}
            searching={searching}
            notice={quickError}
            onQuick={onQuickMatch}
            onCancelQuick={cancelQuick}
            onCreate={onCreateRoom}
            onJoin={openRoom}
            onLeave={onLeaveRoom}
            onStart={onDuelStart}
          />
        );
      }
      break;
    case 'game':
      if (engine) {
        screen = (
          <GameScreen
            key={flow.runId}
            engine={engine}
            mode={getMode(flow.mode)}
            difficulty={profile.difficulty}
            sharedSeed={flow.duelSeed}
            duel={flow.mode === 'duel' ? room : null}
            onFinish={onFinish}
          />
        );
      }
      break;
    case 'results':
      if (engine && flow.result) {
        screen = (
          <ResultsScreen
            engine={engine}
            result={flow.result}
            mode={getMode(flow.result.mode)}
            recorded={recorded}
            profile={profile}
            duel={flow.mode === 'duel' ? room : null}
            onProfile={setProfile}
            onPlayAgain={onPlayAgain}
            onModes={onModes}
            onRecalibrate={onRecalibrate}
            onLeaderboard={onLeaderboard}
          />
        );
      }
      break;
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className={`app app--${flow.phase}`}>
        {flow.phase !== 'menu' && <TopBar phase={flow.phase} muted={muted} onToggleMute={toggleMute} onHome={goHome} />}
        <div className="app__screens">
          <AnimatePresence initial={false}>
            <motion.div
              key={flow.phase === 'game' || flow.phase === 'dance' || flow.phase === 'versus' || flow.phase === 'arcade' ? `${flow.phase}-${flow.runId}` : flow.phase}
              className="app__screen"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {screen}
            </motion.div>
          </AnimatePresence>
        </div>
        {engine && flow.phase !== 'camera-error' && <EngineWatcher engine={engine} onFail={onCameraFail} />}
        <AchievementToast fresh={fresh} onDone={clearFresh} />
        {DEBUG && engine && <DebugPanel engine={engine} />}
      </div>
    </MotionConfig>
  );
}
