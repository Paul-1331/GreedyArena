import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Pencil, Check, X, Mail, Calendar, Shield, Trophy, Swords, Clock, BookOpen, TrendingUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import QuestionReview from "@/components/QuestionReview";

interface ProfileData {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  name_changes_remaining: number;
  created_at: string;
}

interface Stats {
  quizzesCreated: number;
  quizzesTaken: number;
  avgAccuracy: number;
  glickoRating: number;
  glickoDeviation: number;
  officialMatches: number;
  officialWins: number;
  officialScore: number;
}

const Profile = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [expandedQuiz, setExpandedQuiz] = useState<string | null>(null);
  const [expandedArena, setExpandedArena] = useState<string | null>(null);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => api.get<ProfileData>("/api/profiles/me"),
    enabled: !!user,
  });

  const { data: stats } = useQuery({
    queryKey: ["profile-stats"],
    queryFn: () => api.get<Stats>("/api/profiles/me/stats"),
    enabled: !!user,
  });

  const { data: quizHistory } = useQuery({
    queryKey: ["quiz-history"],
    queryFn: () => api.get<any[]>("/api/profiles/me/quiz-history"),
    enabled: !!user,
  });

  const { data: arenaHistory } = useQuery({
    queryKey: ["arena-history"],
    queryFn: () => api.get<any[]>("/api/profiles/me/arena-history"),
    enabled: !!user,
  });

  useEffect(() => {
    if (profile?.display_name) setNewName(profile.display_name);
  }, [profile?.display_name]);

  const updateName = useMutation({
    mutationFn: (name: string) => api.put<{ display_name: string; name_changes_remaining: number }>("/api/profiles/me/name", { display_name: name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      setEditingName(false);
      toast.success("Display name updated!");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Update failed"),
  });

  const changesLeft = profile?.name_changes_remaining ?? 2;
  const displayName = profile?.display_name || "User";
  const avatarUrl = profile?.avatar_url ?? undefined;
  const initials = displayName.slice(0, 2).toUpperCase();
  const joinDate = profile?.created_at ? format(new Date(profile.created_at), "MMMM yyyy") : "—";

  if (isLoading) {
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
      <div className="container mx-auto max-w-2xl px-4 py-8">
        {/* Profile Header */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <Avatar className="h-20 w-20 border-2 border-primary/20">
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback className="bg-primary text-lg text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 text-center sm:text-left">
                {editingName ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="max-w-[220px] font-display text-lg"
                      maxLength={30}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") updateName.mutate(newName);
                        if (e.key === "Escape") setEditingName(false);
                      }}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => updateName.mutate(newName)}
                      disabled={updateName.isPending}
                    >
                      {updateName.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-primary" />}
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setEditingName(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h1 className="font-display text-2xl font-bold text-foreground">{displayName}</h1>
                    {changesLeft > 0 && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingName(true)}>
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                )}

                <p className="mt-0.5 text-sm text-muted-foreground">
                  {changesLeft > 0
                    ? `${changesLeft} name change${changesLeft === 1 ? "" : "s"} remaining`
                    : "No name changes remaining"}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" />
                    {profile?.email}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    Joined {joinDate}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="font-display text-lg">Your Stats</CardTitle>
            <CardDescription>A summary of your activity on GreedyArena</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <StatBox icon={<Trophy className="h-5 w-5 text-primary" />} label="Quizzes Taken" value={stats?.quizzesTaken ?? 0} />
              <StatBox icon={<Shield className="h-5 w-5 text-primary" />} label="Avg Accuracy" value={`${stats?.avgAccuracy ?? 0}%`} />
              <StatBox icon={<Pencil className="h-5 w-5 text-primary" />} label="Quizzes Created" value={stats?.quizzesCreated ?? 0} />
              <StatBox icon={<TrendingUp className="h-5 w-5 text-primary" />} label="ELO" value={`${stats?.glickoRating ?? 1500} ±${stats?.glickoDeviation ?? 350}`} />
              <StatBox icon={<Swords className="h-5 w-5 text-primary" />} label="Wars" value={stats?.officialMatches ?? 0} />
              <StatBox icon={<Trophy className="h-5 w-5 text-primary" />} label="War Trophies" value={stats?.officialScore ?? 0} />
            </div>
          </CardContent>
        </Card>

        {/* History */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">History</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="quizzes">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="quizzes" className="gap-1.5 font-body">
                  <BookOpen className="h-3.5 w-3.5" />
                  Quiz Attempts
                </TabsTrigger>
                <TabsTrigger value="arena" className="gap-1.5 font-body">
                  <Swords className="h-3.5 w-3.5" />
                  Battles
                </TabsTrigger>
              </TabsList>

              <TabsContent value="quizzes" className="mt-4 space-y-2">
                {!quizHistory?.length ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No quiz attempts yet.</p>
                ) : (
                  quizHistory.map((attempt) => (
                    <div key={attempt.id} className="rounded-lg bg-muted/50 transition-colors">
                      <div
                        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/80"
                        onClick={() => setExpandedQuiz(expandedQuiz === attempt.id ? null : attempt.id)}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-body text-sm font-medium text-foreground">
                            {attempt.quiz?.title ?? "Unknown Quiz"}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {attempt.quiz?.category && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {attempt.quiz.category}
                              </Badge>
                            )}
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDistanceToNow(new Date(attempt.created_at), { addSuffix: true })}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pl-3">
                          <div className="text-right">
                            <p className="font-mono text-lg font-bold text-foreground">
                              {attempt.score}/{attempt.total_questions}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {attempt.total_questions > 0
                                ? `${Math.round((attempt.score / attempt.total_questions) * 100)}%`
                                : "—"}
                            </p>
                          </div>
                          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expandedQuiz === attempt.id ? "rotate-180" : ""}`} />
                        </div>
                      </div>
                      {expandedQuiz === attempt.id && (
                        <div className="border-t border-border px-4 py-3">
                          <QuestionReview
                            quizId={attempt.quiz_id}
                            answers={(attempt.answers as any[]) ?? []}
                          />
                        </div>
                      )}
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="arena" className="mt-4 space-y-2">
                {!arenaHistory?.length ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No battles yet.</p>
                ) : (
                  arenaHistory.map((entry) => (
                    <div key={entry.match_id} className="rounded-lg bg-muted/50 transition-colors">
                      <div
                        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/80"
                        onClick={() => setExpandedArena(expandedArena === entry.match_id ? null : entry.match_id)}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-body text-sm font-medium text-foreground">
                              {entry.quizTitle}
                            </p>
                            {entry.match?.is_official ? (
                              <Badge className="bg-primary/20 text-primary text-[10px] px-1.5 py-0">
                                ⚔️ War
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                Friendly
                              </Badge>
                            )}
                            {entry.isWinner && (
                              <Badge className="bg-primary/20 text-primary text-[10px] px-1.5 py-0">
                                🏆 Win
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">{entry.match?.room_code}</span>
                            <span>·</span>
                            <span>{entry.playerCount} player{entry.playerCount !== 1 ? "s" : ""}</span>
                            <span>·</span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDistanceToNow(new Date(entry.joined_at), { addSuffix: true })}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pl-3">
                          <div className="text-right">
                            <p className="font-mono text-lg font-bold text-foreground">{entry.score}</p>
                            <p className="text-xs text-muted-foreground">
                              {entry.answeredCount} answered
                            </p>
                          </div>
                          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expandedArena === entry.match_id ? "rotate-180" : ""}`} />
                        </div>
                      </div>
                      {expandedArena === entry.match_id && entry.match?.quiz_id && (
                        <div className="border-t border-border px-4 py-3">
                          <QuestionReview
                            quizId={entry.match.quiz_id}
                            answers={(entry.answers as any[]) ?? []}
                          />
                        </div>
                      )}
                    </div>
                  ))
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

const StatBox = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) => (
  <div className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-muted/30 p-4 text-center">
    {icon}
    <span className="font-display text-xl font-bold text-foreground">{value}</span>
    <span className="text-xs text-muted-foreground">{label}</span>
  </div>
);

export default Profile;