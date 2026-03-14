import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'About Launchstack — The Team Behind the Open-Source Launch Stack';
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                    <div
                        style={{
                            width: '56px',
                            height: '56px',
                            borderRadius: '14px',
                            background: 'linear-gradient(135deg, #9333ea, #7c3aed)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '28px',
                            color: 'white',
                            fontWeight: 700,
                        }}
                    >
                        L
                    </div>
                    <span style={{ fontSize: '40px', fontWeight: 700, color: 'white', letterSpacing: '-1px' }}>
                        Launchstack
                    </span>
                </div>
                <div
                    style={{
                        fontSize: '56px',
                        fontWeight: 700,
                        color: 'white',
                        textAlign: 'center',
                        lineHeight: 1.2,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                    }}
                >
                    <span>Meet the Team</span>
                    <span style={{ color: '#a78bfa' }}>Behind Launchstack</span>
                </div>
                <p style={{ fontSize: '22px', color: '#a1a1aa', textAlign: 'center', maxWidth: '600px', marginTop: '20px', lineHeight: 1.5 }}>
                    Built at Johns Hopkins University to help founders grow
                </p>
            </div>
        ),
        { ...size },
    );
}
