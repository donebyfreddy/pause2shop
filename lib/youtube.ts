/**
 * Parse a YouTube URL (or a bare video id) and return the 11-char video id.
 * Supports watch?v=, youtu.be/, /shorts/, /embed/ and live/ URLs.
 */
export function parseYouTubeVideoId(input: string): string | null {
  if (!input) return null;
  const raw = input.trim();

  // Bare id
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

  // youtu.be/<id>
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return isValidId(id) ? id : null;
  }

  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtube-nocookie.com" ||
    host === "music.youtube.com"
  ) {
    // watch?v=<id>
    const v = url.searchParams.get("v");
    if (isValidId(v)) return v as string;

    // /shorts/<id>, /embed/<id>, /live/<id>, /v/<id>
    const parts = url.pathname.split("/").filter(Boolean);
    const known = ["shorts", "embed", "live", "v"];
    if (parts.length >= 2 && known.includes(parts[0])) {
      return isValidId(parts[1]) ? parts[1] : null;
    }
  }

  return null;
}

function isValidId(id: string | null | undefined): id is string {
  return !!id && /^[a-zA-Z0-9_-]{11}$/.test(id);
}

export function youtubeThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** YouTube IFrame Player API state codes. */
export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;
