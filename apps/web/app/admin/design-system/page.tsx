"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/select";
import { DataTable } from "@/components/ui/table";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { PaymentBadge, RiskBadge, StatusBadge } from "@/components/ui/status-badge";
import { Phone } from "@/components/ui/phone";
import { SkeletonCard } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs } from "@/components/ui/tabs";
import { Toast } from "@/components/ui/toast";

export default function DesignSystemPage() {
  const [dark, setDark] = useState(false);
  const [mode, setMode] = useState<"simple" | "pro">("simple");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [courier, setCourier] = useState("steadfast");
  const [search, setSearch] = useState("");

  return (
    <div className={dark ? "dark" : ""}>
      <div className="rounded-lg bg-bg-app p-4 text-text-main sm:p-6">
        <PageHeader
          title="Design System — Dev Only"
          description="D0 tokens and every core component, light/dark, Bangla-first. No feature screen should start before this page exists."
          breadcrumb="Admin / Design System"
          actions={
            <>
              <Button variant="outline" onClick={() => setDark(!dark)}>Theme: {dark ? "Dark" : "Light"}</Button>
              <Button variant="outline" onClick={() => setMode(mode === "simple" ? "pro" : "simple")}>Mode: {mode === "simple" ? "Simple" : "Pro"}</Button>
              <Button variant="outline" onClick={() => setDensity(density === "comfortable" ? "compact" : "comfortable")}>Density: {density}</Button>
            </>
          }
        />

        {/* Hero / gradient — gradient is hero/CTA only, never a full screen. */}
        <section className="brand-gradient rounded-xl p-6 text-white shadow-md">
          <h2 className="text-2xl font-bold">শুভ সকাল, Nazmul 👋</h2>
          <p className="bangla mt-1">আজকের বিক্রি <Money poisha={4520000} className="text-white" /> (+18%) — এই কার্ড ছাড়া গ্রেডিয়েন্ট ব্যবহার করা যাবে না।</p>
          <div className="mt-4 flex gap-2"><Button variant="secondary">+ New Order</Button><Button variant="ghost" className="text-white hover:bg-white/20">View orders</Button></div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Sales" value="৳45,200" delta="18%" icon="৳" accent="bg-brand-50 text-brand-600" />
          <StatCard label="Orders" value="128" delta="12%" icon="▣" accent="bg-pink-50 text-pink-500" />
          <StatCard label="Customers" value="3,412" delta="6%" icon="◉" accent="bg-amber-50 text-amber-500" />
          <StatCard label="Profit" value="৳12,400" delta="3%" deltaTone="down" icon="↗" accent="bg-emerald-50 text-emerald-500" />
        </section>

        <section className="mt-6">
          <h2 className="text-lg font-semibold">Tokens</h2>
          <Card className="mt-3">
            <p className="text-sm">Brand: Indigo 600 #4F46E5, 500 #6366F1, Violet 500 #8B5CF6, Pink #EC4899. Semantic: success #059669, warning #D97706, danger #E11D48, info #0284C7. Neutrals: bg #F8F9FD, surface #FFFFFF, border #E6E8F2.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="h-10 w-10 rounded-md bg-brand-600" aria-label="Brand 600" />
              <span className="h-10 w-10 rounded-md bg-brand-500" aria-label="Brand 500" />
              <span className="h-10 w-10 rounded-md bg-violet-500" aria-label="Violet 500" />
              <span className="h-10 w-10 rounded-md bg-pink-500" aria-label="Pink 500" />
              <span className="h-10 w-10 rounded-md bg-emerald-500" aria-label="Emerald 500" />
              <span className="h-10 w-10 rounded-md bg-amber-500" aria-label="Amber 500" />
              <span className="h-10 w-10 rounded-md bg-rose-500" aria-label="Rose 500" />
            </div>
            <p className="bangla mt-3 text-sm">বাংলা টেক্সট: লাইন-হাইট ১.৬-এর কম নয়, letter-spacing ০, uppercase কখনো নয়। টাকা সবসময় integer poisha-তে: <Money poisha={125000} /> = ৳1,250.00।</p>
          </Card>
        </section>

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
            {showToast ? <div className="mt-3"><Toast>Save hoyeche ✓ — order updated.</Toast></div> : null}
          </Card>
        </section>

        <section className="mt-6">
          <Tabs tabs={[
            { id: "orders", label: "Orders", count: 24, content: <p className="text-sm">Order list renders here in Step 6 (D3). This tab proves the Tabs component works.</p> },
            { id: "customers", label: "Customers", count: 8, content: <p className="text-sm">Customer list renders here in Step 6 (D3).</p> },
          ]} />
        </section>

        <section className="mt-6 space-y-4">
          <FilterBar chips={["Pending", "Dhaka"]} onSearch={setSearch} />
          <p className="text-sm text-text-muted">Filter search (live): {search || "—"} • Mode: {mode} • Density: {density}</p>
          <DataTable
            caption="Sample orders — real data in D3"
            columns={[{ key: "order", header: "Order" }, { key: "customer", header: "Customer" }, { key: "total", header: "Total" }, { key: "status", header: "Status" }]}
            rows={[
              { order: <span className="font-mono">ORD-100245</span>, customer: <span>Rahim • <Phone phone="+8801712345678" /></span>, total: <Money poisha={125000} />, status: <StatusBadge status="PENDING" /> },
              { order: <span className="font-mono">ORD-100246</span>, customer: <span>Karim • <Phone phone="+8801812345678" /></span>, total: <Money poisha={249900} />, status: <StatusBadge status="DELIVERED" /> },
            ]}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <SkeletonCard />
            <EmptyState title="Ekhono kono order nei" description="Prothom order ashle ekhane dekhaben." actionLabel="Create test order" onAction={() => setShowToast(true)} />
          </div>
        </section>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Confirm order?" onConfirm={() => setModalOpen(false)}>
        <p className="text-sm">Ei order confirm korle stock commit hobe. Continue korben?</p>
      </Modal>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Order ORD-100245 — quick view">
        <p className="text-sm">Customer: Rahim • <Phone phone="+8801712345678" /></p>
        <p className="mt-2 text-sm">Total: <Money poisha={125000} /></p>
        <div className="mt-3"><StatusBadge status="PENDING" /></div>
      </Drawer>
    </div>
  );
}
