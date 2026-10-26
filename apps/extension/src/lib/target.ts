// What a YouTube URL points at, normalized for the app.

export interface Target {
  kind: "video" | "playlist";
  url: string;
}

export function targetFromUrl(raw: string | undefined | null): Target | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.slice(1);
    return id ? { kind: "video", url: `https://www.youtube.com/watch?v=${id}` } : null;
  }
  if (host !== "youtube.com") return null;
  const v = u.searchParams.get("v");
  const list = u.searchParams.get("list");
  if (u.pathname === "/watch" && v) return { kind: "video", url: `https://www.youtube.com/watch?v=${v}` };
  const shorts = u.pathname.match(/^\/shorts\/([\w-]{6,})/);
  if (shorts) return { kind: "video", url: `https://www.youtube.com/shorts/${shorts[1]}` };
  if (u.pathname === "/playlist" && list) return { kind: "playlist", url: `https://www.youtube.com/playlist?list=${list}` };
  return null;
}

export function playlistOf(raw: string): Target | null {
  try {
    const list = new URL(raw).searchParams.get("list");
    // Mixes ("RD…") are endless radio playlists, not something to download whole.
    return list && !list.startsWith("RD") ? { kind: "playlist", url: `https://www.youtube.com/playlist?list=${list}` } : null;
  } catch {
    return null;
  }
}
