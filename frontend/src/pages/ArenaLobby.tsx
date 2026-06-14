import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, ApiError } from "@/lib/api";
import { socket } from "@/lib/socket";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Copy, Users, Play, Check, LogOut, Crown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Participant {
  id: string;
  user_id: string;
  is_ready: boolean;
  joined_at: string;
  profiles: {
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

interface Match {
  id: string;
  room_code: string;
  status: string;
  host_id: string;
  is_official: boolean;
  scheduled_start_at: string | null;
  max_players: number;
  quizzes: {
    title: string;
    category: string;
    difficulty: string;
  };
}

const ArenaLobby = () => {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data: match, isLoading: loadingMatch } = useQuery({
    queryKey: ["arena-match", matchId],
    queryFn: () => api.get<Match>(`/api/arena/matches/${matchId}`),
    enabled: !!matchId,
    refetchInterval: 3000,
  });

  const { data: participants, isLoading: loadingParticipants } = useQuery({
    queryKey: ["arena-participants", matchId],
    queryFn: () => api.get<Participant[]>(`/api/arena/matches/${matchId}/participants`),
    enabled: !!matchId,
    refetchInterval: 3000,
  });

  // Socket: join room, listen for updates
  useEffect(() => {
    if (!matchId) return;

    socket.emit("join_room", matchId);

    const onParticipantsUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ["arena-participants", matchId] });
    };
    const onMatchUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ["arena-match", matchId] });
    };

    socket.on("participants_updated", onParticipantsUpdated);
    socket.on("match_updated", onMatchUpdated);

    return () => {
      socket.emit("leave_room", matchId);
      socket.off("participants_updated", onParticipantsUpdated);
      socket.off("match_updated", onMatchUpdated);
    };
  }, [matchId, queryClient]);

  // Toggle ready status
  const toggleReady = useMutation({
    mutationFn: () => api.post<{ is_ready: boolean }>(`/api/arena/matches/${matchId}/ready`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["arena-participants", matchId] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed"),
  });

  // Leave match
  const leaveMatch = useMutation({
    mutationFn: () => api.post(`/api/arena/matches/${matchId}/leave`),
    onSuccess: () => {
      toast.success("Left the match");
      navigate("/arena");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed"),
  });

  // Start the game (host only)
  const startGame = useMutation({
    mutationFn: () => api.post(`/api/arena/matches/${matchId}/start`),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed"),
  });

  // Join official war from lobby page (supports late join)
  const joinOfficialWar = useMutation({
    mutationFn: () => api.post(`/api/arena/matches/${matchId}/join-official`),
    onSuccess: () => {
      toast.success("Joined war");
      queryClient.invalidateQueries({ queryKey: ["arena-participants", matchId] });
      queryClient.invalidateQueries({ queryKey: ["arena-match", matchId] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed"),
  });

  const copyRoomCode = () => {
    if (match?.room_code) {
      navigator.clipboard.writeText(match.room_code);
      setCopied(true);
      toast.success("Room code copied!");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isHost = match?.host_id === user?.id;
  const isOfficial = !!match?.is_official;
  const myParticipant = participants?.find((p) => p.user_id === user?.id);
  const isJoined = !!myParticipant;
  const readyCount = participants?.filter((p) => p.is_ready).length ?? 0;
  const allReady = participants && participants.length >= 2 && readyCount === participants.length;

  const [countdown, setCountdown] = useState<string>("");

  useEffect(() => {
    if (!match?.scheduled_start_at) return;
    const updateCountdown = () => {
      const now = new Date().getTime();
      const start = new Date(match.scheduled_start_at!).getTime();
      const diff = start - now;
      if (diff <= 0) {
        setCountdown("Starting soon...");
      } else {
        const h = Math.floor(diff / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);
        setCountdown(`${h}h ${m}m ${s}s`);
      }
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [match?.scheduled_start_at]);

  // Navigate via useEffect, never during render
  useEffect(() => {
    if (!match || !matchId) return;
    if (match.status === "playing" || match.status === "countdown") {
      if (isOfficial && !isJoined && window.location.pathname.endsWith("/lobby")) return; // Spectators can stay in lobby or go to play to see leaderboard
      navigate(`/arena/${matchId}/play`, { replace: true });
    } else if (match.status === "finished") {
      navigate(`/arena/${matchId}/results`, { replace: true });
    }
  }, [match?.status, matchId, navigate, isOfficial, isJoined]);

  if (loadingMatch || loadingParticipants) {
    return (
      <Layout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!match) {
    return (
      <Layout>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
          <h2 className="font-display text-2xl font-bold text-foreground">Match not found</h2>
          <Button onClick={() => navigate("/arena")}>Back to Arena</Button>
        </div>
      </Layout>
    );
  }

  if ((match.status === "playing" || match.status === "countdown") && !(isOfficial && !isJoined)) {
    return (
      <Layout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto max-w-lg px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Room Code Card */}
          <div className="rounded-xl border border-border bg-card p-6 text-center">
            <p className="mb-2 text-sm text-muted-foreground">Room Code</p>
            <div className="flex items-center justify-center gap-3">
              <span className="font-mono text-4xl font-bold tracking-widest text-foreground">
                {match.room_code}
              </span>
              <Button variant="ghost" size="icon" onClick={copyRoomCode}>
                {copied ? <Check className="h-5 w-5 text-primary" /> : <Copy className="h-5 w-5" />}
              </Button>
            </div>
          </div>

          {/* Quiz Info */}
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">Quiz</p>
            <h2 className="font-display text-lg font-semibold text-foreground">
              {match.quizzes?.title}
            </h2>
            <div className="mt-1 flex gap-2">
              <Badge variant="secondary">{match.quizzes?.category}</Badge>
              <Badge variant="outline">{match.quizzes?.difficulty}</Badge>
              {isOfficial && match.scheduled_start_at && (
                <Badge variant="default" className="ml-auto">
                  Starts in: {countdown}
                </Badge>
              )}
            </div>
          </div>

          {/* Participants */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">
                  Players ({participants?.length ?? 0}/{match.max_players})
                </span>
              </div>
              {!isOfficial && (
                <span className="text-xs text-muted-foreground">{readyCount} ready</span>
              )}
            </div>

            <div className="space-y-2">
              <AnimatePresence>
                {participants?.map((p) => (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      {p.user_id === match.host_id && (
                        <Crown className="h-4 w-4 text-primary" />
                      )}
                      <span className="font-body text-sm text-foreground">
                        {p.profiles?.display_name ?? "Player"}
                      </span>
                    </div>
                    {!isOfficial && (
                      <Badge variant={p.is_ready ? "default" : "outline"} className="text-xs">
                        {p.is_ready ? "Ready" : "Not Ready"}
                      </Badge>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            {isOfficial && !isJoined && (
              <Button
                onClick={() => joinOfficialWar.mutate()}
                disabled={joinOfficialWar.isPending}
                className="flex-1 gap-2"
              >
                {joinOfficialWar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Join War
              </Button>
            )}

            {(!isOfficial || isJoined) && (
              <Button
                variant="outline"
                onClick={() => leaveMatch.mutate()}
                disabled={leaveMatch.isPending}
                className="gap-2"
              >
                <LogOut className="h-4 w-4" />
                Leave
              </Button>
            )}

            {!isOfficial && !isHost && (
              <Button
                onClick={() => toggleReady.mutate()}
                disabled={toggleReady.isPending}
                variant={myParticipant?.is_ready ? "secondary" : "default"}
                className="flex-1 gap-2"
              >
                {myParticipant?.is_ready ? (
                  <>
                    <Check className="h-4 w-4" />
                    Ready
                  </>
                ) : (
                  "Ready Up"
                )}
              </Button>
            )}

            {!isOfficial && isHost && (
              <Button
                onClick={() => startGame.mutate()}
                disabled={startGame.isPending || !allReady}
                className="flex-1 gap-2"
              >
                {startGame.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Start Game
              </Button>
            )}
          </div>

          {!isOfficial && isHost && !allReady && (
            <p className="text-center text-xs text-muted-foreground">
              {participants && participants.length < 2
                ? "Need at least 2 players to start"
                : "Waiting for all players to be ready..."}
            </p>
          )}

          {isOfficial && !isJoined && match.status !== "finished" && (
            <p className="text-center text-xs text-muted-foreground">
              Join is allowed even after start, but late joiners lose elapsed time.
            </p>
          )}
        </motion.div>
      </div>
    </Layout>
  );
};

export default ArenaLobby;