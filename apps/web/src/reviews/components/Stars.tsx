/**
 * Star row for a rating value — pure presentation, server-safe.
 * Filled count = round(rating), matching ProductCard / PDP StarRow.
 */
export function Stars({ rating, size = 15 }: { rating: number; size?: number }) {
  const full = Math.round(rating);
  return (
    <span className="flex items-center gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill={i <= full ? "#F59E0B" : "none"}
          stroke="#F59E0B"
          strokeWidth="1.8"
          strokeLinejoin="round"
        >
          <path d="M12 3.6l2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.3l-5.1 2.7 1.1-5.6-4.2-3.9 5.7-.7L12 3.6z" />
        </svg>
      ))}
    </span>
  );
}
