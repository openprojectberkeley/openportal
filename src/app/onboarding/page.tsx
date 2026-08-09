"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const COUNTRY_CODES = [
  "+1", "+44", "+86", "+91", "+81", "+82", "+852", "+886", "+65", "+61",
  "+49", "+33", "+34", "+39", "+31", "+46", "+52", "+55", "+63", "+62",
  "+84", "+66", "+971", "+972", "+27",
] as const;

// +1 gets the familiar (xxx) xxx-xxxx grouping; any other code just keeps up
// to 10 digits, unformatted, since one grouping pattern doesn't fit every
// country. Re-run whenever the raw digits or the selected code change, so
// switching codes reformats (or un-formats) whatever was already typed.
function formatPhoneNumber(value: string, countryCode: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (countryCode !== "+1") return digits;
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [preferredFirstname, setPreferredFirstname] = useState("");
  const [lastname, setLastname] = useState("");
  const [major, setMajor] = useState("");
  const [gradYear, setGradYear] = useState("");
  const [countryCode, setCountryCode] = useState("+1");
  const [phone, setPhone] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [github, setGithub] = useState("");
  const [interests, setInterests] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.replace("/auth/login");
        return;
      }
      setUserId(user.id);
      setEmail(user.email ?? null);
    });
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !preferredFirstname.trim() || !lastname.trim()) return;

    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("members")
      .insert({
        user_id: userId,
        preferred_firstname: preferredFirstname.trim(),
        lastname: lastname.trim(),
        email,
        major: major.trim(),
        grad_year: gradYear.trim(),
        phone: phone.trim() ? `${countryCode} ${phone.trim()}` : "",
        linkedin: linkedin.trim(),
        github: github.trim(),
        interests: interests.trim(),
      });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    router.replace("/");
  };

  return (
    <div className="flex flex-1 w-full items-center justify-center p-6">
      <div className="flex flex-col gap-6 w-full max-w-md">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">Welcome to Open Project!</h1>
          <p className="text-sm text-muted-foreground">
            This is Open Portal — home base for coffee chats, applications, projects, and
            everything else we get up to. Let&apos;s get your profile set up.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Preferred first name</label>
            <input
              type="text"
              value={preferredFirstname}
              onChange={(e) => setPreferredFirstname(e.target.value)}
              placeholder="Preferred first name"
              required
              className="border rounded-md px-3 py-2 text-sm w-full"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Last name</label>
            <input
              type="text"
              value={lastname}
              onChange={(e) => setLastname(e.target.value)}
              placeholder="Last name"
              required
              className="border rounded-md px-3 py-2 text-sm w-full"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Major(s)</label>
            <input
              type="text"
              value={major}
              onChange={(e) => setMajor(e.target.value)}
              placeholder="Major(s)"
              className="border rounded-md px-3 py-2 text-sm w-full"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Graduation year</label>
            <input
              type="text"
              value={gradYear}
              onChange={(e) => setGradYear(e.target.value)}
              placeholder="Graduation year"
              className="border rounded-md px-3 py-2 text-sm w-full"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Phone</label>
            <div className="flex gap-2">
              <select
                value={countryCode}
                onChange={(e) => {
                  setCountryCode(e.target.value);
                  setPhone((prev) => formatPhoneNumber(prev, e.target.value));
                }}
                className="border rounded-md px-2 py-2 text-sm bg-background"
              >
                {COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(formatPhoneNumber(e.target.value, countryCode))}
                placeholder={countryCode === "+1" ? "(510) 555-0123" : "Phone number"}
                className="border rounded-md px-3 py-2 text-sm w-full"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">LinkedIn</label>
            <input
              type="text"
              value={linkedin}
              onChange={(e) => setLinkedin(e.target.value)}
              placeholder="linkedin.com/in/your-name"
              className="border rounded-md px-3 py-2 text-sm w-full"
            />
            <p className="text-xs text-muted-foreground">Don&apos;t have one? Make one — it takes two minutes.</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">GitHub</label>
            <input
              type="text"
              value={github}
              onChange={(e) => setGithub(e.target.value)}
              placeholder="github.com/your-username"
              className="border rounded-md px-3 py-2 text-sm w-full"
            />
            <p className="text-xs text-muted-foreground">Don&apos;t have one? Make one — it takes two minutes.</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Interests</label>
            <textarea
              value={interests}
              onChange={(e) => setInterests(e.target.value)}
              placeholder="Interests"
              rows={2}
              className="border rounded-md px-3 py-2 text-sm w-full resize-none"
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading || !preferredFirstname.trim() || !lastname.trim()}
            className="bg-foreground text-background rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Saving..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
