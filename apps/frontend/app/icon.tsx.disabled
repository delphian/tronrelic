import { ImageResponse } from 'next/og';

export const size = {
    width: 32,
    height: 32
};

export const contentType = 'image/png';

/**
 * Generates the primary site icon used for favicons and app shortcuts.
 * The image renders a bold TronRelic monogram so the tab and bookmarks remain recognizable.
 * Returning a generated image keeps the asset in sync with the design system without managing binary files in the repo.
 */
export default function Icon() {
    return new ImageResponse(
        (
            <div
                style={{
                    alignItems: 'center',
                    background: '#0F172A',
                    color: '#FACC15',
                    display: 'flex',
                    fontFamily: '"Inter", "Segoe UI", sans-serif',
                    fontSize: 20,
                    fontWeight: 700,
                    height: '100%',
                    justifyContent: 'center',
                    letterSpacing: '-0.02em',
                    width: '100%'
                }}
            >
                TR
            </div>
        ),
        {
            width: size.width,
            height: size.height
        }
    );
}
