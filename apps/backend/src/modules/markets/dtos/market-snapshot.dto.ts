import { z } from 'zod';

export const MarketSnapshotSchema = z.object({
  guid: z.string().min(1),
  name: z.string().min(1),
  priority: z.number().nonnegative().default(0),
  energy: z.object({
    total: z.number().nonnegative(),
    available: z.number().nonnegative(),
    price: z.number().nonnegative().optional(),
    minOrder: z.number().nonnegative().optional(),
    maxOrder: z.number().nonnegative().optional(),
    unit: z.string().optional()
  }),
  bandwidth: z
    .object({
      total: z.number().nonnegative(),
      available: z.number().nonnegative(),
      price: z.number().nonnegative().optional(),
      unit: z.string().optional()
    })
    .optional(),
  addresses: z
    .array(
      z.object({
        address: z.string().min(1),
        type: z.string().optional(),
        labels: z.array(z.string()).optional(),
        description: z.string().optional()
      })
    )
    .default([]),
  social: z
    .array(
      z.object({
        platform: z.string().min(1),
        link: z.string().url(),
        icon: z.string().optional(),
        label: z.string().optional(),
        verified: z.boolean().optional()
      })
    )
    .optional(),
  siteLinks: z
    .array(
      z.object({
        link: z.string().url(),
        text: z.string().optional(),
        conversion: z.string().optional()
      })
    )
    .optional(),
  fees: z
    .array(
      z.object({
        minutes: z.number().nonnegative().optional(),
        sun: z.number().nonnegative().optional(),
        apy: z.number().optional(),
        minBorrow: z.number().optional(),
        maxBorrow: z.number().optional(),
        description: z.string().optional(),
        type: z.string().optional()
      })
    )
    .optional(),
  orders: z
    .array(
      z.object({
        energy: z.number().nonnegative(),
        created: z.number().nullable().optional(),
        duration: z.number().nonnegative(),
        payment: z.number(),
        buyerAPY: z.number().nullable().optional(),
        sellerAPY: z.number().nullable().optional()
      })
    )
    .optional(),
  affiliate: z
    .object({
      link: z.string().url(),
      commission: z.number().nonnegative().optional(),
      cookieDuration: z.number().nonnegative().optional()
    })
    .optional(),
  description: z.string().optional(),
  iconHtml: z.string().optional(),
  contract: z.string().optional(),
  isActive: z.boolean().default(true),
  reliability: z.number().min(0).max(1).optional(),
  averageDeliveryTime: z.number().nonnegative().optional(),
  supportedRegions: z.array(z.string()).optional(),
  stats: z
    .object({
      totalOrders24h: z.number().nonnegative().optional(),
      totalVolume24h: z.number().nonnegative().optional(),
      averageOrderSize: z.number().nonnegative().optional(),
      successRate: z.number().min(0).max(1).optional(),
      orderMaxBuyerAPY: z.number().optional(),
      orderMaxSellerAPY: z.number().optional()
    })
    .optional(),
  availabilityPercent: z.number().min(0).max(100).optional(),
  effectivePrice: z.number().nonnegative().optional(),
  metadata: z.record(z.any()).optional()
});

export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;
