import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Launchstack — The Open-Source Launch Stack for Tech Founders';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OGImage() {
    return new ImageResponse(
        (
            <div
                style={{
                    height: '100%',
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(135deg, #080010 0%, #1a0533 40%, #2d1052 70%, #080010 100%)',
                    fontFamily: 'system-ui, sans-serif',
                }}
            >
                {/* Glow effect */}
                <div
                    style={{
                        position: 'absolute',
                        top: '-20%',
                        left: '30%',
                        width: '40%',
                        height: '60%',
                        background: 'radial-gradient(ellipse, rgba(147, 51, 234, 0.3), transparent)',
                        display: 'flex',
                    }}
                />

                {/* Logo */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '16px',
                        marginBottom: '24px',
                    }}
                >
                    <div
                        style={{
                            width: '64px',
                            height: '64px',
                            borderRadius: '16px',
                            background: 'linear-gradient(135deg, #9333ea, #7c3aed)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '32px',
                            color: 'white',
                            fontWeight: 700,
                        }}
                    >
                        L
                    </div>
                    <span
                        style={{
                            fontSize: '48px',
                            fontWeight: 700,
                            color: 'white',
                            letterSpacing: '-1px',
                        }}
                    >
                        Launchstack
                    </span>
                </div>

                {/* Title */}
                <div
                    style={{
                        fontSize: '52px',
                        fontWeight: 700,
                        color: 'white',
                        textAlign: 'center',
                        lineHeight: 1.2,
                        maxWidth: '900px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                    }}
                >
                    <span>The Open-Source Launch Stack</span>
                    <span style={{ color: '#a78bfa' }}>for Tech Founders</span>
                </div>

                {/* Description */}
                <p
                    style={{
                        fontSize: '22px',
                        color: '#a1a1aa',
                        textAlign: 'center',
                        maxWidth: '700px',
                        marginTop: '20px',
                        lineHeight: 1.5,
                    }}
                >
                    Document AI · Growth Tools · Team Management · 100% Free
                </p>

                {/* Feature pills */}
                <div
                    style={{
                        display: 'flex',
                        gap: '12px',
                        marginTop: '32px',
                    }}
                >
                    {['Open Source', 'Self-Hostable', 'Free Forever'].map(
                        (label) => (
                            <div
                                key={label}
                                style={{
                                    padding: '8px 20px',
                                    borderRadius: '999px',
                                    border: '1px solid rgba(147, 51, 234, 0.5)',
                                    color: '#c4b5fd',
                                    fontSize: '16px',
                                    fontWeight: 600,
                                    display: 'flex',
                                }}
                            >
                                {label}
                            </div>
                        ),
                    )}
                </div>
            </div>
        ),
        { ...size },
    );
}
