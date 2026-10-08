export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Cleave logo"
      className="logo"
    >
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="13"
        fill="var(--bg)"
        stroke="var(--border)"
        strokeWidth="2"
      />
      <path
        d="M 30.4 14.1 A 18 18 0 1 0 30.4 49.9"
        fill="none"
        stroke="var(--price)"
        strokeWidth="11"
        strokeLinecap="butt"
      />
      <path
        d="M 33.6 14.1 A 18 18 0 0 1 46.7 21.7"
        fill="none"
        stroke="var(--div)"
        strokeWidth="11"
        strokeLinecap="butt"
      />
      <path
        d="M 46.7 42.3 A 18 18 0 0 1 33.6 49.9"
        fill="none"
        stroke="var(--div)"
        strokeWidth="11"
        strokeLinecap="butt"
      />
    </svg>
  )
}