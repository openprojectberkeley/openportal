"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { centredOriginFromClick } from "@/lib/click-origin";
import { optimistic } from "@/lib/optimistic";
import { MultiCombobox, joinList, splitList } from "@/components/ui/combobox";
import { BERKELEY_MAJORS } from "@/lib/majors";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/overlay-scrollbar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, X } from "lucide-react";

const CLASS_YEARS = ["Freshman", "Sophomore", "Junior", "Senior", "Postgrad"] as const;
import { AvatarPicker } from "@/components/avatar-picker";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { InfoHint } from "@/components/ui/info-hint";
import { PronounsPicker } from "@/components/pronouns-field";

// LinkedIn/GitHub are edited as handles behind a fixed prefix. Stored values
// may be full URLs, "linkedin.com/in/…" or bare handles; anything that isn't
// recognisably one of those is left as typed.
const LINK_PREFIX = { linkedin: "linkedin.com/in/", github: "github.com/" } as const;
type LinkKey = keyof typeof LINK_PREFIX;
const LINK_RE: Record<LinkKey, RegExp> = {
  linkedin: /^(https?:\/\/)?(www\.)?linkedin\.com\/in\//i,
  github: /^(https?:\/\/)?(www\.)?github\.com\//i,
};
function toHandle(key: LinkKey, value: string): string {
  return value.trim().replace(LINK_RE[key], "").replace(/\/+$/, "");
}
function fromHandle(key: LinkKey, handle: string): string {
  const h = toHandle(key, handle);
  if (!h) return "";
  return /[./]/.test(h) ? h : `${LINK_PREFIX[key]}${h}`;
}

type ProfileFields = {
  preferred_firstname: string;
  lastname: string;
  major: string;
  grad_year: string;
  phone: string;
  linkedin: string;
  github: string;
  interests: string;
  pronouns: string;
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
  pronouns: "",
};

const LABELS: Record<keyof ProfileFields, string> = {
  preferred_firstname: "Preferred first name",
  lastname: "Last name",
  major: "Major",
  grad_year: "Year",
  phone: "Phone",
  linkedin: "LinkedIn",
  github: "GitHub",
  interests: "Interests",
  pronouns: "Pronouns",
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onSave?: (fields: ProfileFields, avatarUrl: string | null) => void;
};

export function ProfileDialog({ open, onOpenChange, userId, onSave }: Props) {
  const [fields, setFields] = useState<ProfileFields>(EMPTY);
  const [pronounsPublic, setPronounsPublic] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef<{ fields: ProfileFields; avatarUrl: string | null } | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Same entrance as ui/dialog: grow out of the press that opened it (the
  // navbar menu item), set before first paint.
  useLayoutEffect(() => {
    if (open && mounted && panelRef.current) {
      panelRef.current.style.transformOrigin = centredOriginFromClick();
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    supabase
      .from("members")
      .select("preferred_firstname, lastname, major, grad_year, phone, linkedin, github, interests, pronouns, pronouns_public, avatar_url")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          loadedRef.current = {
            fields: {
              preferred_firstname: data.preferred_firstname ?? "",
              lastname: data.lastname ?? "",
              major: data.major ?? "",
              grad_year: data.grad_year ?? "",
              phone: data.phone ?? "",
              linkedin: data.linkedin ?? "",
              github: data.github ?? "",
              interests: data.interests ?? "",
              pronouns: data.pronouns ?? "",
            },
            avatarUrl: data.avatar_url ?? null,
          };
          setFields({
            ...loadedRef.current.fields,
            linkedin: toHandle("linkedin", data.linkedin ?? ""),
            github: toHandle("github", data.github ?? ""),
          });
          setPronounsPublic(data.pronouns_public ?? true);
          setAvatarUrl(data.avatar_url ?? null);
        }
      });
  }, [open, userId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Closes and updates the navbar at once; the row is written behind it. A
  // refusal puts the navbar back to the profile as it was loaded and toasts
  // with Retry (which re-sends these exact values).
  const handleSave = () => {
    setError(null);
    const supabase = createClient();
    const saved = {
      fields: { ...fields, linkedin: fromHandle("linkedin", fields.linkedin), github: fromHandle("github", fields.github) },
      avatarUrl,
      pronounsPublic,
    };
    const before = loadedRef.current;
    void optimistic({
      label: "profile",
      key: `profile:${userId}`,
      apply: () => {
        onSave?.(saved.fields, saved.avatarUrl);
        onOpenChange(false);
      },
      rollback: () => {
        if (before) onSave?.(before.fields, before.avatarUrl);
      },
      commit: () =>
        supabase
          .from("members")
          .update({ ...saved.fields, pronouns_public: saved.pronounsPublic, avatar_url: saved.avatarUrl })
          .eq("user_id", userId)
          .select("user_id"),
      requireRows: true,
    });
  };

  if (!mounted || !open) return null;

  const renderField = (key: keyof ProfileFields) => (
    <div key={key} className="flex flex-col gap-1">
      <Label htmlFor={key}>{LABELS[key]}</Label>
      {key === "major" ? (
        // Pick from the list or type your own; stored comma-separated.
        <MultiCombobox
          aria-label="Major(s)"
          creatable
          value={splitList(fields.major)}
          onChange={(v) => setFields((f) => ({ ...f, major: joinList(v) }))}
          options={BERKELEY_MAJORS.map((m) => ({ value: m, label: m }))}
          placeholder="Major(s)"
          searchPlaceholder="Search or type a major…"
        />
      ) : key === "pronouns" ? (
        <PronounsPicker
          value={fields[key]}
          onChange={(v) => setFields((f) => ({ ...f, pronouns: v }))}
          triggerClassName="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          inputClassName="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      ) : key === "interests" ? (
        <Textarea
          id={key}
          value={fields[key]}
          onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
          rows={3}
          placeholder="What you're into, in a sentence or two"
          className="resize-none"
        />
      ) : key === "linkedin" || key === "github" ? (
        // Prefixed field: the fixed part of the URL sits inside the input.
        <div className="flex h-9 w-full items-center rounded-md border border-input shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring">
          <span className="select-none whitespace-nowrap pl-3 text-sm text-muted-foreground">{LINK_PREFIX[key]}</span>
          <input
            id={key}
            value={fields[key]}
            onChange={(e) => setFields((f) => ({ ...f, [key]: toHandle(key, e.target.value) }))}
            placeholder="username"
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent pr-3 text-base placeholder:text-muted-foreground/60 focus:outline-none md:text-sm"
          />
        </div>
      ) : key === "grad_year" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              id={key}
              type="button"
              className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span className={fields[key] ? "" : "text-muted-foreground"}>
                {fields[key] || "Select year"}
              </span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[9rem]">
            <DropdownMenuRadioGroup
              value={fields[key]}
              onValueChange={(v) => setFields((f) => ({ ...f, [key]: v }))}
            >
              <DropdownMenuRadioItem value="">Select year</DropdownMenuRadioItem>
              {CLASS_YEARS.map((year) => (
                <DropdownMenuRadioItem key={year} value={year}>{year}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Input
          id={key}
          value={fields[key]}
          onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
        />
      )}
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] animate-in fade-in-0 duration-3 ease-out-quart"
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={panelRef}
        className="relative z-10 w-full max-w-lg rounded-lg border glass-strong shadow-overlay flex flex-col max-h-[90vh] animate-in fade-in-0 zoom-in-50 duration-[280ms] ease-out-expo"
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
        <ScrollArea className="min-h-0" viewportClassName="px-6 pb-6 flex flex-col gap-6">
          {/* Who you are: photo (click to change) beside names and pronouns. */}
          <div className="flex items-start gap-5">
            <AvatarPicker
              userId={userId}
              value={avatarUrl}
              name={[fields.preferred_firstname, fields.lastname].filter(Boolean).join(" ")}
              onChange={setAvatarUrl}
              className="mt-5"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                {renderField("preferred_firstname")}
                {renderField("lastname")}
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="pronouns">{LABELS.pronouns}</Label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Show on profile
                    <InfoHint label="About pronoun visibility">
                      Visible to everyone when on. Turn it off to keep them private.
                    </InfoHint>
                    <Switch
                      checked={pronounsPublic}
                      onCheckedChange={setPronounsPublic}
                      aria-label="Show pronouns on profile"
                      className="ml-1 scale-90"
                    />
                  </label>
                </div>
                <PronounsPicker
                  value={fields.pronouns}
                  onChange={(v) => setFields((f) => ({ ...f, pronouns: v }))}
                  triggerClassName="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  inputClassName="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>
          </div>

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Academic</h3>
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
              {renderField("major")}
              {renderField("grad_year")}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact</h3>
            <div className="grid grid-cols-2 gap-3">
              {renderField("phone")}
              <span aria-hidden />
              {renderField("linkedin")}
              {renderField("github")}
            </div>
          </section>

          {renderField("interests")}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              Save
            </Button>
          </div>
        </ScrollArea>
      </div>
    </div>,
    document.body,
  );
}
