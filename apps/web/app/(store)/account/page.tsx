// Customer account page — HONEST NOT-WIRED state.
// There is no customer login/session and no /api/v1/public/account API
// yet, so this page must not present anyone's sample data as "your
// account" (it previously rendered a mock customer + mock orders as if
// they were the visitor's). Until customer auth lands, customers can
// track a real order with its order number + phone at /track.
export default function AccountPage() {
  return (
    <main style={{ padding: 24, maxWidth: 720, fontFamily: "system-ui" }}>
      <h1>আমার অ্যাকাউন্ট</h1>
      <p>
        কাস্টমার লগইন এখনো চালু হয়নি — তাই এই পেজে এখন আপনার অর্ডার বা প্রোফাইল দেখা যাচ্ছে না।
        এখানে কোনো নমুনা বা ডেমো তথ্য দেখানো হয় না।
      </p>
      <section>
        <h2>অর্ডার ট্র্যাক করুন</h2>
        <p>
          অর্ডার নম্বর ও ফোন নম্বর দিয়ে আপনার আসল অর্ডারের অবস্থা দেখতে{" "}
          <a href="/track">অর্ডার ট্র্যাক</a> পেজে যান।
        </p>
      </section>
    </main>
  );
}
