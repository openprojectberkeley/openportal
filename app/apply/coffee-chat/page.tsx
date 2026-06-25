import Link from "next/link";

export default function CoffeeChatPage() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6">
      <div className="flex flex-col gap-6 w-full max-w-sm">
        <Link href="/apply" className="text-sm text-muted-foreground hover:underline">← Back</Link>
        <p className="text-2xl font-bold">Coffee chat</p>
      </div>
    </div>
  );
}
