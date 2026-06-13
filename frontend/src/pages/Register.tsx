import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth, ApiError } from "@/contexts/AuthContext";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

const Register = () => {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      await register(email, password, displayName);
      toast.success("Account created!");
      navigate("/");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto flex min-h-[70vh] items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-8">
          <div className="text-center">
            <h1 className="font-display text-2xl font-bold text-foreground">Create an account</h1>
            <p className="mt-1 text-sm text-muted-foreground">Join GreedyArena</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label className="font-body">Display Name</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required className="mt-1 font-body" maxLength={50} />
            </div>
            <div>
              <Label className="font-body">Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-1 font-body" />
            </div>
            <div>
              <Label className="font-body">Password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="mt-1 font-body" minLength={6} />
            </div>
            <Button type="submit" disabled={loading} className="w-full gap-2 font-body">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Sign Up
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="text-primary underline">Sign in</Link>
          </p>
        </div>
      </div>
    </Layout>
  );
};

export default Register;