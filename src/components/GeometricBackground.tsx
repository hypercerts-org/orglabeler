'use client'

export function GeometricBackground() {
  return (
    <div
      className='hidden lg:block pointer-events-none fixed inset-0 overflow-hidden'
      aria-hidden='true'
    >
      <style>{`
        @keyframes driftDown {
          0% { transform: translateY(0px) rotate(0deg); }
          100% { transform: translateY(60px) rotate(8deg); }
        }
        @keyframes driftAcross {
          0% { transform: translateX(0px) rotate(0deg); }
          100% { transform: translateX(40px) rotate(-6deg); }
        }
        @keyframes driftDiag {
          0% { transform: translate(0px, 0px) rotate(0deg); }
          100% { transform: translate(30px, 50px) rotate(12deg); }
        }
        @keyframes driftSlow {
          0% { transform: translateY(0px) rotate(0deg); }
          100% { transform: translateY(80px) rotate(-10deg); }
        }
        .geo-drift-1 {
          animation: driftDown 18s ease-in-out infinite alternate;
        }
        .geo-drift-2 {
          animation: driftAcross 22s ease-in-out infinite alternate;
        }
        .geo-drift-3 {
          animation: driftDiag 26s ease-in-out infinite alternate;
        }
        .geo-drift-4 {
          animation: driftSlow 30s ease-in-out infinite alternate;
        }
        .geo-drift-5 {
          animation: driftDown 20s ease-in-out infinite alternate-reverse;
        }
        .geo-drift-6 {
          animation: driftAcross 24s ease-in-out infinite alternate-reverse;
        }
        .geo-drift-7 {
          animation: driftDiag 28s ease-in-out infinite alternate;
        }
        .geo-drift-8 {
          animation: driftSlow 16s ease-in-out infinite alternate-reverse;
        }
        .geo-drift-9 {
          animation: driftDown 32s ease-in-out infinite alternate;
        }
        .geo-drift-10 {
          animation: driftAcross 19s ease-in-out infinite alternate-reverse;
        }
      `}</style>

      {/* Large square — top left */}
      <svg
        className='geo-drift-1 absolute'
        style={{ top: '8%', left: '5%', opacity: 0.04 }}
        width='120'
        height='120'
        viewBox='0 0 120 120'
      >
        <rect x='2' y='2' width='116' height='116' fill='none' stroke='currentColor' strokeWidth='1' />
      </svg>

      {/* Triangle — top right */}
      <svg
        className='geo-drift-2 absolute'
        style={{ top: '12%', right: '8%', opacity: 0.035 }}
        width='100'
        height='87'
        viewBox='0 0 100 87'
      >
        <polygon points='50,2 98,85 2,85' fill='none' stroke='currentColor' strokeWidth='1' />
      </svg>

      {/* Horizontal line — upper middle */}
      <svg
        className='geo-drift-3 absolute'
        style={{ top: '20%', left: '30%', opacity: 0.05 }}
        width='200'
        height='2'
        viewBox='0 0 200 2'
      >
        <line x1='0' y1='1' x2='200' y2='1' stroke='currentColor' strokeWidth='1' />
      </svg>

      {/* Small circle — left middle */}
      <svg
        className='geo-drift-4 absolute'
        style={{ top: '40%', left: '3%', opacity: 0.04 }}
        width='60'
        height='60'
        viewBox='0 0 60 60'
      >
        <circle cx='30' cy='30' r='28' fill='none' stroke='currentColor' strokeWidth='1' />
      </svg>

      {/* Small square — right middle */}
      <svg
        className='geo-drift-5 absolute'
        style={{ top: '45%', right: '5%', opacity: 0.05 }}
        width='70'
        height='70'
        viewBox='0 0 70 70'
      >
        <rect x='2' y='2' width='66' height='66' fill='none' stroke='currentColor' strokeWidth='1' />
      </svg>

      {/* Diagonal line — bottom left */}
      <svg
        className='geo-drift-6 absolute'
        style={{ bottom: '25%', left: '10%', opacity: 0.04 }}
        width='150'
        height='150'
        viewBox='0 0 150 150'
      >
        <line x1='0' y1='0' x2='150' y2='150' stroke='currentColor' strokeWidth='1' />
      </svg>

      {/* Large triangle — bottom right */}
      <svg
        className='geo-drift-7 absolute'
        style={{ bottom: '10%', right: '12%', opacity: 0.03 }}
        width='140'
        height='122'
        viewBox='0 0 140 122'
      >
        <polygon points='70,2 138,120 2,120' fill='none' stroke='currentColor' strokeWidth='1' />
      </svg>

      {/* Tiny circle — top center */}
      <svg
        className='geo-drift-8 absolute'
        style={{ top: '5%', left: '50%', opacity: 0.06 }}
        width='30'
        height='30'
        viewBox='0 0 30 30'
      >
        <circle cx='15' cy='15' r='13' fill='none' stroke='currentColor' strokeWidth='1' />
      </svg>

      {/* Vertical line — right side */}
      <svg
        className='geo-drift-9 absolute'
        style={{ top: '30%', right: '20%', opacity: 0.04 }}
        width='2'
        height='180'
        viewBox='0 0 2 180'
      >
        <line x1='1' y1='0' x2='1' y2='180' stroke='currentColor' strokeWidth='1' />
      </svg>

      {/* Medium square — bottom center */}
      <svg
        className='geo-drift-10 absolute'
        style={{ bottom: '15%', left: '40%', opacity: 0.035 }}
        width='90'
        height='90'
        viewBox='0 0 90 90'
      >
        <rect x='2' y='2' width='86' height='86' fill='none' stroke='currentColor' strokeWidth='1' />
      </svg>
    </div>
  )
}
