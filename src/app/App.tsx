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
import { loadProfile, recordSession, saveMuted, type Profile, type RecordedSession } from '../lib/storage';
import { CalibrationScreen } from '../screens/CalibrationScreen';
import { CameraCheckScreen } from '../screens/CameraCheckScreen';
import { CameraErrorScreen } from '../screens/CameraErrorScreen';
import { DanceScreen, type DanceRunResult } from '../screens/dance/DanceScreen';
import { DuelLobbyScreen } from '../screens/DuelLobbyScreen';
import { GameScreen } from '../screens/game/GameScreen';
import { LandingScreen } from '../screens/LandingScreen';
import { LeaderboardScreen } from '../screens/LeaderboardScreen';
import { ModeSelectScreen } from '../screens/ModeSelectScreen';
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
  const inviteUsed = useRef(false);

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

  // An invited player lands in the duel lobby right after setup (a nickname is required first).
  useEffect(() => {
    if (inviteUsed.current || flow.phase !== 'modes' || inviteCode.length !== 4 || !ONLINE_ENABLED || profile.nickname.length < 2) return;
    inviteUsed.current = true;
    dispatch({ type: 'SELECT_MODE', mode: 'duel' });
  }, [flow.phase, inviteCode, profile.nickname]);

  // Preload the pose model while the player reads the landing screen.
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

  const start = useCallback(() => {
    sfx.unlock();
    dispatch({ type: 'START' });
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
  const onModes = useCallback(() => dispatch({ type: 'MODES' }), []);
  const onLeaderboard = useCallback(() => dispatch({ type: 'LEADERBOARD' }), []);
  const onBack = useCallback(() => dispatch({ type: 'BACK' }), []);
  const onSelectMode = useCallback((mode: GameModeId) => dispatch({ type: 'SELECT_MODE', mode }), []);
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
    else dispatch({ type: 'MODES' });
  }, [replaceRoom]);

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
    dispatch({ type: 'GAME_OVER', result });
  }, []);

  const onDanceRecord = useCallback((run: DanceRunResult): RecordedSession | null => {
    if (!getMode(run.mode).ranked) return null;
    const saved = recordSession(run.mode, {
      score: run.score,
      accuracy: run.accuracy,
      bestCombo: run.bestCombo,
      outcome: 'complete',
      date: new Date().toISOString(),
    });
    setProfile(saved.profile);
    return saved;
  }, []);

  const goHome = useCallback(() => {
    replaceEngine(null);
    setProfile(loadProfile());
    dispatch({ type: 'EXIT' });
  }, [replaceEngine]);

  const toggleMute = useCallback(() => {
    sfx.unlock();
    setMuted((m) => {
      saveMuted(!m);
      return !m;
    });
  }, []);

  let screen: ReactNode = null;
  switch (flow.phase) {
    case 'landing':
      screen = <LandingScreen profile={profile} onStart={start} onLeaderboard={onLeaderboard} />;
      break;
    case 'leaderboard':
      screen = <LeaderboardScreen profile={profile} initialMode={flow.mode} onBack={onBack} />;
      break;
    case 'permission':
      screen = <PermissionScreen />;
      break;
    case 'camera-error':
      screen = <CameraErrorScreen kind={flow.errorKind ?? 'unknown'} onRetry={start} />;
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
    case 'modes':
      if (engine) {
        screen = (
          <ModeSelectScreen
            engine={engine}
            profile={profile}
            initialMode={flow.mode}
            onSelect={onSelectMode}
            onLeaderboard={onLeaderboard}
            onProfile={setProfile}
          />
        );
      }
      break;
    case 'dance':
      if (engine) {
        screen = (
          <DanceScreen
            key={flow.runId}
            engine={engine}
            mode={getMode(flow.mode)}
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
      if (engine) screen = <VersusScreen key={flow.runId} engine={engine} mode={getMode(flow.mode)} onAgain={onPlayAgain} onModes={onModes} />;
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
        <TopBar phase={flow.phase} muted={muted} onToggleMute={toggleMute} onHome={goHome} />
        <div className="app__screens">
          <AnimatePresence initial={false}>
            <motion.div
              key={flow.phase === 'game' || flow.phase === 'dance' || flow.phase === 'versus' ? `${flow.phase}-${flow.runId}` : flow.phase}
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
        {DEBUG && engine && <DebugPanel engine={engine} />}
      </div>
    </MotionConfig>
  );
}
