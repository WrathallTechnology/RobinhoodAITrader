/** Append Z if the ISO string has no timezone designator so JS parses it as UTC. */
function toUTC(iso: string): Date {
  if (!iso.endsWith("Z") && !/[+\-]\d{2}:\d{2}$/.test(iso)) {
    return new Date(iso + "Z");
  }
  return new Date(iso);
}

export function formatET(iso: string | null | undefined): string {
  if (!iso) return "—";
  return toUTC(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "numeric", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }) + " ET";
}

export function formatETDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return toUTC(iso).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "numeric", day: "numeric", year: "numeric",
  });
}

export function formatETTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return toUTC(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }) + " ET";
}
