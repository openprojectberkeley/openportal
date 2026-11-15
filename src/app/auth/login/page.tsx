import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/login-form";

export default function Page() {
  return (
    <AuthShell>
      <div className="w-full">
        <LoginForm />
      </div>
    </AuthShell>
  );
}
