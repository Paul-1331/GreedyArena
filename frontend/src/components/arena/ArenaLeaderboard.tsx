import { useState } from "react";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Trophy, Medal, Flame, Target, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion } from "framer-motion";

interface LeaderboardEntry {
  rank: number;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  rating: number;
  matches_played: number;
  wins: number;
  total_score: number;
}

const ArenaLeaderboard = () => {
  const { user } = useAuth();
  const [sortBy, setSortBy] = useState<"rating" | "score" | "wins">("rating");

  const { data: leaderboard, isLoading } = useQuery({
    queryKey: ["arena-leaderboard"],
    queryFn: () => api.get<LeaderboardEntry[]>("/api/arena/leaderboard"),
    staleTime: 30000,
  });

  const sorted = [...(leaderboard ?? [])].sort((a, b) => {
    if (sortBy === "rating") return b.rating - a.rating || b.total_score - a.total_score;
    if (sortBy === "score") return b.total_score - a.total_score || b.wins - a.wins;
    return b.wins - a.wins || b.total_score - a.total_score;
  });

  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Trophy className="h-5 w-5 text-primary" />;
    if (rank === 2) return <Medal className="h-5 w-5 text-muted-foreground" />;
    if (rank === 3) return <Medal className="h-4 w-4 text-muted-foreground" />;
    return <span className="text-sm font-bold text-muted-foreground">{rank}</span>;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!sorted.length) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <Trophy className="mx-auto mb-3 h-10 w-10 opacity-50" />
        <p className="font-body">No wars completed yet.</p>
        <p className="text-sm">Play wars to see rankings!</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <Tabs value={sortBy} onValueChange={(v) => setSortBy(v as "rating" | "score" | "wins")}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="rating" className="gap-1.5 font-body text-xs">
            <TrendingUp className="h-3.5 w-3.5" />
            Rating
          </TabsTrigger>
          <TabsTrigger value="score" className="gap-1.5 font-body text-xs">
            <Target className="h-3.5 w-3.5" />
            Score
          </TabsTrigger>
          <TabsTrigger value="wins" className="gap-1.5 font-body text-xs">
            <Flame className="h-3.5 w-3.5" />
            Wins
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="space-y-2">
        {sorted.map((entry, idx) => {
          const rank = idx + 1;
          return (
            <motion.div
              key={entry.user_id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04 }}
              className={`flex items-center justify-between rounded-lg px-4 py-3 ${
                entry.user_id === user?.id
                  ? "bg-primary/10 ring-1 ring-primary/30"
                  : "bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center">
                  {getRankIcon(rank)}
                </div>
                <div>
                  <p className="font-body text-sm font-medium text-foreground">
                    {entry.display_name}
                    {entry.user_id === user?.id && (
                      <Badge variant="secondary" className="ml-2 text-xs">You</Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {entry.matches_played} war{entry.matches_played !== 1 ? "s" : ""}
                    {" · "}{entry.wins} win{entry.wins !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono text-lg font-bold text-foreground">
                  {sortBy === "rating"
                    ? entry.rating
                    : sortBy === "score"
                      ? entry.total_score
                      : entry.wins}
                </p>
                <p className="text-xs text-muted-foreground">
                  {sortBy === "rating"
                    ? "rating"
                    : sortBy === "score"
                      ? "total pts"
                      : `win${entry.wins !== 1 ? "s" : ""}`}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default ArenaLeaderboard;