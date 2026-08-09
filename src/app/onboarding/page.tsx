"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRoleSim } from "@/components/role-simulation-provider";

// Progressively formats digits as (xxx) xxx-xxxx while typing.
function formatPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export default function OnboardingPage() {
  const router = useRouter();
  // `persona` is the real access-derived persona for everyone except VP
  // Tech, who can simulate any persona — so gating on persona === "exec"
  // means: real exec always passes, VP Tech only passes while simulating
  // exec, and member/board are bounced either way (real or simulated).
  const { ready: rolesReady, persona } = useRoleSim();
  const viewingAsExec = persona === "exec";
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [preferredFirstname, setPreferredFirstname] = useState("");
  const [lastname, setLastname] = useState("");
  const [major, setMajor] = useState("");
  const [gradYear, setGradYear] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [github, setGithub] = useState("");
  const [interests, setInterests] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Wait for roles to resolve before deciding whether an already-onboarded
    // visitor gets bounced, so we don't misclassify them before we know
    // their (possibly simulated) persona.
    if (!rolesReady) return;
    const supabase = createClient();

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/auth/login");
        return;
      }
      setUserId(user.id);
      setEmail(user.email ?? null);

      // Onboarding has no route guard against being typed in directly, so
      // anyone who already has a members row and isn't viewing as exec gets
      // bounced back to the app instead of re-onboarding — member/board are
      // bounced even for VP Tech unless they're simulating exec. Exec (real
      // or simulated) can still reach it, e.g. to fix their own profile —
      // pre-fill so re-submitting doesn't blank out their existing data.
      const { data: existing } = await supabase
        .from("members")
        .select("preferred_firstname, lastname, major, grad_year, phone, linkedin, github, interests")
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing && !viewingAsExec) {
        router.replace("/");
        return;
      }

      if (existing) {
        setPreferredFirstname(existing.preferred_firstname ?? "");
        setLastname(existing.lastname ?? "");
        setMajor(existing.major ?? "");
        setGradYear(existing.grad_year ?? "");
        setPhone(existing.phone ?? "");
        setLinkedin(existing.linkedin ?? "");
        setGithub(existing.github ?? "");
        setInterests(existing.interests ?? "");
      }
    };

    load();
  }, [router, rolesReady, viewingAsExec]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !preferredFirstname.trim() || !lastname.trim()) return;

    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: upsertError } = await supabase
      .from("members")
      .upsert(
        {
          user_id: userId,
          preferred_firstname: preferredFirstname.trim(),
          lastname: lastname.trim(),
          email,
          major: major.trim(),
          grad_year: gradYear.trim(),
          phone: phone.trim(),
          linkedin: linkedin.trim(),
          github: github.trim(),
          interests: interests.trim(),
        },
        { onConflict: "user_id" },
      );

    if (upsertError) {
      setError(upsertError.message);
      setLoading(false);
      return;
    }

    router.replace("/");
  };

  return (
    <div className="flex flex-1 w-full items-center justify-center p-6">
      <div className="flex flex-col gap-6 w-full max-w-md">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">Welcome to Open Project!</h1>
          <p className="text-sm text-muted-foreground">
            This is Open Portal, our hub for everything Open Project — let&apos;s get your profile set up.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Preferred first name</label>
              <input
                type="text"
                value={preferredFirstname}
                onChange={(e) => setPreferredFirstname(e.target.value)}
                placeholder="Preferred first name"
                required
                className="border rounded-md px-3 py-2 text-sm w-full"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Last name</label>
              <input
                type="text"
                value={lastname}
                onChange={(e) => setLastname(e.target.value)}
                placeholder="Last name"
                required
                className="border rounded-md px-3 py-2 text-sm w-full"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Major(s)</label>
              <input
                type="text"
                value={major}
                onChange={(e) => setMajor(e.target.value)}
                placeholder="Major(s)"
                className="border rounded-md px-3 py-2 text-sm w-full"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Grad year</label>
              <input
                type="text"
                value={gradYear}
                onChange={(e) => setGradYear(e.target.value)}
                placeholder="Grad year"
                className="border rounded-md px-3 py-2 text-sm w-full"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
                placeholder="(510) 555-0123"
                className="border rounded-md px-3 py-2 text-sm w-full"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">LinkedIn</label>
            <input
              type="text"
              value={linkedin}
              onChange={(e) => setLinkedin(e.target.value)}
              placeholder="linkedin.com/in/your-name"
              className="border rounded-md px-3 py-2 text-sm w-full"
            />
            <p className="text-xs text-muted-foreground">Don&apos;t have one? Make one — it takes two minutes.</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">GitHub</label>
            <input
              type="text"
              value={github}
              onChange={(e) => setGithub(e.target.value)}
              placeholder="github.com/your-username"
              className="border rounded-md px-3 py-2 text-sm w-full"
            />
            <p className="text-xs text-muted-foreground">Don&apos;t have one? Make one — it takes two minutes.</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Interests</label>
            <textarea
              value={interests}
              onChange={(e) => setInterests(e.target.value)}
              placeholder="Interests"
              rows={2}
              className="border rounded-md px-3 py-2 text-sm w-full resize-none"
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading || !preferredFirstname.trim() || !lastname.trim()}
            className="bg-foreground text-background rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Saving..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
