import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Loader2, Trophy, Swords, Medal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";

interface HistoryEntry {
  match_id: string;
  quiz_title: string;
  category: string;
  is_official: boolean;
  score: number;
  rank: number;
  total_participants: number;
  finished_at: string | null;
}

const PastMatches = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: matches, isLoading } = useQuery({
    queryKey: ["arena-past-matches"],
    queryFn: () => api.get<HistoryEntry[]>("/api/arena/history"),
    enabled: !!user,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!matches?.length) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <Swords className="mx-auto mb-3 h-10 w-10 opacity-50" />
        <p className="font-body">No past battles yet.</p>
        <p className="text-sm">Play some battles to see them here!</p>
      </div>
    );
  }

  const getRankDisplay = (rank: number) => {
    if (rank === 1) return <Trophy className="h-4 w-4 text-primary" />;
    if (rank === 2) return <Medal className="h-4 w-4 text-muted-foreground" />;
    if (rank === 3) return <Medal className="h-3.5 w-3.5 text-muted-foreground" />;
    return <span className="text-xs font-bold text-muted-foreground">#{rank}</span>;
  };

  return (
    <div className="space-y-2">
      {matches.map((match, idx) => (
        <motion.div
          key={match.match_id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.03 }}
          onClick={() => navigate(`/arena/${match.match_id}/results`)}
          className="flex cursor-pointer items-center justify-between rounded-lg bg-muted/50 px-4 py-3 transition-colors hover:bg-muted"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center">
              {getRankDisplay(match.rank)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-body text-sm font-medium text-foreground">
                  {match.quiz_title}
                </p>
                {match.is_official ? (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">War</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">Friendly</Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{match.total_participants} player{match.total_participants !== 1 ? "s" : ""}</span>
                <span>·</span>
                <span>Rank #{match.rank}</span>
                {match.finished_at && (
                  <>
                    <span>·</span>
                    <span>{formatDistanceToNow(new Date(match.finished_at), { addSuffix: true })}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="font-mono text-lg font-bold text-foreground">{match.score}</p>
            <p className="text-xs text-muted-foreground">pts</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
};

export default PastMatches;