import { mediaEmbedFor, mediaPlatformLabel, parseStartTime } from "~/lib/media-embed";

const YT = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&enablejsapi=1";

describe("mediaEmbedFor — YouTube", () => {
    it.each([
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123",
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ",
        "https://www.youtube.com/live/dQw4w9WgXcQ",
        "https://www.youtube.com/embed/dQw4w9WgXcQ",
    ])("embeds %s through the privacy-enhanced player", url => {
        expect(mediaEmbedFor(url)).toEqual({
            provider: "youtube",
            label: "YouTube",
            kind: "video",
            embedUrl: YT,
            watchUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            startSeconds: 0,
        });
    });

    it("starts where the imported link did", () => {
        const embed = mediaEmbedFor("https://youtu.be/dQw4w9WgXcQ?t=1m30s");
        expect(embed?.startSeconds).toBe(90);
        expect(embed?.embedUrl).toBe(`${YT}&start=90`);
        expect(embed?.watchUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s");
    });

    it("rebuilds the URL from a validated id, never echoing the input", () => {
        expect(mediaEmbedFor("https://www.youtube.com/watch?v=short")).toBeNull();
        expect(mediaEmbedFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ"><script>')).toBeNull();
        expect(mediaEmbedFor("https://www.youtube.com/channel/UC123")).toBeNull();
    });
});

describe("mediaEmbedFor — other platforms", () => {
    it("embeds Vimeo, keeping an unlisted video's hash", () => {
        expect(mediaEmbedFor("https://vimeo.com/76979871")).toMatchObject({
            provider: "vimeo",
            embedUrl: "https://player.vimeo.com/video/76979871",
            watchUrl: "https://vimeo.com/76979871",
        });
        expect(mediaEmbedFor("https://vimeo.com/76979871/abc123ef")).toMatchObject({
            embedUrl: "https://player.vimeo.com/video/76979871?h=abc123ef",
            watchUrl: "https://vimeo.com/76979871/abc123ef",
        });
        expect(mediaEmbedFor("https://player.vimeo.com/video/76979871?h=ff00")).toMatchObject({
            embedUrl: "https://player.vimeo.com/video/76979871?h=ff00",
        });
        expect(mediaEmbedFor("https://vimeo.com/channels/staffpicks/76979871")?.embedUrl).toBe(
            "https://player.vimeo.com/video/76979871"
        );
    });

    it("embeds Dailymotion, dropping a title slug", () => {
        expect(mediaEmbedFor("https://www.dailymotion.com/video/x8abc12_launch-day")).toMatchObject(
            {
                provider: "dailymotion",
                embedUrl: "https://www.dailymotion.com/embed/video/x8abc12",
            }
        );
        expect(mediaEmbedFor("https://dai.ly/x8abc12")?.provider).toBe("dailymotion");
    });

    it("embeds a single SoundCloud track as audio", () => {
        const embed = mediaEmbedFor("https://soundcloud.com/artist/track-name");
        expect(embed).toMatchObject({ provider: "soundcloud", kind: "audio" });
        expect(embed?.embedUrl).toBe(
            "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Ftrack-name&visual=false"
        );
        expect(mediaEmbedFor("https://soundcloud.com/artist/sets/album")).toBeNull();
    });

    it("has no player for platforms that cannot be framed here", () => {
        expect(mediaEmbedFor("https://www.tiktok.com/@a/video/7300000000000000000")).toBeNull();
        expect(mediaEmbedFor("https://x.com/a/status/1")).toBeNull();
    });

    it("rejects what is not a web URL", () => {
        expect(mediaEmbedFor(null)).toBeNull();
        expect(mediaEmbedFor("not a url")).toBeNull();
        expect(mediaEmbedFor("javascript:alert(1)//youtu.be/dQw4w9WgXcQ")).toBeNull();
    });
});

describe("parseStartTime", () => {
    it.each([
        ["90", 90],
        ["90s", 90],
        ["1m30s", 90],
        ["1h2m3s", 3723],
        ["", 0],
        [null, 0],
        ["soon", 0],
    ])("%s → %d", (raw, seconds) => {
        expect(parseStartTime(raw)).toBe(seconds);
    });
});

describe("mediaPlatformLabel", () => {
    it("names known platforms and falls back to the host", () => {
        expect(mediaPlatformLabel("https://www.tiktok.com/@a/video/1")).toBe("TikTok");
        expect(mediaPlatformLabel("https://x.com/a/status/1")).toBe("X");
        expect(mediaPlatformLabel("https://clips.twitch.tv/abc")).toBe("Twitch");
        expect(mediaPlatformLabel("https://media.example.org/v/1")).toBe("media.example.org");
        expect(mediaPlatformLabel("nonsense")).toBe("the original site");
    });
});
