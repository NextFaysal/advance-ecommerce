"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="bn">
      <body style={{ fontFamily: "system-ui, -apple-system, sans-serif", textAlign: "center", padding: "100px 20px" }}>
        <h1 style={{ fontSize: "48px", fontWeight: "bold", margin: 0 }}>একটি ত্রুটি ঘটেছে</h1>
        <p style={{ color: "#666", marginTop: "12px" }}>সার্ভারে অপ্রত্যাশিত সমস্যা দেখা দিয়েছে।</p>
        <button
          onClick={() => reset()}
          style={{
            marginTop: "20px",
            padding: "10px 20px",
            backgroundColor: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: "500",
          }}
        >
          আবার চেষ্টা করুন
        </button>
      </body>
    </html>
  );
}
