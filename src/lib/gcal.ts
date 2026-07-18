function toGcalDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function gcalUrl(opts: {
  start: Date;
  durationMs?: number;
  title: string;
  details?: string;
  location?: string;
}) {
  const durationMs = opts.durationMs ?? 60 * 60 * 1000; // default 1 hour
  const start = toGcalDate(opts.start);
  const end = toGcalDate(new Date(opts.start.getTime() + durationMs));
  return (
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(opts.title)}` +
    `&dates=${start}/${end}` +
    (opts.details ? `&details=${encodeURIComponent(opts.details)}` : "") +
    (opts.location ? `&location=${encodeURIComponent(opts.location)}` : "")
  );
}
