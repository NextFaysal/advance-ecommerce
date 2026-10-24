// Rider store — Agent 18 interface, DB-backed since 2026-10-24.
//
// Persistence lives behind this interface; the runtime store is
// PrismaRiderStore in ./db-store.ts (shared instance: `riderStore`,
// used by the rider API routes). The in-memory implementations stay
// for tests and for the admin page playground, which still renders
// demo rows synchronously through `demoRiderStore` until the UI wiring
// moves it to the API. This file must NEVER import Prisma
// (client-bundle safety). Zones are static configuration data (no zone
// table exists); both implementations serve the same list.
import { hashDeliveryOtp } from "./proof";
import type { Rider, RiderDelivery, RiderZone } from "./types";

export const DEMO_RIDER_ZONES: RiderZone[] = [
  { id: "dhaka_north", name: "Dhaka North", district: "Dhaka", area: "Mirpur / Uttara" },
  { id: "dhaka_south", name: "Dhaka South", district: "Dhaka", area: "Dhanmondi / Motijheel" },
  { id: "gazipur", name: "Gazipur", district: "Gazipur" },
  { id: "narayanganj", name: "Narayanganj", district: "Narayanganj" },
  { id: "chattogram", name: "Chattogram", district: "Chattogram" },
];

export interface RiderStore {
  listZones(): RiderZone[];
  listRiders(): Promise<Rider[]>;
  getRider(id: string): Promise<Rider | undefined>;
  addRider(r: Rider): Promise<Rider>;
  replaceRider(r: Rider): Promise<void>;
  listDeliveries(riderId?: string): Promise<RiderDelivery[]>;
  getDelivery(id: string): Promise<RiderDelivery | undefined>;
  addDelivery(d: RiderDelivery): Promise<RiderDelivery>;
  replaceDelivery(d: RiderDelivery): Promise<void>;
}

/** Thrown by addRider when the phone is already registered (DB unique). */
export class RiderPhoneTakenError extends Error {
  constructor(phone: string) {
    super(`A rider with phone ${phone} already exists.`);
    this.name = "RiderPhoneTakenError";
  }
}

const SAMPLE_RIDERS: Rider[] = [
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

const SAMPLE_DELIVERIES: RiderDelivery[] = [
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

/* ------------------------------------------------------------------ */
/* In-memory implementation (tests / fixtures)                          */
/* ------------------------------------------------------------------ */

export class InMemoryRiderStore implements RiderStore {
  private riders: Rider[] = SAMPLE_RIDERS.map((r) => ({ ...r }));
  private deliveries: RiderDelivery[] = SAMPLE_DELIVERIES.map((d) => ({ ...d }));

  listZones(): RiderZone[] { return [...DEMO_RIDER_ZONES]; }
  async listRiders(): Promise<Rider[]> { return [...this.riders]; }
  async getRider(id: string): Promise<Rider | undefined> { return this.riders.find((r) => r.id === id); }
  async addRider(r: Rider): Promise<Rider> { this.riders.push(r); return r; }
  async replaceRider(r: Rider): Promise<void> {
    this.riders = this.riders.map((x) => (x.id === r.id ? r : x));
  }
  async listDeliveries(riderId?: string): Promise<RiderDelivery[]> {
    return riderId ? this.deliveries.filter((d) => d.riderId === riderId) : [...this.deliveries];
  }
  async getDelivery(id: string): Promise<RiderDelivery | undefined> {
    return this.deliveries.find((d) => d.id === id);
  }
  async addDelivery(d: RiderDelivery): Promise<RiderDelivery> { this.deliveries.push(d); return d; }
  async replaceDelivery(d: RiderDelivery): Promise<void> {
    this.deliveries = this.deliveries.map((x) => (x.id === d.id ? d : x));
  }
}

/* ------------------------------------------------------------------ */
/* Sync demo facade for the admin page playground (unchanged contract)  */
/* ------------------------------------------------------------------ */

class DemoRiderStore {
  private riders: Rider[] = SAMPLE_RIDERS.map((r) => ({ ...r }));
  private deliveries: RiderDelivery[] = SAMPLE_DELIVERIES.map((d) => ({ ...d }));

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

/** Shared demo instance used by the admin riders page only. */
export const demoRiderStore = new DemoRiderStore();
