const FLOWERS = Array.from({ length: 34 }, (_, i) => ({
  x: (i * 211 + 30) % 1440,
  y: 118 + ((i * 37) % 60),
  r: 2 + (i % 3) * 0.7,
  hot: i % 3 === 0,
}));

/** Quiet rolling hills and meadow flowers along the foot of the page; purely decorative. */
export function FooterHills() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 1440 200"
      preserveAspectRatio="xMidYMax slice"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-40 w-full sm:h-52"
    >
      <path
        d="M0 120 C220 70 420 118 660 92 S1100 60 1440 108 V200 H0Z"
        fill="#0a3454"
        opacity="0.55"
      />
      <path
        d="M0 150 C260 110 480 160 740 132 S1160 112 1440 146 V200 H0Z"
        fill="#07263f"
        opacity="0.8"
      />
      <path d="M0 178 C320 156 640 186 960 168 S1280 160 1440 172 V200 H0Z" fill="#051b2e" />
      {FLOWERS.map((flower, i) => (
        <circle
          key={i}
          cx={flower.x}
          cy={flower.y}
          r={flower.r}
          fill={flower.hot ? '#f7b955' : '#e8803a'}
          opacity="0.5"
        />
      ))}
    </svg>
  );
}
