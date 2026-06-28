import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export async function GET() {
  try {
    return new ImageResponse(
      (
        <div
          style={{
            background: 'linear-gradient(135deg, #0f0c29 0%, #1a0533 30%, #120136 60%, #0d0d1a 100%)',
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: '"Inter", sans-serif',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Accent glow */}
          <div
            style={{
              position: 'absolute',
              top: '-50%',
              right: '-20%',
              width: '600px',
              height: '600px',
              background: 'radial-gradient(circle, rgba(236,72,153,0.3) 0%, transparent 70%)',
              borderRadius: '50%',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '-30%',
              left: '-10%',
              width: '400px',
              height: '400px',
              background: 'radial-gradient(circle, rgba(167,139,250,0.2) 0%, transparent 70%)',
              borderRadius: '50%',
            }}
          />
          
          {/* Content */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                marginBottom: '20px',
              }}
            >
              <div
                style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '20px',
                  background: 'linear-gradient(135deg, #ec4899, #a855f7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '40px',
                  fontWeight: 'bold',
                  color: 'white',
                  boxShadow: '0 0 40px rgba(236,72,153,0.4)',
                }}
              >
                P
              </div>
              <h1
                style={{
                  fontSize: '72px',
                  fontWeight: 900,
                  color: 'white',
                  letterSpacing: '-2px',
                  margin: 0,
                  textShadow: '0 2px 20px rgba(0,0,0,0.5)',
                }}
              >
                PuruBoy
                <span style={{ color: '#ec4899', marginLeft: '8px' }}>API</span>
              </h1>
            </div>

            <p
              style={{
                fontSize: '28px',
                color: '#a1a1aa',
                fontWeight: 500,
                letterSpacing: '1px',
                textAlign: 'center',
                maxWidth: '600px',
                margin: 0,
              }}
            >
              REST API Gratis untuk Developer Indonesia
            </p>

            <div
              style={{
                display: 'flex',
                gap: '12px',
                marginTop: '32px',
                flexWrap: 'wrap',
                justifyContent: 'center',
              }}
            >
              {['AI Chat', 'Downloader', 'Anime', 'Tools'].map((tag) => (
                <div
                  key={tag}
                  style={{
                    padding: '8px 20px',
                    borderRadius: '100px',
                    background: 'rgba(236,72,153,0.15)',
                    border: '1px solid rgba(236,72,153,0.3)',
                    fontSize: '18px',
                    color: '#f0abfc',
                    fontWeight: 600,
                  }}
                >
                  {tag}
                </div>
              ))}
            </div>
          </div>

          {/* Bottom text */}
          <div
            style={{
              position: 'absolute',
              bottom: '32px',
              fontSize: '16px',
              color: '#52525b',
              fontWeight: 500,
              letterSpacing: '2px',
            }}
          >
            puruboy-api.vercel.app
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
  } catch (e) {
    // Fallback: redirect to favicon if ImageResponse fails
    return new Response('OG Image Unavailable', { status: 200 });
  }
}
