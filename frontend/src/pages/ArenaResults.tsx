import { useParams, useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Trophy, Medal, Home, RotateCcw, TrendingUp, Crown, ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";
import QuestionReview from "@/components/QuestionReview";

  const ArenaResults = () => {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showReview, setShowReview] = useState(false);

  // Fetch match details, standings, and rating changes
  const { data: results, isLoading } = useQuery({
    queryKey: ["arena-results", matchId],
    queryFn: async () => {
      const data = await api.get(`/api/arena/matches/${matchId}/results`);
      return data;
    },
    enabled: !!matchId,
  });

  const match = results?.match;
  const standings = results?.standings;
  const ratingChanges = results?.ratingChanges;

  if (isLoading) {
    return (
      <Layout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  const myStanding = standings?.find((s) => s.user_id === user?.id);
  const winner = standings?.[0];
  const isOfficial = match?.is_official;

  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Trophy className="h-6 w-6 text-primary" />;
    if (rank === 2) return <Medal className="h-6 w-6 text-muted-foreground" />;
    if (rank === 3) return <Medal className="h-5 w-5 text-muted-foreground" />;
    return <span className="text-lg font-bold text-muted-foreground">{rank}</span>;
  };

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
  };

  return (
    <Layout>
      <div className="container mx-auto max-w-lg px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Winner Announcement */}
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-6 text-center">
            <Trophy className="mx-auto mb-3 h-12 w-12 text-primary" />
            <h1 className="mb-1 font-display text-2xl font-bold text-foreground">
              {winner?.user_id === user?.id ? "You Won!" : `${winner?.display_name} Wins!`}
            </h1>
            <p className="text-sm text-muted-foreground">
              {(match?.quizzes as any)?.title}
            </p>
            {isOfficial && (
              <Badge variant="secondary" className="mt-2 gap-1">
                <Crown className="h-3 w-3" />
                War
              </Badge>
            )}
          </div>

          {/* Your Result */}
          {myStanding && myStanding.rank !== 1 && (
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <p className="text-sm text-muted-foreground">Your Rank</p>
              <p className="font-display text-3xl font-bold text-foreground">
                #{myStanding.rank}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Score: {myStanding.score} • Time: {formatTime(myStanding.total_time_ms)}
              </p>
            </div>
          )}

          {/* Final Standings */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-4 font-display text-lg font-semibold text-foreground">
              Final Standings
            </h2>
            <div className="space-y-2">
              {standings?.map((player) => (
                <motion.div
                  key={player.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: player.rank * 0.1 }}
                  className={`flex items-center justify-between rounded-lg px-4 py-3 ${
                    player.user_id === user?.id
                      ? "bg-primary/10 ring-1 ring-primary/30"
                      : "bg-muted/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center">
                      {getRankIcon(player.rank)}
                    </div>
                    <div>
                      <p className="font-body font-medium text-foreground">
                        {player.display_name}
                        {player.user_id === user?.id && (
                          <Badge variant="secondary" className="ml-2 text-xs">You</Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatTime(player.total_time_ms)} total
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-lg font-bold text-foreground">{player.score}</p>
                    <p className="text-xs text-muted-foreground">points</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Question Review */}
          {myStanding && match?.quiz_id && (
            <div className="rounded-xl border border-border bg-card p-4">
              <button
                onClick={() => setShowReview(!showReview)}
                className="flex w-full items-center justify-between text-left"
              >
                <h2 className="font-display text-lg font-semibold text-foreground">
                  Question Review
                </h2>
                <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${showReview ? "rotate-180" : ""}`} />
              </button>
              {showReview && (
                <div className="mt-4">
                  <QuestionReview
                    quizId={match.quiz_id}
                    answers={(myStanding.answers as any[]) ?? []}
                  />
                </div>
              )}
            </div>
          )}

          {/* Rating Note for Official */}
          {isOfficial && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-center">
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-primary" />
                ELO ratings have been updated based on this war.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => navigate("/")}
              className="flex-1 gap-2"
            >
              <Home className="h-4 w-4" />
              Home
            </Button>
            <Button
              onClick={() => navigate("/arena")}
              className="flex-1 gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Play Again
            </Button>
          </div>
        </motion.div>
      </div>
    </Layout>
  );
};

export default ArenaResults;
