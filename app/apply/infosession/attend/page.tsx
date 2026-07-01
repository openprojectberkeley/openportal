"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useState } from "react";

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
      .eq("code", code.trim())
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
      .eq("code", code.trim())
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
      <div className="flex min-h-svh w-full items-center justify-center p-6">
        <div className="flex flex-col gap-4 w-full max-w-sm text-center">
          <div className="text-4xl">✓</div>
          <h1 className="text-2xl font-bold">Attendance recorded!</h1>
          <p className="text-sm text-muted-foreground">Thanks for coming to the infosession.</p>
          <Link href="/apply" className="text-sm text-muted-foreground hover:underline mt-2">
            ← Back to apply
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg mx-auto p-6 flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link href="/apply/infosession" className="text-sm text-muted-foreground hover:underline">← Back</Link>
        <h1 className="text-2xl font-bold">Submit Attendance</h1>
      </div>

      <div className="border rounded-xl p-6 flex flex-col gap-4 bg-accent/20">
        <p className="text-sm leading-relaxed">
          Speak to a PM during the meet and greet portion of the infosession.
          After your conversation, ask the PM for a <span className="font-medium">code</span>.
          Enter that code below to record your attendance.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="code" className="text-sm font-medium">Attendance code</label>
          <input
            id="code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter the code from your PM"
            required
            className="border rounded-md px-3 py-2 text-sm w-full bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="w-full rounded-md bg-foreground text-background px-4 py-2.5 text-sm font-medium hover:opacity-80 transition-opacity disabled:opacity-30"
        >
          {loading ? "Submitting..." : "Submit"}
        </button>
      </form>
    </div>
  );
}
