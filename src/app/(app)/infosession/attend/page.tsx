"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoHint } from "@/components/ui/info-hint";
import { Check } from "lucide-react";

export default function AttendPage() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;

    setLoading(true);
    setError(null);

    // Codes are stored uppercase, so normalize input to make claiming
    // case-insensitive.
    const normalizedCode = code.trim().toUpperCase();

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setError("You must be signed in to submit.");
      setLoading(false);
      return;
    }

    // Atomic claim: only updates if applicant_id is still null.
    // Handles race conditions — two concurrent submits serialize at the DB
    // row level; only one wins the update, the other gets 0 rows back.
    const { data: claimed, error: updateError } = await supabase
      .from("infosesh_attendance")
      .update({ applicant_id: user.id })
      .eq("code", normalizedCode)
      .is("applicant_id", null)
      .select();

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    if (claimed && claimed.length > 0) {
      setSubmitted(true);
      setLoading(false);
      return;
    }

    // 0 rows updated — find out why
    const { data: existing } = await supabase
      .from("infosesh_attendance")
      .select("applicant_id")
      .eq("code", normalizedCode)
      .maybeSingle();

    if (!existing) {
      setError("No code found with that value. Double-check with your PM.");
    } else {
      setError("That code has already been used by someone else.");
    }

    setLoading(false);
  };

  if (submitted) {
    return (
      <div className="flex flex-1 w-full items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 w-full max-w-sm text-center animate-fade-in-up">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
            <Check size={22} />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">Attendance recorded</h1>
          <p className="text-sm text-muted-foreground">Thanks for coming to the infosession.</p>
          <BackLink href="/" label="Dashboard" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg mx-auto p-6 flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <BackLink href="/infosession" label="Infosession" />
        <h1 className="text-2xl font-bold tracking-tight">Submit attendance</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <label htmlFor="code" className="text-sm font-medium">Attendance code</label>
            <InfoHint label="Where to get a code">
              Talk to a PM during the meet and greet. Afterwards, ask them for a code and enter it here.
            </InfoHint>
          </div>
          <Input
            id="code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Code from your PM"
            autoComplete="off"
            autoFocus
            required
            className="h-11 font-mono text-base uppercase tracking-[0.2em] placeholder:font-sans placeholder:tracking-normal placeholder:normal-case"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" disabled={loading || !code.trim()}>
          {loading ? "Checking code…" : "Submit"}
        </Button>
      </form>
    </div>
  );
}
