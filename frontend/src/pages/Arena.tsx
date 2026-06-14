import { useState } from "react";
import Layout from "@/components/Layout";
import { motion } from "framer-motion";
import { Swords, Plus, LogIn, Loader2, Trophy, Crown, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import ArenaLeaderboard from "@/components/arena/ArenaLeaderboard";
import PastMatches from "@/components/arena/PastMatches";
import AdminContestCreator from "@/components/arena/AdminContestCreator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ActiveMatch {
  id: string;
  room_code: string;
  status: string;
  is_official: boolean;
  quizzes: { title: string };
}

interface ArenaQuiz {
  id: string;
  title: string;
  category: string;
  difficulty: string;
  status: string;
}

interface OfficialMatch {
  id: string;
  room_code: string;
  status: string;
  scheduled_start_at: string;
  quiz: { title: string; category: string; difficulty: string; time_limit_seconds: number };
  _count: { arena_participants: number };
}

const Arena = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedQuizId, setSelectedQuizId] = useState("");
  const [warToJoin, setWarToJoin] = useState<OfficialMatch | null>(null);

  // Check for active match
  const { data: activeMatch } = useQuery({
    queryKey: ["arena-active-match"],
    queryFn: () => api.get<ActiveMatch | null>("/api/arena/active"),
    enabled: !!user,
    refetchInterval: 5000,
  });

  // Fetch quizzes for casual match creation (approved + own)
  const { data: arenaQuizzes, isLoading: loadingQuizzes } = useQuery({
    queryKey: ["quizzes-for-arena"],
    queryFn: async () => {
      const [approved, mine] = await Promise.all([
        api.get<ArenaQuiz[]>("/api/quizzes"),
        api.get<ArenaQuiz[]>("/api/quizzes/mine"),
      ]);
      const map = new Map<string, ArenaQuiz>();
      approved.forEach((q) => map.set(q.id, { ...q, status: "approved" }));
      mine.forEach((q) => map.set(q.id, q));
      return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
    },
    enabled: !!user,
  });

  const { data: officialMatches } = useQuery({
    queryKey: ["arena-contests"],
    queryFn: () => api.get<OfficialMatch[]>("/api/arena/official-matches"),
    enabled: !!user,
    refetchInterval: 10000,
  });

  const createMatch = useMutation({
    mutationFn: (quizId: string) => api.post<{ id: string; room_code: string }>("/api/arena/matches", { quiz_id: quizId }),
    onSuccess: (match) => {
      toast.success(`Match created! Code: ${match.room_code}`);
      setCreateDialogOpen(false);
      navigate(`/arena/${match.id}`);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to create match"),
  });

  const joinMatch = useMutation({
    mutationFn: (roomCode: string) => api.post<{ id: string }>("/api/arena/matches/join", { room_code: roomCode }),
    onSuccess: (match) => {
      toast.success("Joined match!");
      setJoinCode("");
      navigate(`/arena/${match.id}`);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to join match"),
  });

  if (!user) {
    return (
      <Layout>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
          <LogIn className="h-12 w-12 text-muted-foreground" />
          <h2 className="font-display text-2xl font-bold text-foreground">Sign in to compete</h2>
          <p className="max-w-md text-muted-foreground">You need to be signed in to join Arena matches.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto flex min-h-[70vh] flex-col items-center px-4 py-20">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-lg"
        >
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
            <Swords className="h-10 w-10 text-primary" />
          </div>
          <h1 className="mb-3 text-center font-display text-4xl font-bold text-foreground">Arena</h1>
          <p className="mx-auto mb-8 max-w-md text-center text-muted-foreground">
            Compete in real-time quiz battles. Wars affect your ELO rating.
          </p>

          {/* Active Match Banner */}
          {activeMatch && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 rounded-lg border border-primary/30 bg-primary/10 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20">
                    <Swords className="h-5 w-5 text-primary" />
                  </div>
                  <div className="text-left">
                    <p className="font-body text-sm font-semibold text-foreground">Battle in progress</p>
                    <p className="text-xs text-muted-foreground">
                      Room: <span className="font-mono font-bold tracking-wider">{activeMatch.room_code}</span>
                      {" · "}{activeMatch.quizzes?.title ?? "Quiz"}
                      {activeMatch.is_official && " · War"}
                    </p>
                  </div>
                </div>
                <Button onClick={() => navigate(`/arena/${activeMatch.id}`)} size="sm" className="gap-1.5 font-body">
                  <LogIn className="h-3.5 w-3.5" />
                  Rejoin
                </Button>
              </div>
            </motion.div>
          )}

          <Tabs defaultValue="play" className="w-full">
            <TabsList className="grid w-full grid-cols-4 mb-6">
              <TabsTrigger value="contests" className="gap-1 font-body text-xs sm:text-sm">
                <Crown className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Wars</span>
              </TabsTrigger>
              <TabsTrigger value="play" className="gap-1 font-body text-xs sm:text-sm">
                <Swords className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Friendly</span>
              </TabsTrigger>
              <TabsTrigger value="leaderboard" className="gap-1 font-body text-xs sm:text-sm">
                <Trophy className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Rankings</span>
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1 font-body text-xs sm:text-sm">
                <History className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">History</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="contests" className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-lg font-semibold text-foreground">Official Wars</h2>
                <AdminContestCreator />
              </div>

              {!officialMatches || officialMatches.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/50 p-8 text-center">
                  <Crown className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                  <p className="mt-1 text-sm text-muted-foreground">
                    No upcoming wars. Stay tuned!
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {officialMatches.map((m) => {
                    const startDate = new Date(m.scheduled_start_at);
                    const isPlaying = m.status === 'playing';
                    return (
                      <div key={m.id} className="rounded-lg border border-border bg-card p-4 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                        <div>
                          <p className="font-body font-semibold text-foreground">{m.quiz.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {startDate.toLocaleString()} · {m.quiz.category} · {m.quiz.time_limit_seconds / 60}m
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {m._count.arena_participants} registered
                          </p>
                        </div>
                        <div className="flex gap-2 w-full sm:w-auto">
                          <Button 
                            variant="secondary" 
                            size="sm" 
                            className="flex-1 sm:flex-none font-body"
                            onClick={() => navigate(`/arena/${m.id}`)}
                          >
                            Spectate
                          </Button>
                          <Button 
                            size="sm" 
                            className="flex-1 sm:flex-none font-body"
                            onClick={() => setWarToJoin(m)}
                          >
                            {isPlaying ? "Join Late" : "Register"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="play" className="space-y-6">
              {/* Create Friendly */}
              <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="lg" className="w-full gap-2 font-body">
                    <Plus className="h-5 w-5" />
                    Create Friendly Battle
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="font-display">Create Friendly Battle</DialogTitle>
                    <DialogDescription>
                      Friendlies don't affect your rating. Select a quiz and invite friends.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div>
                      <Label className="font-body">Select Quiz</Label>
                      <Select value={selectedQuizId} onValueChange={setSelectedQuizId}>
                        <SelectTrigger className="mt-1 font-body">
                          <SelectValue placeholder={loadingQuizzes ? "Loading..." : "Choose a quiz"} />
                        </SelectTrigger>
                        <SelectContent>
                          {arenaQuizzes?.map((quiz) => (
                            <SelectItem key={quiz.id} value={quiz.id}>
                              {quiz.title} ({quiz.category}){quiz.status !== "approved" ? ` [${quiz.status}]` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      onClick={() => selectedQuizId && createMatch.mutate(selectedQuizId)}
                      disabled={createMatch.isPending || !selectedQuizId}
                      className="w-full gap-2 font-body"
                    >
                      {createMatch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Create Match
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>

              <div className="flex items-center gap-4">
                <div className="h-px flex-1 bg-border" />
                <span className="text-sm text-muted-foreground">or</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <div className="rounded-lg border border-border bg-card p-6">
                <Label className="font-body">Join with Room Code</Label>
                <div className="mt-2 flex gap-2">
                  <Input
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="ABC123"
                    maxLength={6}
                    className="font-mono text-center text-lg tracking-widest"
                  />
                  <Button
                    onClick={() => joinCode.trim() && joinMatch.mutate(joinCode)}
                    disabled={joinMatch.isPending || !joinCode.trim()}
                    className="gap-2 font-body"
                  >
                    {joinMatch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                    Join
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="leaderboard">
              <ArenaLeaderboard />
            </TabsContent>

            <TabsContent value="history">
              <PastMatches />
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>

      <AlertDialog open={!!warToJoin} onOpenChange={() => setWarToJoin(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Join Official War</AlertDialogTitle>
            <AlertDialogDescription>
              By joining <b>{warToJoin?.quiz.title}</b>, you are officially registering for this rated contest. 
              If you close the tab, lose connection, or score 0, your Glicko-2 rating will be penalized.
              Do you wish to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                if (warToJoin) joinMatch.mutate(warToJoin.room_code);
              }}
            >
              Confirm Registration
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
};

export default Arena;