// In-memory DEMO store — Agent 18 (riders). TEMPORARY: replaced by a
// Prisma-backed store behind these same shapes once Prisma generate
// succeeds (schema already has the Vendor model; Rider / RiderDelivery
// models are a follow-up for the schema owner). All sample rows are
// labelled SAMPLE and use the reserved demo phone pattern.
import { hashDeliveryOtp } from "./proof";
import type { Rider, RiderDelivery, RiderZone } from "./types";

export const DEMO_RIDER_ZONES: RiderZone[] = [
  { id: "dhaka_north", name: "Dhaka North", district: "Dhaka", area: "Mirpur / Uttara" },
  { id: "dhaka_south", name: "Dhaka South", district: "Dhaka", area: "Dhanmondi / Motijheel" },
  { id: "gazipur", name: "Gazipur", district: "Gazipur" },
  { id: "narayanganj", name: "Narayanganj", district: "Narayanganj" },
  { id: "chattogram", name: "Chattogram", district: "Chattogram" },
];

class DemoRiderStore {
  private riders: Rider[] = [
    {
      id: "rider_demo_1", name: "SAMPLE Rider One", phone: "+8801711000001",
      vehicle: "MOTORCYCLE", vehicleReg: "Dhaka Metro-Ha 00-0001", zoneId: "dhaka_north",
      status: "ON_DELIVERY", payoutPerDeliveryPoisha: 6000, createdAt: "2026-10-24T00:00:00.000Z",
    },
    {
      id: "rider_demo_2", name: "SAMPLE Rider Two", phone: "+8801711000002",
      vehicle: "BICYCLE", zoneId: "dhaka_north",
      status: "ACTIVE", payoutPerDeliveryPoisha: 4000, createdAt: "2026-10-24T00:00:00.000Z",
    },
    {
      id: "rider_demo_3", name: "SAMPLE Rider Three", phone: "+8801711000003",
      vehicle: "MOTORCYCLE", zoneId: "dhaka_south",
      status: "ACTIVE", payoutPerDeliveryPoisha: 6000, createdAt: "2026-10-24T00:00:00.000Z",
    },
  ];

  private deliveries: RiderDelivery[] = [
    {
      id: "rdlv_demo_1", orderId: "order_demo_1", riderId: "rider_demo_1", zoneId: "dhaka_north",
      status: "PICKED_UP", codAmountPoisha: 125000, assignedAt: "2026-10-24T02:00:00.000Z",
      pickedUpAt: "2026-10-24T02:20:00.000Z",
    },
    {
      id: "rdlv_demo_2", orderId: "order_demo_2", riderId: "rider_demo_1", zoneId: "dhaka_north",
      status: "DELIVERED", codAmountPoisha: 85000, codCollectedPoisha: 85000,
      assignedAt: "2026-10-24T00:30:00.000Z", pickedUpAt: "2026-10-24T00:45:00.000Z",
      completedAt: "2026-10-24T01:30:00.000Z",
      // Demo proof: hash of the demo code "123456" — the code itself is not stored.
      proof: { kind: "OTP", otpHash: hashDeliveryOtp("123456"), capturedAt: "2026-10-24T01:30:00.000Z" },
    },
  ];

  listZones(): RiderZone[] { return [...DEMO_RIDER_ZONES]; }
  listRiders(): Rider[] { return [...this.riders]; }
  getRider(id: string): Rider | undefined { return this.riders.find((r) => r.id === id); }
  addRider(r: Rider): Rider { this.riders.push(r); return r; }
  replaceRider(r: Rider): void { this.riders = this.riders.map((x) => (x.id === r.id ? r : x)); }
  listDeliveries(riderId?: string): RiderDelivery[] {
    return riderId ? this.deliveries.filter((d) => d.riderId === riderId) : [...this.deliveries];
  }
  getDelivery(id: string): RiderDelivery | undefined { return this.deliveries.find((d) => d.id === id); }
  addDelivery(d: RiderDelivery): RiderDelivery { this.deliveries.push(d); return d; }
  replaceDelivery(d: RiderDelivery): void {
    this.deliveries = this.deliveries.map((x) => (x.id === d.id ? d : x));
  }
}

export const demoRiderStore = new DemoRiderStore();
