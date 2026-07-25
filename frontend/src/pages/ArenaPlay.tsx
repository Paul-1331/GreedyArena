/**
 * ArenaPlay — pure render layer for the active game.
 *
 * All WebSocket communication, game state, and socket event handling
 * lives in useArenaGame(). This component only renders what the hook gives it.
 *
 * Timer display: computed from server-provided startedAt + globalTimeTotal.
 * No client-side state machines. No polling. No useMutation for gameplay.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useArenaGame } from '@/hooks/useArenaGame';
import { Loader2, Clock, CheckCircle, XCircle, ArrowRight, Trophy } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import LiveMatchLeaderboard from '@/components/arena/LiveMatchLeaderboard';

const optionLabels = ['A', 'B', 'C', 'D'];

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const ArenaPlay = () => {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();


  const { gameState, answerResult, liveScores, isSubmitting, isAdvancing, submitAnswer, nextQuestion } =
    useArenaGame(matchId);

  // ── Local selection state (UI only — no game logic) ────────────────────
  const [selectedSingle, setSelectedSingle] = useState<number | null>(null);
  const [selectedMulti, setSelectedMulti] = useState<number[]>([]);
  const [numericAnswer, setNumericAnswer] = useState('');
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // ── Timer display — purely arithmetic from server-provided startedAt ────
  // No setInterval accumulating drift. Just (now - startedAt) every second.
  const [displayTimeLeft, setDisplayTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!gameState?.startedAt || !gameState.globalTimeTotal) return;
    if (gameState.status !== 'playing' || gameState.finished) return;

    const tick = () => {
      const elapsed = (Date.now() - new Date(gameState.startedAt!).getTime()) / 1000;
      const remaining = Math.max(0, Math.ceil(gameState.globalTimeTotal! - elapsed));
      setDisplayTimeLeft(remaining);
    };

    tick(); // immediate
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [gameState?.startedAt, gameState?.globalTimeTotal, gameState?.status, gameState?.finished]);

  // Sync displayTimeLeft from server push (on reconnect or initial load)
  useEffect(() => {
    if (gameState?.globalTimeLeft !== undefined) {
      setDisplayTimeLeft(gameState.globalTimeLeft);
    }
  }, [gameState?.globalTimeLeft]);

  // ── Reset selection when question changes ───────────────────────────────
  useEffect(() => {
    if (gameState?.phase === 'answering') {
      setSelectedSingle(null);
      setSelectedMulti([]);
      setNumericAnswer('');
    }
  }, [gameState?.currentIndex, gameState?.phase]);

  // ── Countdown: when status becomes 'countdown', trigger begin-playing ───
  const [countdown, setCountdown] = useState<number | null>(null);
  const beganPlayingRef = useRef(false);

  useEffect(() => {
    if (gameState?.status === 'countdown' && !beganPlayingRef.current) {
      beganPlayingRef.current = true;
      setCountdown(3);
      const tick = setInterval(() => {
        setCountdown((prev) => {
          if (prev === null || prev <= 1) {
            clearInterval(tick);
            api.post(`/api/arena/matches/${matchId}/begin-playing`).catch(() => {});
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(tick);
    }
    if (gameState?.status === 'playing') {
      beganPlayingRef.current = true;
    }
  }, [gameState?.status, matchId]);

  // ── Navigate to results on match_finished ───────────────────────────────
  useEffect(() => {
    if (gameState?.status === 'finished') {
      const t = setTimeout(() => navigate(`/arena/${matchId}/results`, { replace: true }), 1200);
      return () => clearTimeout(t);
    }
  }, [gameState?.status, matchId, navigate]);

  // ── canSubmit ────────────────────────────────────────────────────────────
  const canSubmit = useCallback(() => {
    const q = gameState?.question;
    if (!q) return false;
    if (q.question_type === 'single_mcq') return selectedSingle !== null;
    if (q.question_type === 'multi_select') return selectedMulti.length > 0;
    if (q.question_type === 'numeric') return numericAnswer.trim() !== '';
    return false;
  }, [gameState?.question, selectedSingle, selectedMulti, numericAnswer]);

  const handleSubmit = useCallback(() => {
    const q = gameState?.question;
    if (!q || !canSubmit()) return;
    let selected: number | number[] | null = null;
    if (q.question_type === 'single_mcq') selected = selectedSingle;
    else if (q.question_type === 'multi_select') selected = selectedMulti;
    else if (q.question_type === 'numeric') selected = Number(numericAnswer);
    submitAnswer(selected);
  }, [gameState?.question, selectedSingle, selectedMulti, numericAnswer, canSubmit, submitAnswer]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (!gameState) {
    return (
      <Layout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  // Guard: status is 'playing' but the question data hasn't arrived yet
  // (the ~100ms gap between the match_updated push and the game_state response).
  // Show a spinner rather than broken "1/0 questions" UI.
  if (gameState.status === 'playing' && !gameState.question && !gameState.finished) {
    return (
      <Layout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  // ── Countdown screen ─────────────────────────────────────────────────────
  if (gameState.status === 'countdown' || gameState.status === 'waiting') {
    return (
      <Layout>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
          <motion.div
            key={countdown}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="font-display text-9xl font-bold text-primary tabular-nums tracking-tighter"
          >
            {countdown !== null ? countdown : <Loader2 className="h-16 w-16 animate-spin" />}
          </motion.div>
          <p className="text-xl text-muted-foreground mt-4">Get ready...</p>
        </div>
      </Layout>
    );
  }

  // ── Finished — waiting for others (official wars) ────────────────────────
  if (gameState.finished && gameState.status !== 'finished') {
    if (gameState.isOfficial) {
      return (
        <Layout>
          <div className="container mx-auto max-w-2xl px-4 py-8">
            <div className="mb-6 text-center">
              <h2 className="font-display text-2xl font-bold text-foreground">You've finished!</h2>
              <p className="text-muted-foreground">Waiting for other players to complete the war...</p>
            </div>
            <LiveMatchLeaderboard matchId={matchId!} liveScores={liveScores} />
          </div>
        </Layout>
      );
    }
    return (
      <Layout>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
          <Trophy className="h-12 w-12 text-primary" />
          <h2 className="font-display text-2xl font-bold text-foreground">Finished!</h2>
          <p className="text-muted-foreground">Waiting for other players...</p>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  // ── Spectator view ───────────────────────────────────────────────────────
  if (gameState.isSpectator) {
    return (
      <Layout>
        <div className="container mx-auto max-w-2xl px-4 py-8">
          <LiveMatchLeaderboard matchId={matchId!} liveScores={liveScores} isSpectator />
        </div>
      </Layout>
    );
  }

  const q = gameState.question;
  const phase = gameState.phase;
  const totalQuestions = gameState.totalQuestions ?? 0;
  const currentIndex = gameState.currentIndex ?? 0;
  const correctAnswer = answerResult?.correctAnswer ?? q?.correct_answer;

  return (
    <Layout>
      <div className="container mx-auto max-w-2xl px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <Badge variant="secondary" className="font-body">
            Question {currentIndex + 1} / {totalQuestions}
          </Badge>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowLeaderboard(!showLeaderboard)} className="font-body mr-2 gap-2">
              <Trophy className="h-4 w-4 text-primary" />
              {showLeaderboard ? 'Back to Quiz' : 'Live Standings'}
            </Button>
            <Badge variant="outline" className="font-body">Score: {gameState.myScore ?? 0}</Badge>
            <Badge
              variant={displayTimeLeft !== null && displayTimeLeft <= 30 ? 'destructive' : 'secondary'}
              className="gap-1.5 font-mono"
            >
              <Clock className="h-3.5 w-3.5" />
              {formatTime(displayTimeLeft ?? gameState.globalTimeLeft ?? 0)}
            </Badge>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${((currentIndex + (phase === 'revealed' ? 1 : 0)) / totalQuestions) * 100}%` }}
          />
        </div>

        {showLeaderboard ? (
          <LiveMatchLeaderboard matchId={matchId!} liveScores={liveScores} />
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={`${currentIndex}-${phase}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
              className="rounded-xl border border-border bg-card p-6"
            >
              <h2 className="mb-5 font-display text-lg font-semibold text-foreground">{q?.question_text}</h2>

              {/* Single MCQ */}
              {q?.question_type === 'single_mcq' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {q.options.map((opt, oi) => {
                    const isCorrectOpt = phase === 'revealed' && correctAnswer === oi;
                    const wasMySelection = phase === 'revealed' && selectedSingle === oi;
                    let cls = 'border-border bg-background hover:border-primary/50';
                    if (phase === 'answering' && selectedSingle === oi) cls = 'border-primary ring-1 ring-primary bg-primary/5';
                    if (phase === 'revealed') {
                      if (isCorrectOpt) cls = 'border-primary bg-primary/10 text-primary';
                      else if (wasMySelection) cls = 'border-destructive bg-destructive/10 text-destructive';
                      else cls = 'border-border bg-background opacity-60';
                    }
                    return (
                      <button
                        key={oi} type="button"
                        disabled={phase !== 'answering'}
                        onClick={() => setSelectedSingle(oi)}
                        className={`flex items-center gap-2 rounded-md border px-4 py-3 text-left text-sm font-body transition-colors ${cls} ${phase === 'answering' ? 'cursor-pointer' : 'cursor-default'}`}
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{optionLabels[oi]}</span>
                        <span className="flex-1">{opt}</span>
                        {phase === 'revealed' && isCorrectOpt && <CheckCircle className="h-4 w-4 shrink-0" />}
                        {phase === 'revealed' && wasMySelection && !isCorrectOpt && <XCircle className="h-4 w-4 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Multi-select */}
              {q?.question_type === 'multi_select' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {q.options.map((opt, oi) => {
                    const isCorrectOpt = phase === 'revealed' && Array.isArray(correctAnswer) && correctAnswer.includes(oi);
                    const wasMySelection = phase === 'revealed' && selectedMulti.includes(oi);
                    let cls = 'border-border bg-background';
                    if (phase === 'revealed') {
                      if (isCorrectOpt) cls = 'border-primary bg-primary/10 text-primary';
                      else if (wasMySelection) cls = 'border-destructive bg-destructive/10 text-destructive';
                      else cls = 'border-border bg-background opacity-60';
                    }
                    return (
                      <div key={oi} className={`flex items-center gap-2 rounded-md border px-4 py-3 text-sm font-body ${cls}`}>
                        <Checkbox checked={selectedMulti.includes(oi)} disabled={phase !== 'answering'}
                          onCheckedChange={() => setSelectedMulti((prev) => prev.includes(oi) ? prev.filter((i) => i !== oi) : [...prev, oi])}
                        />
                        <span className="flex-1">{opt}</span>
                        {phase === 'revealed' && isCorrectOpt && <CheckCircle className="h-4 w-4 shrink-0" />}
                        {phase === 'revealed' && wasMySelection && !isCorrectOpt && <XCircle className="h-4 w-4 shrink-0" />}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Numeric */}
              {q?.question_type === 'numeric' && (
                <div className="space-y-2">
                  <Input type="number" value={numericAnswer} onChange={(e) => setNumericAnswer(e.target.value)}
                    disabled={phase !== 'answering'} placeholder="Enter your answer" className="max-w-[200px] font-mono"
                  />
                  {phase === 'revealed' && (
                    <p className="text-sm">
                      Correct answer: <span className="font-semibold text-primary">{String(correctAnswer)}</span>
                      {' · '}Your answer:{' '}
                      <span className={answerResult?.isCorrect ? 'font-semibold text-primary' : 'font-semibold text-destructive'}>
                        {numericAnswer || '—'}
                      </span>
                    </p>
                  )}
                </div>
              )}

              {/* Answer reveal */}
              {phase === 'revealed' && answerResult && (
                <div className="mt-4 space-y-2">
                  <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${answerResult.isCorrect ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>
                    {answerResult.isCorrect ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    {answerResult.isCorrect ? `Correct! +${answerResult.points} points` : 'Incorrect'}
                  </div>
                  {answerResult.explanation && (
                    <p className="text-sm text-muted-foreground italic">💡 {answerResult.explanation}</p>
                  )}
                </div>
              )}

              {/* Action button */}
              <div className="mt-6">
                {phase === 'answering' ? (
                  <Button onClick={handleSubmit} disabled={!canSubmit() || isSubmitting} size="lg" className="w-full gap-2 font-body">
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Submit Answer
                  </Button>
                ) : (
                  <Button onClick={nextQuestion} disabled={isAdvancing} size="lg" className="w-full gap-2 font-body">
                    {isAdvancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    {currentIndex + 1 >= totalQuestions ? 'Finish' : 'Next Question'}
                  </Button>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </Layout>
  );
};

export default ArenaPlay;