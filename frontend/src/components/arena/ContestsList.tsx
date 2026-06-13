import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Loader2, Trophy, Clock, Users, Swords, Crown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { format, formatDistanceToNow, isPast } from "date-fns";

const ContestsList = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: contests, isLoading } = useQuery({
    queryKey: ["arena-contests"],
    queryFn: async () => {
      // Backend handles processing due wars via cron or lazily, or we could add an API call.
      // For now, we'll just fetch the official matches.
      const data = await api.get("/api/arena/official");
      return data;
    },
    refetchInterval: 10000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!contests?.length) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <Crown className="mx-auto mb-3 h-10 w-10 opacity-50" />
        <p className="font-body">No upcoming wars right now.</p>
        <p className="text-sm">Check back later for new wars!</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {contests.map((contest, idx) => {
        const quiz = contest.quizzes as any;
        const startTime = contest.scheduled_start_at
          ? new Date(contest.scheduled_start_at)
          : null;
        const isStarted = contest.status === "playing" || contest.status === "countdown";
        const canJoin = contest.status === "waiting" || contest.status === "countdown" || contest.status === "playing";

        return (
          <motion.div
            key={contest.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="rounded-lg border border-primary/20 bg-card p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-primary" />
                   <h3 className="font-body text-sm font-semibold text-foreground">
                    {quiz?.title ?? "War"}
                  </h3>
                  <Badge variant="secondary" className="text-xs">War</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {quiz?.category && <span>{quiz.category}</span>}
                  {quiz?.difficulty && <span>• {quiz.difficulty}</span>}
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {contest.participant_count}/{contest.max_players}
                  </span>
                </div>
                {startTime && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {isPast(startTime)
                      ? `Started ${formatDistanceToNow(startTime, { addSuffix: true })}`
                      : `Starts ${formatDistanceToNow(startTime, { addSuffix: true })} · ${format(startTime, "MMM d, h:mm a")}`}
                  </p>
                )}
              </div>
              <div>
                {isStarted && contest.has_joined ? (
                  <Button
                    size="sm"
                    onClick={() => navigate(`/arena/${contest.id}`)}
                    className="gap-1.5 font-body"
                  >
                    <Swords className="h-3.5 w-3.5" />
                    Rejoin
                  </Button>
                ) : canJoin ? (
                  <Button
                    size="sm"
                    variant={contest.has_joined ? "secondary" : "default"}
                    onClick={() => navigate(`/arena/${contest.id}`)}
                    className="gap-1.5 font-body"
                  >
                    {contest.has_joined ? "View Lobby" : isStarted ? "Join Late" : "Join"}
                  </Button>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    {contest.status}
                  </Badge>
                )}
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};

export default ContestsList;
