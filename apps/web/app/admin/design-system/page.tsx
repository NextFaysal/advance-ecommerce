"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AreaChart, BarChart, DonutChart, Sparkline } from "@/components/ui/chart-kit";
import { Combobox } from "@/components/ui/select";
import { DataTable, DataTableSkeleton } from "@/components/ui/table";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { PaymentBadge, RiskBadge, StatusBadge } from "@/components/ui/status-badge";
import { Phone } from "@/components/ui/phone";
import { SkeletonCard, SkeletonPage, SkeletonTable } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toast } from "@/components/ui/toast";

const WEEK_LABELS = ["শনি", "রবি", "সোম", "মঙ্গল", "বুধ", "বৃহস্পতি", "শুক্র"];
const REVENUE = [42, 55, 48, 66, 59, 74, 88];
const ORDERS_BY_DAY = [18, 26, 22, 31, 27, 34, 29];

function Swatch({ className, label, ring = false }: { className: string; label: string; ring?: boolean }) {
  return (
    <div className="w-[104px]">
      <div className={`h-11 w-full rounded-xl ${ring ? "ring-1 ring-inset ring-border" : ""} ${className}`} />
      <p className="mt-1.5 truncate text-caption text-text-muted">{label}</p>
    </div>
  );
}

export default function DesignSystemPage() {
  const [dark, setDark] = useState(false);
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [courier, setCourier] = useState("steadfast");
  const [search, setSearch] = useState("");

  return (
    <div className={dark ? "dark" : ""}>
      <div className="rounded-2xl bg-bg-app p-4 text-text-main sm:p-6">
        <PageHeader
          title="Design System v4 — Aurora Pro"
          description="Doc 31 D3: tokens v4 and the refreshed component kit, light/dark. Visual-only wave — every component keeps its props; new pieces are ChartKit, Breadcrumbs, DataTableSkeleton, SkeletonPage."
          breadcrumb="Admin / Design System"
          actions={
            <>
              <Button variant="outline" onClick={() => setDark(!dark)}>Theme: {dark ? "Dark" : "Light"}</Button>
              <Button variant="outline" onClick={() => setDensity(density === "comfortable" ? "compact" : "comfortable")}>Density: {density}</Button>
            </>
          }
        />

        <Breadcrumbs
          items={[
            { label: "Admin", href: "/admin" },
            { label: "Design System", href: "/admin/design-system" },
            { label: "Components v4" },
          ]}
        />

        {/* Hero / gradient — gradient is hero/CTA only, never a full screen. */}
        <section className="brand-gradient mt-5 rounded-2xl p-6 text-white shadow-glow">
          <h2 className="text-2xl font-bold">শুভ সকাল, Nazmul 👋</h2>
          <p className="bangla mt-1">আজকের বিক্রি <Money poisha={4520000} className="text-white" /> (+18%) — এই কার্ড ছাড়া গ্রেডিয়েন্ট ব্যবহার করা যাবে না।</p>
          <div className="mt-4 flex gap-2"><Button variant="secondary">+ New Order</Button><Button variant="ghost" className="text-white hover:bg-white/20">View orders</Button></div>
        </section>

        {/* ---------------- Tokens v4 ---------------- */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Tokens v4 — surfaces</h2>
          <Card className="mt-3">
            <div className="flex flex-wrap gap-3">
              <Swatch className="bg-bg-app" label="bg-app" ring />
              <Swatch className="bg-surface" label="surface" ring />
              <Swatch className="bg-surface-2" label="surface-2" ring />
              <Swatch className="bg-surface-raised" label="surface-raised" ring />
              <Swatch className="bg-overlay" label="overlay" />
              <Swatch className="bg-border" label="border" />
              <Swatch className="bg-border-strong" label="border-strong" />
            </div>
            <h3 className="mt-5 text-sm font-semibold">Brand + semantic solid / soft pairs</h3>
            <div className="mt-2 flex flex-wrap gap-3">
              <Swatch className="bg-brand-ink" label="brand-ink" />
              <Swatch className="bg-brand-soft" label="brand-soft" ring />
              <Swatch className="bg-success-solid" label="success-solid" />
              <Swatch className="bg-success-soft" label="success-soft" ring />
              <Swatch className="bg-warning-solid" label="warning-solid" />
              <Swatch className="bg-warning-soft" label="warning-soft" ring />
              <Swatch className="bg-danger" label="danger" />
              <Swatch className="bg-danger-soft" label="danger-soft" ring />
              <Swatch className="bg-info-solid" label="info-solid" />
              <Swatch className="bg-info-soft" label="info-soft" ring />
            </div>
            <h3 className="mt-5 text-sm font-semibold">Data-viz palette (chart-1…5)</h3>
            <div className="mt-2 flex flex-wrap gap-3">
              <Swatch className="bg-chart-1" label="chart-1" />
              <Swatch className="bg-chart-2" label="chart-2" />
              <Swatch className="bg-chart-3" label="chart-3" />
              <Swatch className="bg-chart-4" label="chart-4" />
              <Swatch className="bg-chart-5" label="chart-5" />
            </div>
          </Card>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="text-base font-semibold">Elevation — shadow scale</h2>
            <div className="mt-4 grid grid-cols-3 gap-4">
              {[
                { cls: "shadow-xs", label: "xs" },
                { cls: "shadow-card", label: "card" },
                { cls: "shadow-lift", label: "lift" },
                { cls: "shadow-pop", label: "pop" },
                { cls: "shadow-xl", label: "xl" },
                { cls: "shadow-glow", label: "glow" },
              ].map((s) => (
                <div key={s.label} className={`flex h-16 items-center justify-center rounded-2xl bg-surface-raised text-sm font-medium ${s.cls}`}>{s.label}</div>
              ))}
            </div>
            <h2 className="mt-6 text-base font-semibold">Radius scale</h2>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              {["rounded-sm", "rounded-md", "rounded-lg", "rounded-xl", "rounded-2xl", "rounded-3xl"].map((r) => (
                <div key={r} className="text-center">
                  <div className={`h-12 w-12 bg-brand-soft ring-1 ring-inset ring-brand-ink/20 ${r}`} />
                  <p className="mt-1 text-caption text-text-muted">{r.replace("rounded-", "")}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="text-base font-semibold">Type scale</h2>
            <div className="mt-3 space-y-2">
              <p className="text-display">Display — আজকের ড্যাশবোর্ড</p>
              <p className="text-h1">H1 — Order workspace</p>
              <p className="text-page-title">Page title — পণ্যের তালিকা</p>
              <p className="text-h3">H3 — Section heading</p>
              <p className="text-body">Body — the quick brown fox, ঢাকার বাইরে ডেলিভারি ২–৩ দিন।</p>
              <p className="text-caption text-text-muted">Caption — muted helper text, AA contrast in both modes.</p>
              <p className="tnum text-kpi">৳1,25,400 <span className="text-base font-medium text-text-muted">KPI + .tnum</span></p>
              <p className="tnum text-kpi-lg">3,412 <span className="text-base font-medium text-text-muted">KPI-lg</span></p>
            </div>
            <p className="bangla mt-4 text-sm text-text-muted">বাংলা টেক্সট: লাইন-হাইট ১.৬-এর কম নয়, letter-spacing ০, uppercase কখনো নয়। টাকা সবসময় integer poisha-তে: <Money poisha={125000} /> = ৳1,250.00।</p>
          </Card>
        </section>

        {/* ---------------- Stat cards + sparklines ---------------- */}
        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Sales" value="৳45,200" delta="18%" icon={<Icon name="banknote" size={22} />} accent="bg-brand-soft text-brand-ink" sparkline={<Sparkline data={REVENUE} color={1} ariaLabel="Sales trend" />} />
          <StatCard label="Orders" value="128" delta="12%" icon={<Icon name="package" size={22} />} accent="bg-info-soft text-info-solid" sparkline={<Sparkline data={ORDERS_BY_DAY} color={4} ariaLabel="Orders trend" />} />
          <StatCard label="Customers" value="3,412" delta="6%" icon={<Icon name="users" size={22} />} accent="bg-warning-soft text-warning-solid" />
          <StatCard label="Profit" value="৳12,400" delta="3%" deltaTone="down" icon={<Icon name="chart" size={22} />} accent="bg-success-soft text-success-solid" sparkline={<Sparkline data={[10, 14, 12, 16, 13, 15, 12]} color={3} filled={false} ariaLabel="Profit trend" />} />
        </section>

        {/* ---------------- Charts ---------------- */}
        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="text-base font-semibold">AreaChart — revenue (thousand ৳)</h2>
            <div className="mt-3">
              <AreaChart data={REVENUE} labels={WEEK_LABELS} color={1} ariaLabel="Revenue by day" />
            </div>
            <h2 className="mt-6 text-base font-semibold">BarChart — orders by day</h2>
            <div className="mt-3">
              <BarChart data={ORDERS_BY_DAY} labels={WEEK_LABELS} color={2} ariaLabel="Orders by day" />
            </div>
          </Card>
          <Card>
            <h2 className="text-base font-semibold">DonutChart — order status share</h2>
            <div className="mt-4">
              <DonutChart
                centerLabel="640"
                centerSubLabel="Orders"
                ariaLabel="Order status share"
                data={[
                  { label: "Delivered", value: 412, displayValue: "412" },
                  { label: "Shipped", value: 96, displayValue: "96" },
                  { label: "Processing", value: 74, displayValue: "74" },
                  { label: "Pending", value: 41, displayValue: "41" },
                  { label: "Cancelled", value: 17, displayValue: "17" },
                ]}
              />
            </div>
            <h2 className="mt-6 text-base font-semibold">Sparklines — every chart colour</h2>
            <div className="mt-3 space-y-2">
              {([1, 2, 3, 4, 5] as const).map((c) => (
                <Sparkline key={c} data={[8, 12, 9, 15, 13, 18, 16]} color={c} height={26} ariaLabel={`Sparkline colour ${c}`} />
              ))}
            </div>
          </Card>
        </section>

        {/* ---------------- Forms ---------------- */}
        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="text-base font-semibold">Buttons</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button>Primary</Button>
              <Button variant="gradient">Gradient CTA</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Delete</Button>
              <Button loading>Loading</Button>
              <Button size="sm">Small</Button>
              <Button size="lg">Large</Button>
            </div>
            <h2 className="mt-6 text-base font-semibold">Inputs</h2>
            <div className="mt-3 space-y-3">
              <Input label="Customer name" placeholder="Rahim Uddin" helper="Full name as on the order." />
              <Input label="Phone" prefix="+880" placeholder="01XXXXXXXXX" required />
              <Input label="Price" prefix="৳" placeholder="1250" error="Price must be above cost price." />
              <Textarea label="Delivery note" placeholder="যত্নে প্যাক করবেন…" helper="Optional — printed on the packing slip." />
              <Combobox label="Courier" value={courier} onChange={setCourier} options={[
                { value: "steadfast", label: "Steadfast" },
                { value: "pathao", label: "Pathao" },
                { value: "redx", label: "RedX" },
              ]} />
              <p className="text-sm text-text-muted">Selected courier: {courier}</p>
            </div>
          </Card>

          <Card>
            <h2 className="text-base font-semibold">Status — always color + icon + text</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusBadge status="PENDING" /><StatusBadge status="CONFIRMED" /><StatusBadge status="PROCESSING" />
              <StatusBadge status="PACKED" /><StatusBadge status="SHIPPED" /><StatusBadge status="DELIVERED" />
              <StatusBadge status="CANCELLED" /><StatusBadge status="FAILED" /><StatusBadge status="RETURNED" /><StatusBadge status="REFUNDED" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <PaymentBadge status="UNPAID" /><PaymentBadge status="PARTIAL" /><PaymentBadge status="PAID" /><PaymentBadge status="FAILED" />
              <RiskBadge level="LOW" /><RiskBadge level="MEDIUM" /><RiskBadge level="HIGH" />
            </div>
            <h2 className="mt-6 text-base font-semibold">Badge tones (v4 soft pairs)</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone="brand">Brand</Badge>
              <Badge tone="gradient">Gradient</Badge>
              <Badge tone="success" dot>Success</Badge>
              <Badge tone="warning" dot>Warning</Badge>
              <Badge tone="danger" dot>Danger</Badge>
              <Badge tone="info" dot>Info</Badge>
              <Badge tone="neutral">Neutral</Badge>
              <Badge tone="brand">Tag: Eid</Badge>
            </div>
            <h2 className="mt-6 text-base font-semibold">Phone masking</h2>
            <p className="mt-2 text-sm">Masked (default): <Phone phone="+8801712345678" /> — Full number needs customers.view_full_phone + audit (Step 4).</p>
            <p className="mt-1 font-mono text-sm">Order: ORD-100245 • SKU: JAM-BLK-M</p>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" onClick={() => setModalOpen(true)}>Open modal</Button>
              <Button variant="outline" onClick={() => setDrawerOpen(true)}>Open drawer</Button>
              <Button variant="outline" onClick={() => setShowToast(!showToast)}>Toggle toast</Button>
            </div>
            {showToast ? <div className="mt-3 space-y-2"><Toast>Save hoyeche ✓ — order updated.</Toast><Toast tone="error">Payment failed — try again.</Toast><Toast tone="info">New courier rates available.</Toast></div> : null}
          </Card>
        </section>

        {/* ---------------- Tabs ---------------- */}
        <section className="mt-6 space-y-8">
          <Tabs tabs={[
            { id: "orders", label: "Orders", count: 24, content: <p className="text-sm">Underline variant (default) — order list renders here. This tab proves the Tabs component works.</p> },
            { id: "customers", label: "Customers", count: 8, content: <p className="text-sm">Customer list renders here.</p> },
          ]} />
          <Tabs variant="pill" tabs={[
            { id: "all", label: "All", count: 32, content: <p className="text-sm">Pill variant (v4, additive) — segmented control on the surface-2 step.</p> },
            { id: "active", label: "Active", count: 21, content: <p className="text-sm">Active items only.</p> },
            { id: "archived", label: "Archived", content: <p className="text-sm">Archived items.</p> },
          ]} />
        </section>

        {/* ---------------- Table + states ---------------- */}
        <section className="mt-6 space-y-4">
          <FilterBar chips={["Pending", "Dhaka"]} onSearch={setSearch} />
          <p className="text-sm text-text-muted">Filter search (live): {search || "—"} • Density: {density}</p>
          <DataTable
            caption="Sample orders — selected row demo (row 2)"
            density={density}
            selectedIndex={1}
            columns={[{ key: "order", header: "Order" }, { key: "customer", header: "Customer" }, { key: "total", header: "Total" }, { key: "status", header: "Status" }]}
            rows={[
              { order: <span className="font-mono">ORD-100245</span>, customer: <span>Rahim • <Phone phone="+8801712345678" /></span>, total: <Money poisha={125000} />, status: <StatusBadge status="PENDING" /> },
              { order: <span className="font-mono">ORD-100246</span>, customer: <span>Karim • <Phone phone="+8801812345678" /></span>, total: <Money poisha={249900} />, status: <StatusBadge status="DELIVERED" /> },
              { order: <span className="font-mono">ORD-100247</span>, customer: <span>Fatema • <Phone phone="+8801912345678" /></span>, total: <Money poisha={76000} />, status: <StatusBadge status="SHIPPED" /> },
            ]}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <DataTableSkeleton columns={4} rows={4} />
            <SkeletonTable rows={4} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <SkeletonCard />
            <EmptyState title="Ekhono kono order nei" description="Prothom order ashle ekhane dekhaben." actionLabel="Create test order" onAction={() => setShowToast(true)} />
          </div>
          <Card elevation="raised">
            <h2 className="text-base font-semibold">Card elevations</h2>
            <p className="mt-1 text-sm text-text-muted">This panel uses elevation=&quot;raised&quot; (surface-raised step). Default cards sit at shadow-xs and deepen on hover; &quot;lift&quot; raises on hover; &quot;flat&quot; is border-only.</p>
          </Card>
          <details className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
            <summary className="cursor-pointer text-sm font-semibold">SkeletonPage preview (route-level loading)</summary>
            <div className="mt-4">
              <SkeletonPage />
            </div>
          </details>
        </section>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Confirm order?" onConfirm={() => setModalOpen(false)}>
        <p className="text-sm">Ei order confirm korle stock commit hobe. Continue korben?</p>
      </Modal>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Order ORD-100245 — quick view" footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDrawerOpen(false)}>Close</Button><Button onClick={() => setDrawerOpen(false)}>Confirm order</Button></div>}>
        <p className="text-sm">Customer: Rahim • <Phone phone="+8801712345678" /></p>
        <p className="mt-2 text-sm">Total: <Money poisha={125000} /></p>
        <div className="mt-3"><StatusBadge status="PENDING" /></div>
      </Drawer>
    </div>
  );
}
