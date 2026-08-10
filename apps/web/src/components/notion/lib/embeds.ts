/**
 * Turning a pasted link into something an `<iframe>` will actually render.
 *
 * Most providers serve their page at one URL and their player at another; the
 * embed block would show a "refused to connect" frame if we used the link as
 * typed. Anything unrecognised is returned untouched so a self-hosted or
 * intranet embed still works.
 */

export type EmbedProvider =
    | "youtube"
    | "vimeo"
    | "loom"
    | "figma"
    | "maps"
    | "gist"
    | "tweet"
    | "codepen"
    | "spotify"
    | "soundcloud"
    | "drive"
    | "miro"
    | "pdf"
    | "embed";

const LABELS: Record<string, string> = {
    youtube: "YouTube",
    vimeo: "Vimeo",
    loom: "Loom",
    figma: "Figma",
    maps: "Google Maps",
    gist: "GitHub Gist",
    tweet: "Tweet",
    codepen: "CodePen",
    spotify: "Spotify",
    soundcloud: "SoundCloud",
    drive: "Google Drive",
    miro: "Miro",
    pdf: "PDF",
    embed: "Embed",
};

export function providerLabel(provider: string): string {
    return LABELS[provider] ?? "Embed";
}

/** Best-guess provider for a URL, used to label the empty state. */
export function detectProvider(url: string): EmbedProvider {
    let host: string;
    try {
        host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return "embed";
    }

    if (host.endsWith("youtube.com") || host === "youtu.be") return "youtube";
    if (host.endsWith("vimeo.com")) return "vimeo";
    if (host.endsWith("loom.com")) return "loom";
    if (host.endsWith("figma.com")) return "figma";
    if (host.endsWith("google.com") && url.includes("/maps")) return "maps";
    if (host === "gist.github.com") return "gist";
    if (host === "twitter.com" || host === "x.com") return "tweet";
    if (host.endsWith("codepen.io")) return "codepen";
    if (host.endsWith("spotify.com")) return "spotify";
    if (host.endsWith("soundcloud.com")) return "soundcloud";
    if (host.endsWith("drive.google.com")) return "drive";
    if (host.endsWith("miro.com")) return "miro";
    if (url.toLowerCase().endsWith(".pdf")) return "pdf";
    return "embed";
}

/**
 * The URL to put in the iframe, or null when the link is a plain file that
 * should be played by a native element instead.
 */
export function embedUrlFor(raw: string): string | null {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
        const id = url.pathname.slice(1);
        return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host.endsWith("youtube.com")) {
        if (url.pathname.startsWith("/embed/")) return url.toString();
        const id = url.searchParams.get("v");
        if (id) return `https://www.youtube.com/embed/${id}`;
        const shorts = /^\/shorts\/([\w-]+)/.exec(url.pathname);
        if (shorts) return `https://www.youtube.com/embed/${shorts[1]!}`;
        return null;
    }
    if (host.endsWith("vimeo.com")) {
        if (host.startsWith("player.")) return url.toString();
        const id = url.pathname.split("/").find(Boolean);
        return id ? `https://player.vimeo.com/video/${id}` : null;
    }
    if (host.endsWith("loom.com")) {
        return url.toString().replace("/share/", "/embed/");
    }
    if (host.endsWith("figma.com")) {
        return `https://www.figma.com/embed?embed_host=launchstack&url=${encodeURIComponent(
            url.toString()
        )}`;
    }
    if (host.endsWith("google.com") && url.pathname.startsWith("/maps")) {
        return `https://maps.google.com/maps?q=${encodeURIComponent(
            url.searchParams.get("q") ?? url.pathname
        )}&output=embed`;
    }
    if (host === "gist.github.com") {
        return url.toString();
    }
    if (host.endsWith("codepen.io")) {
        return url.toString().replace("/pen/", "/embed/");
    }
    if (host.endsWith("spotify.com")) {
        return url.toString().replace("/track/", "/embed/track/").replace("/album/", "/embed/album/");
    }
    if (host.endsWith("drive.google.com")) {
        return url.toString().replace(/\/view.*$/, "/preview");
    }
    if (host.endsWith("miro.com")) {
        return url.toString().replace("/app/board/", "/app/live-embed/");
    }
    if (host === "twitter.com" || host === "x.com") {
        // X blocks framing its own pages; the syndication widget is the only
        // embeddable surface.
        const id = /\/status\/(\d+)/.exec(url.pathname)?.[1];
        return id
            ? `https://platform.twitter.com/embed/Tweet.html?id=${id}`
            : null;
    }

    // A direct media or document URL plays better in its native element.
    if (/\.(mp4|webm|ogg|mp3|wav|m4a)$/i.test(url.pathname)) return null;
    return url.toString();
}

/** True when the URL points at a file a `<video>`/`<audio>` tag can play. */
export function isDirectMedia(raw: string): boolean {
    try {
        return /\.(mp4|webm|ogg|mov|mp3|wav|m4a|flac)$/i.test(new URL(raw).pathname);
    } catch {
        return false;
    }
}
