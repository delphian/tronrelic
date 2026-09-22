/**
 * @fileoverview The vendor registry: one entry per external data vendor, with
 * its admin descriptor, its connectivity test, and the capability
 * implementations attached to it.
 *
 * Why a registry: before it, each vendor was a hand-written pair of admin routes
 * and a hand-written admin card, and a consumer such as price-history was
 * constructed with one concrete vendor. Adding a vendor meant touching the
 * controller, the router, the frontend tab, and the consumer. With the registry
 * a vendor is declared once — descriptor plus test — the generic admin surface
 * renders it, and a consumer asks for "every vendor with the price-history
 * capability" instead of naming one.
 *
 * Capability implementations are attached by the module that owns the
 * capability (price-history attaches its per-vendor providers during its own
 * `init()`), because the adapter from a vendor's wire shape to a capability's
 * contract belongs with the contract's consumer, not with the vendor's
 * transport. The registry is the meeting point.
 */

import type { IProviderDescriptor, ProviderCapability } from '../database/index.js';
import type { IPriceHistoryProvider } from '../capabilities/IPriceHistoryProvider.js';

/**
 * Outcome of a vendor's connectivity test, in the shape the generic admin card
 * renders. A failed test is a value, not a throw, so the card can show the
 * reason inline.
 */
export interface IProviderTestResult {
    /** Whether the test call succeeded and returned usable data. */
    ok: boolean;
    /** Human-readable result for the admin UI. */
    message: string;
    /** Round-trip latency of the test call in milliseconds, when it completed. */
    latencyMs?: number;
    /** Whether a stored credential was sent with the test. */
    usingKey?: boolean;
}

/**
 * What a module supplies when it declares a vendor.
 */
export interface IProviderVendorRegistration {
    /** The admin descriptor: identity, fields, declared capabilities. */
    descriptor: IProviderDescriptor;
    /**
     * The complete configuration a fresh deployment starts with. Merged under
     * whatever is stored so every read returns a full object, and the reference
     * the generic save handler merges an operator's edit over.
     */
    defaults: object;
    /**
     * Probe the vendor with its saved configuration. Supplied by the vendor's
     * transport client, which knows the cheapest call that proves a credential
     * and a host both work.
     */
    testConnection: () => Promise<IProviderTestResult>;
    /**
     * Report whether the operator has the vendor switched on, read from its
     * saved configuration. Consumers show it beside the vendor in routing
     * settings so an operator can see why a listed source is being skipped.
     */
    isEnabled: () => Promise<boolean>;
}

/**
 * A registered vendor plus whatever capability implementations have attached.
 */
export interface IProviderVendor extends IProviderVendorRegistration {
    /** The `price-history` implementation, once the price-history module attaches it. */
    priceHistory?: IPriceHistoryProvider;
}

/**
 * The registry contract consumers depend on. Kept as an interface so a consumer
 * module declares it as a dependency and tests can inject a fake.
 */
export interface IProviderRegistry {
    /**
     * Declare a vendor. Refuses a duplicate id, because two registrations for
     * one id would mean two modules each believe they own the vendor's config.
     *
     * @param registration - The vendor's descriptor, test, and enabled check.
     */
    registerVendor(registration: IProviderVendorRegistration): void;

    /**
     * Attach a vendor's `price-history` implementation. The vendor must already
     * be registered and must declare the capability, so a descriptor and its
     * implementation cannot silently disagree about what the vendor does.
     *
     * @param vendorId - The vendor to attach to.
     * @param provider - The implementation.
     */
    attachPriceHistoryProvider(vendorId: string, provider: IPriceHistoryProvider): void;

    /**
     * Look up one vendor.
     *
     * @param vendorId - The vendor id.
     * @returns The vendor, or undefined when none is registered under the id.
     */
    getVendor(vendorId: string): IProviderVendor | undefined;

    /**
     * Every registered vendor, in registration order — the order the admin
     * surface lists them in.
     *
     * @returns All vendors.
     */
    listVendors(): IProviderVendor[];

    /**
     * Vendors that declare a capability, in registration order, whether or not
     * an implementation has attached yet.
     *
     * @param capability - The capability to filter on.
     * @returns The matching vendors.
     */
    listVendorsWithCapability(capability: ProviderCapability): IProviderVendor[];

    /**
     * The attached `price-history` implementation for a vendor.
     *
     * @param vendorId - The vendor id.
     * @returns The implementation, or undefined when the vendor is unknown or nothing attached.
     */
    getPriceHistoryProvider(vendorId: string): IPriceHistoryProvider | undefined;
}

/**
 * Singleton registry. Wired once at bootstrap by the providers module; the
 * price-history module receives it through dependency injection.
 */
export class ProviderRegistry implements IProviderRegistry {
    private static instance: ProviderRegistry | null = null;

    private readonly vendors = new Map<string, IProviderVendor>();

    /** Private so the singleton owns construction. */
    private constructor() {}

    /**
     * @returns The shared instance, created on first call.
     */
    public static getInstance(): ProviderRegistry {
        if (!ProviderRegistry.instance) {
            ProviderRegistry.instance = new ProviderRegistry();
        }
        return ProviderRegistry.instance;
    }

    /** Reset for tests. */
    public static resetInstance(): void {
        ProviderRegistry.instance = null;
    }

    /** @inheritdoc */
    public registerVendor(registration: IProviderVendorRegistration): void {
        const id = registration.descriptor.id;
        if (this.vendors.has(id)) {
            throw new Error(`Provider vendor '${id}' is already registered`);
        }
        this.vendors.set(id, { ...registration });
    }

    /** @inheritdoc */
    public attachPriceHistoryProvider(vendorId: string, provider: IPriceHistoryProvider): void {
        const vendor = this.vendors.get(vendorId);
        if (!vendor) {
            throw new Error(`Cannot attach a price-history provider to unknown vendor '${vendorId}'`);
        }
        if (!vendor.descriptor.capabilities.includes('price-history')) {
            throw new Error(`Vendor '${vendorId}' does not declare the price-history capability`);
        }
        vendor.priceHistory = provider;
    }

    /** @inheritdoc */
    public getVendor(vendorId: string): IProviderVendor | undefined {
        return this.vendors.get(vendorId);
    }

    /** @inheritdoc */
    public listVendors(): IProviderVendor[] {
        return Array.from(this.vendors.values());
    }

    /** @inheritdoc */
    public listVendorsWithCapability(capability: ProviderCapability): IProviderVendor[] {
        return this.listVendors().filter((vendor) => vendor.descriptor.capabilities.includes(capability));
    }

    /** @inheritdoc */
    public getPriceHistoryProvider(vendorId: string): IPriceHistoryProvider | undefined {
        return this.vendors.get(vendorId)?.priceHistory;
    }
}
