"use client";

import { useRouter } from "next/navigation";

export default function ApplyPage() {
  const router = useRouter();

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6">
      <div className="flex flex-col gap-6 w-full max-w-sm">
        <h1 className="text-2xl font-bold">Get involved</h1>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => router.push("/apply/coffee-chat")}
            className="border rounded-md px-4 py-3 text-sm font-medium text-left hover:bg-accent transition-colors"
          >
            Coffee Chat
          </button>
          <button
            onClick={() => router.push("/apply/infosession")}
            className="border rounded-md px-4 py-3 text-sm font-medium text-left hover:bg-accent transition-colors"
          >
            Infosession
          </button>
          <button
            onClick={() => router.push("/apply/application")}
            className="border rounded-md px-4 py-3 text-sm font-medium text-left hover:bg-accent transition-colors"
          >
            Application
          </button>
        </div>
      </div>
    </div>
  );
}
