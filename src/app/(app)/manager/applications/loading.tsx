import { ApplicationManagerSkeleton } from "@/components/skeletons";

// Route-transition placeholder: mirrors the applications page shell (header +
// period bar + list) so navigating in shows the same layout instead of a blank
// screen or a mismatched generic skeleton.
export default function Loading() {
  return <ApplicationManagerSkeleton />;
}
