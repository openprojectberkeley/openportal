"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { IconPicker } from "@/components/icon-picker";
import { ColorPicker } from "@/components/color-picker";
import { ProjectQuestionsDialog } from "@/components/project-questions-dialog";
import { type Difficulty, DIFFICULTIES, DIFFICULTY_LABELS } from "@/lib/projects";

type ProjectType = "studio" | "launch";

const TYPE_LABELS: Record<ProjectType, string> = {
  studio: "OP Studio",
  launch: "OP Launch",
};

// Numeric fields are held as strings while editing, then parsed on save.
type Fields = {
  name: string;
  client: string;
  description: string;
  type: ProjectType;
  difficulty: Difficulty | "";
  estimated_members: string;
  num_subteams: string;
  icon: string;
  iconUrl: string | null;
  color: string;
  coffeeChatRequired: boolean;
};

const toIntOrNull = (s: string) => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};

type Props = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  // When false, the Studio/Launch track is shown read-only (only exec may change
  // it; the DB also enforces this — see migration 0019).
  canEditType?: boolean;
};

// Edit the underlying project's details. Writable by exec or the project's PMs
// (RLS enforces; see migration 0017). Reused from the project portal settings.
export function ProjectEditDialog({ projectId, open, onOpenChange, onSaved, canEditType = true }: Props) {
  const [fields, setFields] = useState<Fields | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questionsOpen, setQuestionsOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    supabase
      .from("projects")
      .select("name, client, description, type, difficulty, estimated_members, num_subteams, icon, icon_url, color, coffee_chat_required")
      .eq("id", projectId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setFields({
            name: data.name ?? "",
            client: data.client ?? "",
            description: data.description ?? "",
            type: (data.type as ProjectType) ?? "launch",
            difficulty: (data.difficulty as Difficulty | null) ?? "",
            estimated_members: data.estimated_members != null ? String(data.estimated_members) : "",
            num_subteams: data.num_subteams != null ? String(data.num_subteams) : "",
            icon: data.icon ?? "",
            iconUrl: (data.icon_url as string | null) ?? null,
            color: data.color ?? "",
            coffeeChatRequired: (data.coffee_chat_required as boolean | null) ?? true,
          });
        }
        setLoading(false);
      });
  }, [open, projectId]);

  const save = async () => {
    if (!fields) return;
    const name = fields.name.trim();
    if (!name) { setError("Name is required."); return; }
    const client = fields.client.trim();
    if (fields.type === "studio" && !client) {
      setError("OP Studio projects require a client.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("projects")
      .update({
        name,
        client: client || null,
        description: fields.description.trim() || null,
        type: fields.type,
        difficulty: fields.difficulty || null,
        estimated_members: toIntOrNull(fields.estimated_members),
        num_subteams: toIntOrNull(fields.num_subteams),
        icon: fields.icon.trim() || null,
        icon_url: fields.iconUrl || null,
        color: fields.color.trim() || null,
        coffee_chat_required: fields.coffeeChatRequired,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);
    if (updateError) { setError(updateError.message); setSaving(false); return; }
    setSaving(false);
    onSaved?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
        </DialogHeader>
        {loading || !fields ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="pe-name">Name</Label>
              <Input
                id="pe-name"
                value={fields.name}
                onChange={(e) => setFields((f) => (f ? { ...f, name: e.target.value } : f))}
              />
            </div>
            <div className="flex gap-3">
              <div className="flex flex-col gap-1 w-28">
                <Label>Icon</Label>
                <IconPicker
                  value={fields.icon}
                  onChange={(v) => setFields((f) => (f ? { ...f, icon: v } : f))}
                  imageUrl={fields.iconUrl}
                  onImageChange={(url) => setFields((f) => (f ? { ...f, iconUrl: url } : f))}
                  projectId={projectId}
                />
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <Label>Accent color</Label>
                <ColorPicker value={fields.color} onChange={(v) => setFields((f) => (f ? { ...f, color: v } : f))} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Type</Label>
              {canEditType ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm bg-background hover:bg-accent transition-colors">
                      {TYPE_LABELS[fields.type]}
                      <ChevronDown size={14} className="text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width]">
                    {(Object.keys(TYPE_LABELS) as ProjectType[]).map((t) => (
                      <DropdownMenuItem key={t} onSelect={() => setFields((f) => (f ? { ...f, type: t } : f))}>
                        {TYPE_LABELS[t]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <div className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm bg-muted/40 text-muted-foreground">
                  <span>{TYPE_LABELS[fields.type]}</span>
                  <span className="text-[11px]">Only exec can change the track</span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pe-client">Client{fields.type === "studio" && <span className="text-red-500"> *</span>}</Label>
              <Input
                id="pe-client"
                value={fields.client}
                onChange={(e) => setFields((f) => (f ? { ...f, client: e.target.value } : f))}
                placeholder={fields.type === "studio" ? "Required for OP Studio" : "Optional"}
              />
            </div>
            {fields.type === "studio" && (
              <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <div className="flex flex-col">
                  <Label htmlFor="pe-coffee" className="cursor-pointer">
                    Coffee chat {fields.coffeeChatRequired ? "required" : "recommended"}
                  </Label>
                  <span className="text-xs text-muted-foreground">
                    {fields.coffeeChatRequired
                      ? "Applicants must chat with a PM before they can submit."
                      : "Applicants are encouraged to chat with a PM, but it won't block them."}
                  </span>
                </div>
                <Switch
                  id="pe-coffee"
                  checked={fields.coffeeChatRequired}
                  onCheckedChange={(v) => setFields((f) => (f ? { ...f, coffeeChatRequired: v === true } : f))}
                />
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <Label>Difficulty</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm bg-background hover:bg-accent transition-colors">
                      {fields.difficulty ? DIFFICULTY_LABELS[fields.difficulty] : "—"}
                      <ChevronDown size={14} className="text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => setFields((f) => (f ? { ...f, difficulty: "" } : f))}>—</DropdownMenuItem>
                    {DIFFICULTIES.map((d) => (
                      <DropdownMenuItem key={d} onSelect={() => setFields((f) => (f ? { ...f, difficulty: d } : f))}>
                        {DIFFICULTY_LABELS[d]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="pe-members">Members</Label>
                <Input
                  id="pe-members"
                  type="number"
                  min={0}
                  value={fields.estimated_members}
                  onChange={(e) => setFields((f) => (f ? { ...f, estimated_members: e.target.value } : f))}
                  placeholder="Est."
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="pe-subteams">Subteams</Label>
                <Input
                  id="pe-subteams"
                  type="number"
                  min={0}
                  value={fields.num_subteams}
                  onChange={(e) => setFields((f) => (f ? { ...f, num_subteams: e.target.value } : f))}
                  placeholder="#"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pe-desc">Description</Label>
              <textarea
                id="pe-desc"
                rows={3}
                value={fields.description}
                onChange={(e) => setFields((f) => (f ? { ...f, description: e.target.value } : f))}
                className="border rounded-md px-3 py-2 text-sm w-full resize-none bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex items-center justify-between gap-2 border-t pt-4">
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Application questions</span>
                <span className="text-xs text-muted-foreground">Custom questions applicants answer for this project.</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => setQuestionsOpen(true)}>
                Manage
              </Button>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save project"}</Button>
            </div>
          </div>
        )}

        <ProjectQuestionsDialog projectId={projectId} open={questionsOpen} onOpenChange={setQuestionsOpen} />
      </DialogContent>
    </Dialog>
  );
}
