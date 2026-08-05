import Link from "next/link";

export default function ApplicationPage() {
  return (
    <div className="flex flex-1 w-full items-center justify-center p-6">
      <div className="flex flex-col gap-6 w-full max-w-sm">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back</Link>
        <p className="text-2xl font-bold">Application</p>
      </div>
    </div>
  );
}
