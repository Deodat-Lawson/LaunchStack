import { ImageResponse } from "next/og";
import { OgMark } from "../_components/og-mark";

export const runtime = "edge";
export const alt = "Deploy your Launchstack workspace — app, worker, models, and connections";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
    return new ImageResponse(
        (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    padding: "72px 80px",
                    background: "#1b1825",
                    color: "#f5f4f8",
                    fontFamily: "sans-serif",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "14px",
                        fontSize: 30,
                        fontWeight: 600,
                    }}
                >
                    <OgMark size={42} />
                    Launchstack
                    <span style={{ color: "#b6a9d9", marginLeft: 16, fontSize: 20 }}>
                        Deployment guide
                    </span>
                </div>
                <div
                    style={{
                        display: "flex",
                        marginTop: 68,
                        fontSize: 64,
                        fontWeight: 600,
                        lineHeight: 1.12,
                        letterSpacing: "-2px",
                        maxWidth: 850,
                    }}
                >
                    Your workspace.
                    <br />
                    Your infrastructure.
                </div>
                <div style={{ display: "flex", marginTop: 26, color: "#c9c5d2", fontSize: 24 }}>
                    App + worker · Models · Storage · Connections
                </div>
                <div
                    style={{
                        display: "flex",
                        marginTop: "auto",
                        paddingTop: 28,
                        borderTop: "1px solid #42394f",
                        color: "#b6a9d9",
                        fontSize: 18,
                    }}
                >
                    The open-source startup operating system
                </div>
            </div>
        ),
        { ...size }
    );
}
