import { ImageResponse } from 'next/og'

// OG image dimensions
export const OG_WIDTH = 1200
export const OG_HEIGHT = 630

interface GenerateOGImageOptions {
  title: string
  subtitle?: string
}

export async function generateOGImage({ title, subtitle }: GenerateOGImageOptions) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          position: 'relative',
          background: 'linear-gradient(135deg, #fefdf8 0%, #f8faf6 50%, #f0f5f0 100%)',
        }}
      >
        {/* Subtle geometric accent - top right */}
        <div
          style={{
            position: 'absolute',
            top: -100,
            right: -100,
            width: 400,
            height: 400,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%)',
          }}
        />

        {/* Subtle geometric accent - bottom left */}
        <div
          style={{
            position: 'absolute',
            bottom: -150,
            left: -150,
            width: 500,
            height: 500,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.05) 0%, rgba(16, 185, 129, 0.01) 100%)',
          }}
        />

        {/* Content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '60px 80px',
            zIndex: 1,
          }}
        >
          {/* Branding */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: '40px',
            }}
          >
            <span
              style={{
                fontSize: '20px',
                fontWeight: 400,
                color: '#a1a1aa',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              OrgLabeler
            </span>
            <span
              style={{
                fontSize: '20px',
                fontWeight: 400,
                color: '#d4d4d8',
                margin: '0 16px',
              }}
            >
              by
            </span>
            <span
              style={{
                fontSize: '20px',
                fontWeight: 500,
                color: '#10b981',
                letterSpacing: '0.02em',
              }}
            >
              GainForest
            </span>
          </div>

          {/* Main title - using Georgia as elegant serif fallback */}
          <div
            style={{
              display: 'flex',
              fontFamily: 'Georgia, Times New Roman, serif',
              fontSize: '96px',
              fontWeight: 400,
              color: '#18181b',
              lineHeight: 1.1,
              maxWidth: '1000px',
              letterSpacing: '-0.02em',
            }}
          >
            {title}
          </div>

          {/* Subtitle */}
          {subtitle && (
            <div
              style={{
                display: 'flex',
                fontSize: '26px',
                fontWeight: 400,
                color: '#71717a',
                marginTop: '28px',
                maxWidth: '800px',
                letterSpacing: '0.01em',
              }}
            >
              {subtitle}
            </div>
          )}
        </div>

        {/* Bottom accent line */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '5px',
            background: 'linear-gradient(90deg, #10b981 0%, #059669 50%, #047857 100%)',
          }}
        />

        {/* Subtle top border */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '1px',
            background: 'rgba(16, 185, 129, 0.15)',
          }}
        />
      </div>
    ),
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
    }
  )
}

export const size = {
  width: OG_WIDTH,
  height: OG_HEIGHT,
}

export const contentType = 'image/png'
