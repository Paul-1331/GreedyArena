import { api } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";

interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  score: number;
}

interface LiveMatchLeaderboardProps {
  matchId: string;
  isSpectator?: boolean;
}

const LiveMatchLeaderboard = ({ matchId, isSpectator }: LiveMatchLeaderboardProps) => {
  const { data: entries, isLoading } = useQuery({
    queryKey: ["live-leaderboard", matchId],
    queryFn: async () => {
      const data = await api.get<LeaderboardEntry[]>(`/api/arena/matches/${matchId}/live-leaderboard`);
      return data.sort((a, b) => b.score - a.score);
    },
    refetchInterval: 30000, // Poll every 30 seconds
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" />
          <h2 className="font-display text-xl font-bold text-foreground">Live Standings</h2>
        </div>
        {isSpectator && (
          <Badge variant="outline" className="font-mono bg-primary/5 text-primary border-primary/20">
            SPECTATING
          </Badge>
        )}
      </div>

      {!entries || entries.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">No players found.</p>
      ) : (
        <ul className="space-y-3">
          <AnimatePresence>
            {entries.map((entry, index) => (
              <motion.li
                key={entry.user_id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3 shadow-sm"
              >
                <div className="flex items-center gap-4">
                  <span className="font-display text-lg font-bold text-muted-foreground w-6 text-center">
                    #{index + 1}
                  </span>
                  <div className="flex items-center gap-2">
                    {entry.avatar_url ? (
                      <img src={entry.avatar_url} alt="avatar" className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xs">
                        {entry.display_name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="font-body font-medium text-foreground">
                      {entry.display_name}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="font-mono text-sm px-3 py-1">
                    {entry.score} pts
                  </Badge>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
};

export default LiveMatchLeaderboard;
