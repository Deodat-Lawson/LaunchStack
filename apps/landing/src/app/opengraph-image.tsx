import { ImageResponse } from "next/og";
import { OgMark } from "./_components/og-mark";

export const runtime = "edge";
export const alt =
    "Launchstack — The open-source startup operating system. A place for your next big thing.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
    return new ImageResponse(
        (
            <div
                style={{
                    height: "100%",
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    padding: "65px 75px",
                    background: "#09070f",
                    color: "#f5f4f8",
                    fontFamily: "sans-serif",
                }}
            >
                <div style={{ display: "flex", gap: 13, alignItems: "center" }}>
                    <OgMark size={48} />
                    <span style={{ fontSize: 31, fontWeight: 700, letterSpacing: -1 }}>
                        Launchstack
                    </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 21, color: "#c8c4d0", marginBottom: 21 }}>
                        The open-source startup operating system
                    </span>
                    <span
                        style={{
                            fontSize: 84,
                            lineHeight: 1.08,
                            fontWeight: 600,
                            letterSpacing: -4,
                        }}
                    >
                        A place for your
                    </span>
                    <span
                        style={{
                            display: "flex",
                            fontSize: 84,
                            lineHeight: 1.08,
                            fontWeight: 600,
                            letterSpacing: -4,
                        }}
                    >
                        next big thing<span style={{ color: "#a78bfa" }}>.</span>
                    </span>
                </div>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        borderTop: "1px solid #393047",
                        paddingTop: 24,
                        color: "#aca6b9",
                        fontSize: 18,
                    }}
                >
                    <span>Your knowledge. Your next move. One workspace.</span>
                    <span>launchstack.app</span>
                </div>
            </div>
        ),
        size
    );
}
