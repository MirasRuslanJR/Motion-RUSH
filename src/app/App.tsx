import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { DebugPanel } from '../components/DebugPanel';
import { TopBar } from '../components/TopBar';
import { classifyCameraError, type CameraErrorKind } from '../features/camera/cameraErrors';
import { MotionEngine } from '../features/engine/MotionEngine';
import type { SessionResult } from '../features/gameplay/types';
import { loadPoseBackend } from '../features/tracking/poseBackend';
import { computeSessionStats } from '../features/results/sessionStats';
import { useMotionUi } from '../hooks/useEngine';
import { sfx } from '../lib/audio/sfx';
import { DEBUG } from '../lib/env';
import { loadProfile, recordSession, saveMuted, type Profile, type RecordedSession } from '../lib/storage';
import { CalibrationScreen } from '../screens/CalibrationScreen';
import { CameraCheckScreen } from '../screens/CameraCheckScreen';
import { CameraErrorScreen } from '../screens/CameraErrorScreen';
import { GameScreen } from '../screens/game/GameScreen';
import { LandingScreen } from '../screens/LandingScreen';
import { PermissionScreen } from '../screens/PermissionScreen';
import { ResultsScreen } from '../screens/results/ResultsScreen';
import { TutorialScreen } from '../screens/TutorialScreen';
import { flowReducer, INITIAL_FLOW } from './flow';

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
    const release = () => engineRef.current?.dispose();
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
    dispatch({ type: 'PLAY_AGAIN' });
  }, []);
  const onRecalibrate = useCallback(() => dispatch({ type: 'RECALIBRATE' }), []);

  const onFinish = useCallback((result: SessionResult) => {
    const stats = computeSessionStats(result);
    const saved = recordSession({
      score: result.score,
      accuracy: stats.accuracy,
      bestCombo: result.bestCombo,
      outcome: result.outcome,
      date: new Date().toISOString(),
    });
    setRecorded(saved);
    setProfile(saved.profile);
    dispatch({ type: 'GAME_OVER', result });
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
      screen = <LandingScreen profile={profile} onStart={start} />;
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
    case 'game':
      if (engine) screen = <GameScreen key={flow.runId} engine={engine} onFinish={onFinish} />;
      break;
    case 'results':
      if (engine && flow.result) {
        screen = (
          <ResultsScreen
            engine={engine}
            result={flow.result}
            recorded={recorded}
            onPlayAgain={onPlayAgain}
            onRecalibrate={onRecalibrate}
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
              key={flow.phase === 'game' ? `game-${flow.runId}` : flow.phase}
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
