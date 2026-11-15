import { AdminPageSkeleton } from "@/components/skeletons";

// Shown the instant /admin is navigated to, before the page's JS arrives.
export default function AdminLoading() {
  return <AdminPageSkeleton />;
}
