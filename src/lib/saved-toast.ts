import { toast } from "sonner";

/**
 * Instant "it saved" cue for edits whose form closes on save (dialogs,
 * popovers), where an in-place SaveButton flash would vanish with the form.
 * Fire it with the optimistic apply, not when the round trip lands: a refusal
 * still rolls back, dismisses this, and shows the error toast instead.
 */
export function toastSaved(message = "Saved") {
  toast.success(message, { id: "saved", duration: 1800 });
}
