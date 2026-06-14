import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Clock, ShieldCheck, Filter } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import QuizDetailViewer from "@/components/QuizDetailViewer";
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

interface SelectedQuiz {
  id: string;
  title: string;
  category: string;
  difficulty: string;
  status: string;
  description: string | null;
}

type StatusFilter = "submitted" | "approved" | "rejected" | "all";

const statusBadge: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  submitted: { label: "Pending", variant: "outline" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  draft: { label: "Draft", variant: "secondary" },
};

const AdminReviewQueue = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedQuiz, setSelectedQuiz] = useState<SelectedQuiz | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("submitted");

  const { data: quizzes, isLoading } = useQuery({
    queryKey: ["admin-review-queue", statusFilter],
    queryFn: () => api.get<SelectedQuiz[]>(`/api/quizzes/review-queue?status=${statusFilter}`),
    enabled: !!user,
  });

  const updateStatus = useMutation({
    mutationFn: ({ quizId, newStatus }: { quizId: string; newStatus: "approved" | "rejected" }) =>
      api.post(`/api/quizzes/${quizId}/${newStatus === "approved" ? "approve" : "reject"}`),
    onSuccess: (_, { newStatus }) => {
      toast.success(`Quiz ${newStatus}!`);
      setSelectedQuiz(null);
      queryClient.invalidateQueries({ queryKey: ["admin-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["my-quizzes"] });
      queryClient.invalidateQueries({ queryKey: ["quizzes"] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Failed to update"),
  });

  const deleteQuiz = useMutation({
    mutationFn: (quizId: string) => api.delete(`/api/quizzes/${quizId}`),
    onSuccess: () => {
      toast.success("Quiz deleted");
      setDeleteTarget(null);
      setSelectedQuiz(null);
      queryClient.invalidateQueries({ queryKey: ["admin-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["my-quizzes"] });
      queryClient.invalidateQueries({ queryKey: ["quizzes"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to delete"),
  });

  if (selectedQuiz) {
    return (
      <>
        <QuizDetailViewer
          quizId={selectedQuiz.id}
          quizTitle={selectedQuiz.title}
          quizCategory={selectedQuiz.category}
          quizDifficulty={selectedQuiz.difficulty}
          quizStatus={selectedQuiz.status}
          quizDescription={selectedQuiz.description ?? undefined}
          onBack={() => setSelectedQuiz(null)}
          adminActions={{
            onApprove: (id) => updateStatus.mutate({ quizId: id, newStatus: "approved" }),
            onReject: (id) => updateStatus.mutate({ quizId: id, newStatus: "rejected" }),
            onDelete: (id) => setDeleteTarget({ id, title: selectedQuiz.title }),
            isPending: updateStatus.isPending || deleteQuiz.isPending,
          }}
        />
        <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete quiz?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete "{deleteTarget?.title}" and all its questions. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteQuiz.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteTarget && deleteQuiz.mutate(deleteTarget.id)}
                disabled={deleteQuiz.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteQuiz.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status filter */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[160px] font-body text-sm h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="submitted">Pending Review</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="all">All Quizzes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!quizzes || quizzes.length === 0 ? (
        <div className="py-10 text-center text-muted-foreground">
          <ShieldCheck className="mx-auto mb-3 h-10 w-10" />
          <p className="font-body">No quizzes found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {quizzes.map((quiz) => {
            const badge = statusBadge[quiz.status] ?? statusBadge.draft;
            return (
              <button
                key={quiz.id}
                onClick={() => setSelectedQuiz(quiz)}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/50"
              >
                <div>
                  <p className="font-body text-sm font-medium text-foreground">{quiz.title}</p>
                  <p className="text-xs text-muted-foreground">{quiz.category} · {quiz.difficulty}</p>
                </div>
                <Badge variant={badge.variant} className="gap-1 text-xs">
                  <Clock className="h-3 w-3" />
                  {badge.label}
                </Badge>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminReviewQueue;