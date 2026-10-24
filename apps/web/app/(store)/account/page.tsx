// Customer account page — HONEST NOT-WIRED state.
// There is no customer login/session and no /api/v1/public/account API
// yet, so this page must not present anyone's sample data as "your
// account" (it previously rendered a mock customer + mock orders as if
// they were the visitor's). Until customer auth lands, customers can
// track a real order with its order number + phone at /track.
export default function AccountPage() {
  return (
    <main style={{ padding: 24, maxWidth: 720, fontFamily: "system-ui" }}>
      <h1>Amar Account</h1>
      <p>
        Customer login ekhono chalu hoy ni — tai account page e ekhono apnar order ba profile dekha jacche na.
        Kono sample/demo data ekhane dekhano hoy na.
      </p>
      <section>
        <h2>Order track korun</h2>
        <p>
          Order number ar phone diye apnar ashol order er obostha dekhte{" "}
          <a href="/track">Order Track</a> page e jan.
        </p>
      </section>
      <p>
        (Developer note: wire this page to the logged-in customer&apos;s real orders/addresses/wallet when
        customer auth and /api/v1/public/account exist.)
      </p>
    </main>
  );
}
