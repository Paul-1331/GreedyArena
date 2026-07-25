import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '@/lib/socket';
import { toast } from 'sonner';

export interface PlayQuestion {
  id: string;
  question_text: string;
  question_type: 'single_mcq' | 'multi_select' | 'numeric';
  options: string[];
  explanation: string | null;
  correct_answer?: number | number[];
}

export interface GameState {
  status: string;
  finished?: boolean;
  isSpectator?: boolean;
  isOfficial?: boolean;
  startedAt?: string;
  currentIndex?: number;
  totalQuestions?: number;
  phase?: 'answering' | 'revealed';
  question?: PlayQuestion;
  globalTimeLeft?: number;
  globalTimeTotal?: number;
  myScore?: number;
  myAnswers?: any[];
}

export interface AnswerResult {
  isCorrect: boolean;
  points: number;
  correctAnswer: number | number[];
  newScore: number;
  explanation: string | null;
}

export interface LeaderboardEntry {
  userId: string;
  newScore: number;
}

/**
 * useArenaGame — manages all WebSocket communication for the active game.
 * ArenaPlay.tsx is purely a render layer; it calls this hook and gets back state + actions.
 */
export function useArenaGame(matchId: string | undefined) {
  const navigate = useNavigate();

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null);
  const [liveScores, setLiveScores] = useState<Map<string, number>>(new Map());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);

  // ── Connect and listen to socket events ─────────────────────────────────
  useEffect(() => {
    if (!matchId) return;
    const hasMounted = { joined: false };

    // Join match — server responds with game_state event
    socket.emit('join_match', { matchId }, (res: any) => {
      hasMounted.joined = true;
      if (res?.error) toast.error(res.error);
    });

    const onGameState = (state: GameState) => {
      setGameState(state);
      // Navigate if match already finished
      if (state.status === 'finished') {
        setTimeout(() => navigate(`/arena/${matchId}/results`, { replace: true }), 1200);
      }
    };

    // Server pushes the next question directly after next_question event
    const onQuestion = (data: {
      currentIndex: number;
      totalQuestions: number;
      phase: 'answering' | 'revealed';
      question: PlayQuestion;
      globalTimeLeft: number;
      myScore: number;
    }) => {
      setAnswerResult(null); // clear previous reveal
      setGameState((prev) => prev ? {
        ...prev,
        currentIndex: data.currentIndex,
        totalQuestions: data.totalQuestions,
        phase: data.phase,
        question: data.question,
        globalTimeLeft: data.globalTimeLeft,
        myScore: data.myScore,
      } : prev);
    };

    // Broadcast score update from any player answering
    const onScoreUpdate = ({ userId, newScore }: { userId: string; newScore: number }) => {
      setLiveScores((prev) => new Map(prev).set(userId, newScore));
    };

    // Server signals match is finished (WarEngine or all-done)
    const onMatchFinished = () => {
      setTimeout(() => navigate(`/arena/${matchId}/results`, { replace: true }), 1200);
    };

    const onMatchUpdated = ({ status, startedAt }: { status: string; startedAt?: string }) => {
      if (status === 'playing') {
        // Don't immediately patch local state to 'playing' — that would cause a
        // flash of broken UI (no question/totalQuestions yet).  Instead, fetch
        // the full personalised game_state from the server, which will set
        // status + question + timers all in one atomic update.
        socket.emit('join_match', { matchId }, (res: any) => {
          if (res?.error) toast.error(res.error);
        });
      } else {
        // For other transitions (waiting→countdown, playing→finished) a simple
        // patch is safe because those states have no question data to show.
        setGameState((prev) => prev ? { ...prev, status, startedAt: startedAt ?? prev.startedAt } : prev);
      }
    };

    socket.on('game_state', onGameState);
    socket.on('question', onQuestion);
    socket.on('score_update', onScoreUpdate);
    socket.on('match_finished', onMatchFinished);
    socket.on('match_updated', onMatchUpdated);

    // Re-join on reconnect. Socket.IO v4 emits 'connect' on both initial
    // connection and every successful reconnection — skip the initial fire
    // since join_match is already emitted above.
    const onConnect = () => {
      if (!hasMounted.joined) return; // still the initial connection, already handled
      if (socket.recovered) return;   // socket.io state recovery — already synced
      socket.emit('join_match', { matchId }, (res: any) => {
        if (res?.error) toast.error(res.error);
      });
    };
    socket.on('connect', onConnect);

    return () => {
      socket.emit('leave_room', matchId);
      socket.off('game_state', onGameState);
      socket.off('question', onQuestion);
      socket.off('score_update', onScoreUpdate);
      socket.off('match_finished', onMatchFinished);
      socket.off('match_updated', onMatchUpdated);
      socket.off('connect', onConnect);
    };
  }, [matchId, navigate]);

  // ── Submit answer via socket ─────────────────────────────────────────────
  const submitAnswer = useCallback((selected: number | number[] | null) => {
    if (!matchId || selected === null || isSubmitting) return;
    setIsSubmitting(true);

    socket.emit('submit_answer', { selected }, (result: AnswerResult & { error?: string }) => {
      setIsSubmitting(false);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setAnswerResult(result);
      // Update phase and score in local state immediately
      setGameState((prev) => prev ? {
        ...prev,
        phase: 'revealed',
        myScore: result.newScore,
        question: prev.question ? { ...prev.question, correct_answer: result.correctAnswer } : prev.question,
      } : prev);
      // Note: own score in liveScores is updated by the server's score_update broadcast (by userId),
      // not here — avoids the socket.id vs userId key mismatch.
    });
  }, [matchId, isSubmitting]);

  // ── Advance to next question via socket ──────────────────────────────────
  const nextQuestion = useCallback(() => {
    if (!matchId || isAdvancing) return;
    setIsAdvancing(true);

    socket.emit('next_question', {}, (result: { finished?: boolean; error?: string }) => {
      setIsAdvancing(false);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      if (result?.finished) {
        // Server will also emit match_finished when all players are done
        setGameState((prev) => prev ? { ...prev, finished: true } : prev);
      }
      // The 'question' event from server will update state with the next question
    });
  }, [matchId, isAdvancing]);

  return {
    gameState,
    answerResult,
    liveScores,
    isSubmitting,
    isAdvancing,
    submitAnswer,
    nextQuestion,
  };
}
