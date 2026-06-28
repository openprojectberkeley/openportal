"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

type ProfileFields = {
  preferred_firstname: string;
  lastname: string;
  major: string;
  grad_year: string;
  phone: string;
  linkedin: string;
  github: string;
  interests: string;
};

const EMPTY: ProfileFields = {
  preferred_firstname: "",
  lastname: "",
  major: "",
  grad_year: "",
  phone: "",
  linkedin: "",
  github: "",
  interests: "",
};

const LABELS: Record<keyof ProfileFields, string> = {
  preferred_firstname: "Preferred first name",
  lastname: "Last name",
  major: "Major",
  grad_year: "Graduation year",
  phone: "Phone",
  linkedin: "LinkedIn",
  github: "GitHub",
  interests: "Interests",
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onSave?: (fields: ProfileFields) => void;
};

export function ProfileDialog({ open, onOpenChange, userId, onSave }: Props) {
  const [fields, setFields] = useState<ProfileFields>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    supabase
      .from("members")
      .select("preferred_firstname, lastname, major, grad_year, phone, linkedin, github, interests")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setFields({
            preferred_firstname: data.preferred_firstname ?? "",
            lastname: data.lastname ?? "",
            major: data.major ?? "",
            grad_year: data.grad_year ?? "",
            phone: data.phone ?? "",
            linkedin: data.linkedin ?? "",
            github: data.github ?? "",
            interests: data.interests ?? "",
          });
        }
      });
  }, [open, userId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("members")
      .update(fields)
      .eq("user_id", userId);

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    onSave?.(fields);
    onOpenChange(false);
    setLoading(false);
  };

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={panelRef}
        className="relative z-10 w-full max-w-lg rounded-lg border bg-background shadow-lg flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <h2 className="text-lg font-semibold">Edit profile</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="opacity-70 hover:opacity-100 transition-opacity"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </div>
        <div className="overflow-y-auto px-6 pb-6 flex flex-col gap-4">
          {(Object.keys(EMPTY) as (keyof ProfileFields)[]).map((key) => (
            <div key={key} className="flex flex-col gap-1">
              <Label htmlFor={key}>{LABELS[key]}</Label>
              {key === "interests" ? (
                <textarea
                  id={key}
                  value={fields[key]}
                  onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
                  rows={2}
                  className="border rounded-md px-3 py-2 text-sm w-full resize-none bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
              ) : (
                <Input
                  id={key}
                  value={fields[key]}
                  onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
                />
              )}
            </div>
          ))}
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
