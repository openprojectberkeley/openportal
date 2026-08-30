"use client";

import { useState } from "react";
import { CircleHelp, Send, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRoleSim } from "@/components/role-simulation-provider";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

type SendState = "idle" | "sending" | "sent" | "error";

// A persistent bottom-right "?" button that lets any signed-in user draft a
// message to the tech team. Sending routes through the send-support-email edge
// function (the static site can't send mail directly). Mounted once in the
// authenticated app layout so it appears on every signed-in page.
export function SupportButton() {
  const { canSimulate } = useRoleSim();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<SendState>("idle");
  const [error, setError] = useState<string | null>(null);

  // The role-sim "View as" pill also lives at bottom-4 right-4; lift the button
  // above it when that pill is present so they don't overlap.
  const bottomClass = canSimulate ? "bottom-20" : "bottom-4";

  async function handleSend() {
    const trimmed = message.trim();
    if (!trimmed || state === "sending") return;
    setState("sending");
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: invokeError } = await supabase.functions.invoke(
        "send-support-email",
        { body: { message: trimmed } },
      );
      if (invokeError || (data && (data as { error?: string }).error)) {
        throw new Error(
          (data as { error?: string })?.error ?? invokeError?.message ?? "Send failed",
        );
      }
      setState("sent");
      setMessage("");
      // Briefly show the confirmation, then close and reset.
      setTimeout(() => {
        setOpen(false);
        setState("idle");
      }, 1600);
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    }
  }

  return (
    <>
      {open && (
        <div
          className={cn(
            "fixed right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col rounded-xl border bg-background/95 shadow-lg backdrop-blur",
            canSimulate ? "bottom-36" : "bottom-20",
          )}
          role="dialog"
          aria-label="Contact tech support"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Contact Tech Support</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex flex-col gap-3 p-4">
            {state === "sent" ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Message sent — the tech team will be in touch.
              </p>
            ) : (
              <>
                <textarea
                  autoFocus
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe what you're stuck on…"
                  maxLength={5000}
                  className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {error && <p className="text-xs text-destructive">{error}</p>}
                <div className="flex items-center justify-end">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSend}
                    disabled={!message.trim() || state === "sending"}
                  >
                    <Send className="size-4" />
                    {state === "sending" ? "Sending…" : "Send"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <HoverCard openDelay={200} closeDelay={100}>
        <HoverCardTrigger asChild>
          <Button
            type="button"
            size="icon"
            aria-label="Contact tech support"
            onClick={() => setOpen((v) => !v)}
            className={cn("fixed right-4 z-50 size-11 rounded-full shadow-lg", bottomClass)}
          >
            <CircleHelp className="size-5" />
          </Button>
        </HoverCardTrigger>
        <HoverCardContent side="left" align="end" className="w-auto py-2 text-sm">
          Stuck? Contact Tech for support
        </HoverCardContent>
      </HoverCard>
    </>
  );
}
