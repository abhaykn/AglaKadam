const STARS = Array.from({ length: 64 }, (_, i) => ({
  x: (i * 173 + 40) % 1200,
  y: (i * 89 + 12) % 215,
  r: 0.7 + (i % 3) * 0.45,
  delay: (i % 11) * 0.45,
}));

const FLOWERS = Array.from({ length: 46 }, (_, i) => ({
  x: (i * 131 + 17) % 1200,
  y: 322 + ((i * 29) % 50),
  r: 2.2 + (i % 4) * 0.8,
  hot: i % 3 === 0,
}));

const MOTES = Array.from({ length: 16 }, (_, i) => ({
  x: 520 + ((i * 53) % 170),
  delay: (i % 8) * 0.7,
  size: 2 + (i % 3),
}));

function Child({ x, shirt, hair }: { x: number; shirt: string; hair: string }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <ellipse cx="0" cy="346" rx="44" ry="9" fill="#031826" opacity="0.55" />
      <path d="M-30 344 C-30 306 30 306 30 344Z" fill={shirt} />
      <circle cx="0" cy="284" r="19" fill="#f0c7a2" />
      <path d="M-20 281 C-20 256 20 256 20 281 C12 270 -10 268 -20 281Z" fill={hair} />
      <rect x="-24" y="318" width="48" height="20" rx="4" fill="#ffe9a8" />
      <rect x="-24" y="318" width="48" height="20" rx="4" fill="url(#vg-glow)" opacity="0.7" />
    </g>
  );
}

function BookStack({ x, flip = false }: { x: number; flip?: boolean }) {
  const books = [
    { w: 92, h: 15, c: '#c9743a', o: 0 },
    { w: 78, h: 13, c: '#3f7fb0', o: 6 },
    { w: 86, h: 14, c: '#e8b24d', o: -4 },
    { w: 70, h: 12, c: '#7a4a8a', o: 5 },
    { w: 80, h: 13, c: '#4aa38a', o: -3 },
  ];
  let y = 346;
  return (
    <g transform={`translate(${x} 0) scale(${flip ? -1 : 1} 1)`}>
      {books.map((book) => {
        y -= book.h;
        return (
          <rect
            key={book.c}
            x={-book.w / 2 + book.o}
            y={y}
            width={book.w}
            height={book.h}
            rx="2"
            fill={book.c}
          />
        );
      })}
    </g>
  );
}

/** A night-time reading scene in the same palette as the hero footage. Decorative only. */
export function NightReadingScene({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1200 380"
      preserveAspectRatio="xMidYMax slice"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="vg-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#031a2b" />
          <stop offset="0.7" stopColor="#0a3d63" />
          <stop offset="1" stopColor="#0f5584" />
        </linearGradient>
        <radialGradient id="vg-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffe9a8" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="vg-ray" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ffe9a8" stopOpacity="0.4" />
          <stop offset="1" stopColor="#ffe9a8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="vg-page" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff6d6" />
          <stop offset="1" stopColor="#ffd98a" />
        </linearGradient>
        <mask id="vg-moon-mask">
          <rect width="1200" height="380" fill="#fff" />
          <circle cx="1052" cy="68" r="28" fill="#000" />
        </mask>
      </defs>

      <rect width="1200" height="380" fill="url(#vg-sky)" />

      {STARS.map((star, i) => (
        <circle
          key={i}
          cx={star.x}
          cy={star.y}
          r={star.r}
          fill="#fff"
          className="vg-twinkle"
          style={{ animationDelay: `${star.delay}s` }}
        />
      ))}

      <circle cx="1040" cy="76" r="60" fill="#f6f1d6" opacity="0.08" />
      <circle cx="1040" cy="76" r="32" fill="#f6f1d6" mask="url(#vg-moon-mask)" />

      <path d="M0 248 C200 198 400 238 600 214 S1000 198 1200 234 V380 H0Z" fill="#0b3b5e" />
      <path d="M0 292 C250 252 450 302 700 272 S1050 256 1200 286 V380 H0Z" fill="#072e49" />
      <path d="M0 332 C300 306 600 340 900 318 S1130 306 1200 322 V380 H0Z" fill="#05233a" />

      <ellipse cx="600" cy="300" rx="300" ry="120" fill="url(#vg-glow)" className="vg-pulse" />
      <path d="M552 296 L440 40 L760 40 L648 296Z" fill="url(#vg-ray)" className="vg-pulse" />

      {MOTES.map((mote, i) => (
        <circle
          key={i}
          cx={mote.x}
          cy="300"
          r={mote.size}
          fill="#ffe9a8"
          className="vg-rise"
          style={{ animationDelay: `${mote.delay}s` }}
        />
      ))}

      <BookStack x={92} />
      <BookStack x={1110} flip />
      <Child x={290} shirt="#6aa9d8" hair="#2a1d17" />
      <Child x={910} shirt="#e8a35a" hair="#3b2a22" />

      <g>
        <path
          d="M434 306 L434 350 C500 334 560 334 600 354 C640 334 700 334 766 350 L766 306Z"
          fill="#7a4a22"
        />
        <path
          d="M600 304 C560 286 498 286 440 304 L440 344 C500 328 560 328 600 348Z"
          fill="url(#vg-page)"
        />
        <path
          d="M600 304 C640 286 702 286 760 304 L760 344 C700 328 640 328 600 348Z"
          fill="url(#vg-page)"
        />
        <path d="M600 304 V348" stroke="#c9a15a" strokeWidth="1.5" />
        <g stroke="#c9a15a" strokeWidth="1" opacity="0.7" fill="none">
          <path d="M470 312 C510 304 560 306 590 314" />
          <path d="M470 322 C510 314 560 316 590 324" />
          <path d="M610 314 C640 306 690 304 730 312" />
          <path d="M610 324 C640 316 690 314 730 322" />
        </g>
      </g>

      {FLOWERS.map((flower, i) => (
        <circle
          key={i}
          cx={flower.x}
          cy={flower.y}
          r={flower.r}
          fill={flower.hot ? '#f7b955' : '#e8803a'}
          opacity="0.9"
        />
      ))}
    </svg>
  );
}

type RoleKind = 'crp' | 'teacher' | 'block' | 'family';

const ROLE_BACKGROUND: Record<RoleKind, [string, string]> = {
  crp: ['#0d4f7a', '#0a2f4d'],
  teacher: ['#0f5a6e', '#0a3142'],
  block: ['#16457a', '#0b2547'],
  family: ['#1a5a80', '#0c3150'],
};

/** A small illustrated scene for each audience, drawn in the page palette. Decorative only. */
export function RoleArt({ kind, className }: { kind: RoleKind; className?: string }) {
  const [from, to] = ROLE_BACKGROUND[kind];
  const id = `ra-${kind}`;
  return (
    <svg
      viewBox="0 0 320 150"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="320" height="150" fill={`url(#${id})`} />
      <circle cx="270" cy="34" r="16" fill="#f6f1d6" opacity="0.9" />
      <circle cx="50" cy="26" r="1.6" fill="#fff" />
      <circle cx="110" cy="44" r="1.2" fill="#fff" />
      <circle cx="200" cy="20" r="1.4" fill="#fff" />
      <path
        d="M0 122 C80 108 160 130 240 116 S300 112 320 118 V150 H0Z"
        fill="#05233a"
        opacity="0.85"
      />

      {kind === 'crp' ? (
        <g>
          <path d="M20 150 C70 118 120 116 170 120 S260 126 300 150Z" fill="#0b3a5c" />
          <path
            d="M150 150 C160 132 170 124 178 118"
            stroke="#7cc8f2"
            strokeWidth="3"
            strokeDasharray="5 6"
            fill="none"
          />
          <rect x="210" y="70" width="64" height="48" rx="3" fill="#e9eef3" />
          <path d="M204 72 L242 48 L280 72Z" fill="#e8803a" />
          <rect x="234" y="92" width="16" height="26" fill="#0b3a5c" />
          <rect x="218" y="82" width="10" height="10" fill="#7cc8f2" />
          <rect x="256" y="82" width="10" height="10" fill="#7cc8f2" />
          <path
            d="M118 56 C118 40 150 40 150 56 C150 70 134 84 134 84 C134 84 118 70 118 56Z"
            fill="#f7b955"
          />
          <circle cx="134" cy="56" r="6" fill="#0a2f4d" />
        </g>
      ) : null}

      {kind === 'teacher' ? (
        <g>
          <rect
            x="52"
            y="34"
            width="190"
            height="84"
            rx="6"
            fill="#0b4a45"
            stroke="#c9a15a"
            strokeWidth="5"
          />
          <g stroke="#e9f4ee" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.9">
            <path d="M72 58 C90 48 100 68 118 58 S146 50 160 58" />
            <path d="M72 80 H150" />
            <path d="M72 98 H120" />
          </g>
          <circle cx="204" cy="76" r="14" fill="none" stroke="#f7b955" strokeWidth="3" />
          <path
            d="M196 76 L202 82 L214 68"
            stroke="#f7b955"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
          <rect x="52" y="118" width="190" height="6" rx="3" fill="#c9a15a" />
          <circle cx="272" cy="92" r="14" fill="#f0c7a2" />
          <path d="M258 90 C258 72 286 72 286 90 C280 84 264 84 258 90Z" fill="#2a1d17" />
          <path d="M254 130 C254 108 290 108 290 130Z" fill="#7cc8f2" />
        </g>
      ) : null}

      {kind === 'block' ? (
        <g>
          <path d="M70 62 L160 30 L250 62Z" fill="#e9eef3" />
          <rect x="82" y="64" width="156" height="8" fill="#cfd8e0" />
          {[96, 128, 160, 192, 214].map((x) => (
            <rect key={x} x={x} y="74" width="12" height="42" fill="#e9eef3" />
          ))}
          <rect x="66" y="116" width="188" height="8" fill="#cfd8e0" />
          <rect x="56" y="124" width="208" height="8" fill="#b4c0cc" />
          <circle cx="160" cy="52" r="6" fill="#f7b955" />
          <path d="M160 30 V12" stroke="#e9eef3" strokeWidth="2" />
          <path d="M160 12 H182 L176 18 L182 24 H160Z" fill="#e8803a" />
        </g>
      ) : null}

      {kind === 'family' ? (
        <g>
          <path d="M76 82 L140 38 L204 82Z" fill="#e8803a" />
          <rect x="88" y="82" width="104" height="48" fill="#e9eef3" />
          <rect x="130" y="100" width="20" height="30" fill="#0b3a5c" />
          <rect x="98" y="92" width="22" height="20" fill="#ffe9a8" />
          <rect x="160" y="92" width="22" height="20" fill="#ffe9a8" />
          <circle cx="248" cy="90" r="13" fill="#f0c7a2" />
          <path d="M235 88 C235 72 261 72 261 88 C256 82 242 82 235 88Z" fill="#2a1d17" />
          <path d="M232 130 C232 106 264 106 264 130Z" fill="#f7b955" />
          <rect x="238" y="112" width="20" height="14" rx="2" fill="#7cc8f2" />
          <path
            d="M270 52 C270 44 282 44 282 52 C282 60 276 64 276 64 C276 64 270 60 270 52Z"
            fill="#e8803a"
          />
        </g>
      ) : null}
    </svg>
  );
}
