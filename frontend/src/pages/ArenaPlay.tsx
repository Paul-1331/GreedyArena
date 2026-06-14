import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { socket } from "@/lib/socket";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Clock, CheckCircle, XCircle, ArrowRight, Trophy } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import LiveMatchLeaderboard from "@/components/arena/LiveMatchLeaderboard";

interface PlayQuestion {
  id: string;
  question_text: string;
  question_type: "single_mcq" | "multi_select" | "numeric";
  options: string[];
  explanation: string | null;
  correct_answer?: number | number[];
}

interface PlayState {
  status: string;
  finished?: boolean;
  noQuestions?: boolean;
  currentIndex?: number;
  totalQuestions?: number;
  phase?: "answering" | "revealed";
  question?: PlayQuestion;
  questionTimeSeconds?: number;
  globalTimeLeft?: number;
  globalTimeTotal?: number;
  myScore?: number;
  myAnswers?: any[];
  isOfficial?: boolean;
  isSpectator?: boolean;
}

const optionLabels = ["A", "B", "C", "D"];

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const ArenaPlay = () => {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [countdown, setCountdown] = useState<number | null>(null);
  const [globalTimeLeft, setGlobalTimeLeft] = useState<number | null>(null);
  const [selectedSingle, setSelectedSingle] = useState<number | null>(null);
  const [selectedMulti, setSelectedMulti] = useState<number[]>([]);
  const [numericAnswer, setNumericAnswer] = useState("");
  const [revealResult, setRevealResult] = useState<{
    isCorrect: boolean;
    points: number;
    correctAnswer: number | number[];
    explanation: string | null;
  } | null>(null);

  const [showLeaderboard, setShowLeaderboard] = useState(false);

  const questionStartRef = useRef<number>(Date.now());
  const beganPlayingRef = useRef(false);
  const finishCalledRef = useRef(false);

  const { data: playState, isLoading } = useQuery({
    queryKey: ["arena-play-state", matchId],
    queryFn: () => api.get<PlayState>(`/api/arena/matches/${matchId}/play-state`),
    enabled: !!matchId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 2000;
      if (data.status === "waiting" || data.status === "countdown") return 1000;
      if (data.status === "finished" || data.finished) return false;
      return 5000; // periodic re-sync while playing
    },
  });

  // Sync global timer from server snapshot whenever it changes meaningfully
  useEffect(() => {
    if (playState?.globalTimeLeft !== undefined) {
      setGlobalTimeLeft(playState.globalTimeLeft);
    }
  }, [playState?.globalTimeLeft]);

  // Local tick for global timer
  useEffect(() => {
    if (playState?.status !== "playing" || playState.finished) return;
    if (globalTimeLeft === null) return;

    const interval = setInterval(() => {
      setGlobalTimeLeft((prev) => {
        if (prev === null) return prev;
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [playState?.status, playState?.finished, globalTimeLeft !== null]);

  // When local timer hits 0, tell server we're done
  useEffect(() => {
    if (globalTimeLeft === 0 && !finishCalledRef.current && playState?.status === "playing" && !playState.finished) {
      finishCalledRef.current = true;
      api.post(`/api/arena/matches/${matchId}/finish`).finally(() => {
        queryClient.invalidateQueries({ queryKey: ["arena-play-state", matchId] });
      });
    }
  }, [globalTimeLeft, playState?.status, playState?.finished, matchId, queryClient]);

  // Reset local answer state when question changes
  useEffect(() => {
    if (playState?.phase === "answering") {
      setSelectedSingle(null);
      setSelectedMulti([]);
      setNumericAnswer("");
      setRevealResult(null);
      questionStartRef.current = Date.now();
    }
  }, [playState?.currentIndex, playState?.phase]);

  // Countdown handling
  useEffect(() => {
    if (playState?.status === "countdown" && !beganPlayingRef.current) {
      beganPlayingRef.current = true;
      setCountdown(3);

      const tick = setInterval(() => {
        setCountdown((prev) => {
          if (prev === null) return null;
          if (prev <= 1) {
            clearInterval(tick);
            api.post(`/api/arena/matches/${matchId}/begin-playing`).finally(() => {
              queryClient.invalidateQueries({ queryKey: ["arena-play-state", matchId] });
            });
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(tick);
    }

    if (playState?.status === "playing") {
      beganPlayingRef.current = true;
    }
  }, [playState?.status, matchId, queryClient]);

  // Socket: listen for match finished (other players done / global state changes)
  useEffect(() => {
    if (!matchId) return;
    socket.emit("join_room", matchId);

    const onMatchFinished = () => {
      queryClient.invalidateQueries({ queryKey: ["arena-play-state", matchId] });
    };

    socket.on("match_finished", onMatchFinished);

    return () => {
      socket.emit("leave_room", matchId);
      socket.off("match_finished", onMatchFinished);
    };
  }, [matchId, queryClient]);

  // Navigate to results once finished
  useEffect(() => {
    if (playState?.status === "finished") {
      const timeout = setTimeout(() => {
        navigate(`/arena/${matchId}/results`, { replace: true });
      }, 1200);
      return () => clearTimeout(timeout);
    }
  }, [playState?.status, playState?.finished, matchId, navigate]);

  const submitAnswer = useMutation({
    mutationFn: async () => {
      const timeTakenMs = Date.now() - questionStartRef.current;
      let selected: number | number[] | null = null;

      if (playState?.question?.question_type === "single_mcq") {
        selected = selectedSingle;
      } else if (playState?.question?.question_type === "multi_select") {
        selected = selectedMulti;
      } else if (playState?.question?.question_type === "numeric") {
        selected = Number(numericAnswer);
      }

      return api.post<{
        isCorrect: boolean;
        points: number;
        correctAnswer: number | number[];
        newScore: number;
        explanation: string | null;
      }>(`/api/arena/matches/${matchId}/answer`, { selected, timeTakenMs });
    },
    onSuccess: (data) => {
      setRevealResult(data);
      queryClient.invalidateQueries({ queryKey: ["arena-play-state", matchId] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.message.includes("expired")) {
        queryClient.invalidateQueries({ queryKey: ["arena-play-state", matchId] });
      } else {
        toast.error(err instanceof ApiError ? err.message : "Failed to submit");
      }
    },
  });

  const nextQuestion = useMutation({
    mutationFn: () => api.post<{ finished: boolean }>(`/api/arena/matches/${matchId}/next`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["arena-play-state", matchId] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed"),
  });

  const canSubmit = useCallback(() => {
    const q = playState?.question;
    if (!q) return false;
    if (q.question_type === "single_mcq") return selectedSingle !== null;
    if (q.question_type === "multi_select") return selectedMulti.length > 0;
    if (q.question_type === "numeric") return numericAnswer.trim() !== "";
    return false;
  }, [playState?.question, selectedSingle, selectedMulti, numericAnswer]);

  if (isLoading || !playState) {
    return (
      <Layout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  // Countdown screen
  if (playState.status === "countdown" || (playState.status === "waiting")) {
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

  // Finished screen
  if (playState.status === "finished" || playState.finished) {
    const isWaitingForOthers = playState.status !== "finished";
    
    // If it's an official war and we're waiting for others, show live standings
    if (isWaitingForOthers && playState.isOfficial) {
      return (
        <Layout>
          <div className="container mx-auto max-w-2xl px-4 py-8">
            <div className="mb-6 text-center">
              <h2 className="font-display text-2xl font-bold text-foreground">You've finished!</h2>
              <p className="text-muted-foreground">Waiting for other players to complete the war...</p>
            </div>
            <LiveMatchLeaderboard matchId={matchId!} isSpectator={false} />
          </div>
        </Layout>
      );
    }

    return (
      <Layout>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
          <Trophy className="h-12 w-12 text-primary" />
          <h2 className="font-display text-2xl font-bold text-foreground">Finished!</h2>
          <p className="text-muted-foreground">
            {isWaitingForOthers ? "Waiting for other players to finish..." : "Calculating results..."}
          </p>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  if (playState.noQuestions) {
    return (
      <Layout>
        <div className="flex min-h-[60vh] items-center justify-center text-center">
          <p className="text-muted-foreground">This quiz has no questions.</p>
        </div>
      </Layout>
    );
  }

  if (playState.isSpectator) {
    return (
      <Layout>
        <div className="container mx-auto max-w-2xl px-4 py-8">
          <LiveMatchLeaderboard matchId={matchId!} isSpectator={true} />
        </div>
      </Layout>
    );
  }

  const q = playState.question;
  const phase = playState.phase;
  const totalQuestions = playState.totalQuestions ?? 0;
  const currentIndex = playState.currentIndex ?? 0;
  const correctAnswer = revealResult?.correctAnswer ?? q?.correct_answer;

  return (
    <Layout>
      <div className="container mx-auto max-w-2xl px-4 py-8">
        {/* Header: global timer + progress */}
        <div className="mb-6 flex items-center justify-between">
          <Badge variant="secondary" className="font-body">
            Question {currentIndex + 1} / {totalQuestions}
          </Badge>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowLeaderboard(!showLeaderboard)}
              className="font-body mr-2 gap-2"
            >
              <Trophy className="h-4 w-4 text-primary" />
              {showLeaderboard ? "Back to Quiz" : "Live Standings"}
            </Button>
            <Badge variant="outline" className="font-body">
              Score: {playState.myScore ?? 0}
            </Badge>
            <Badge
              variant={globalTimeLeft !== null && globalTimeLeft <= 30 ? "destructive" : "secondary"}
              className="gap-1.5 font-mono"
            >
              <Clock className="h-3.5 w-3.5" />
              {formatTime(globalTimeLeft ?? playState.globalTimeLeft ?? 0)}
            </Badge>
          </div>
        </div>

        {showLeaderboard ? (
          <LiveMatchLeaderboard matchId={matchId!} isSpectator={false} />
        ) : (
          <>
            {/* Progress bar */}
            <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${((currentIndex + (phase === "revealed" ? 1 : 0)) / totalQuestions) * 100}%` }}
              />
            </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={`${currentIndex}-${phase}`}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
            className="rounded-xl border border-border bg-card p-6"
          >
            <h2 className="mb-5 font-display text-lg font-semibold text-foreground">
              {q?.question_text}
            </h2>

            {/* Single MCQ */}
            {q?.question_type === "single_mcq" && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {q.options.map((opt, oi) => {
                  const isSelected = phase === "answering" ? selectedSingle === oi : revealResult?.points !== undefined ? false : false;
                  const isCorrectOpt = phase === "revealed" && correctAnswer === oi;
                  const wasMySelection = phase === "revealed" && selectedSingle === oi;

                  let cls = "border-border bg-background hover:border-primary/50";
                  if (phase === "answering" && selectedSingle === oi) {
                    cls = "border-primary ring-1 ring-primary bg-primary/5";
                  }
                  if (phase === "revealed") {
                    if (isCorrectOpt) cls = "border-primary bg-primary/10 text-primary";
                    else if (wasMySelection) cls = "border-destructive bg-destructive/10 text-destructive";
                    else cls = "border-border bg-background opacity-60";
                  }

                  return (
                    <button
                      key={oi}
                      type="button"
                      disabled={phase !== "answering"}
                      onClick={() => setSelectedSingle(oi)}
                      className={`flex items-center gap-2 rounded-md border px-4 py-3 text-left text-sm font-body transition-colors ${cls} ${phase === "answering" ? "cursor-pointer" : "cursor-default"}`}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                        {optionLabels[oi]}
                      </span>
                      <span className="flex-1">{opt}</span>
                      {phase === "revealed" && isCorrectOpt && <CheckCircle className="h-4 w-4 shrink-0" />}
                      {phase === "revealed" && wasMySelection && !isCorrectOpt && <XCircle className="h-4 w-4 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Multi-select */}
            {q?.question_type === "multi_select" && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {q.options.map((opt, oi) => {
                  const isCorrectOpt = phase === "revealed" && Array.isArray(correctAnswer) && correctAnswer.includes(oi);
                  const wasMySelection = phase === "revealed" && selectedMulti.includes(oi);

                  let cls = "border-border bg-background";
                  if (phase === "revealed") {
                    if (isCorrectOpt) cls = "border-primary bg-primary/10 text-primary";
                    else if (wasMySelection) cls = "border-destructive bg-destructive/10 text-destructive";
                    else cls = "border-border bg-background opacity-60";
                  }

                  return (
                    <div
                      key={oi}
                      className={`flex items-center gap-2 rounded-md border px-4 py-3 text-sm font-body ${cls}`}
                    >
                      <Checkbox
                        checked={selectedMulti.includes(oi)}
                        disabled={phase !== "answering"}
                        onCheckedChange={() => {
                          setSelectedMulti((prev) =>
                            prev.includes(oi) ? prev.filter((i) => i !== oi) : [...prev, oi]
                          );
                        }}
                      />
                      <span className="flex-1">{opt}</span>
                      {phase === "revealed" && isCorrectOpt && <CheckCircle className="h-4 w-4 shrink-0" />}
                      {phase === "revealed" && wasMySelection && !isCorrectOpt && <XCircle className="h-4 w-4 shrink-0" />}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Numeric */}
            {q?.question_type === "numeric" && (
              <div className="space-y-2">
                <Input
                  type="number"
                  value={numericAnswer}
                  onChange={(e) => setNumericAnswer(e.target.value)}
                  disabled={phase !== "answering"}
                  placeholder="Enter your answer"
                  className="max-w-[200px] font-mono"
                />
                {phase === "revealed" && (
                  <p className="text-sm">
                    Correct answer: <span className="font-semibold text-primary">{String(correctAnswer)}</span>
                    {" · "}Your answer:{" "}
                    <span className={revealResult?.isCorrect ? "font-semibold text-primary" : "font-semibold text-destructive"}>
                      {numericAnswer || "—"}
                    </span>
                  </p>
                )}
              </div>
            )}

            {/* Reveal result */}
            {phase === "revealed" && revealResult && (
              <div className="mt-4 space-y-2">
                <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${revealResult.isCorrect ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
                  {revealResult.isCorrect ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  {revealResult.isCorrect ? `Correct! +${revealResult.points} points` : "Incorrect"}
                </div>
                {revealResult.explanation && (
                  <p className="text-sm text-muted-foreground italic">💡 {revealResult.explanation}</p>
                )}
              </div>
            )}

            {/* Action button */}
            <div className="mt-6">
              {phase === "answering" ? (
                <Button
                  onClick={() => submitAnswer.mutate()}
                  disabled={!canSubmit() || submitAnswer.isPending}
                  size="lg"
                  className="w-full gap-2 font-body"
                >
                  {submitAnswer.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Submit Answer
                </Button>
              ) : (
                <Button
                  onClick={() => nextQuestion.mutate()}
                  disabled={nextQuestion.isPending}
                  size="lg"
                  className="w-full gap-2 font-body"
                >
                  {nextQuestion.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  {currentIndex + 1 >= totalQuestions ? "Finish" : "Next Question"}
                </Button>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
        </>
        )}
      </div>
    </Layout>
  );
};

export default ArenaPlay;