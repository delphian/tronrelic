import { createHash } from 'crypto';
import type { MarketAffiliateTracking } from '@tronrelic/shared';
import { MarketAffiliateModel, type MarketAffiliateDoc } from '../../database/models/market-affiliate-model.js';

function toTracking(doc: MarketAffiliateDoc): MarketAffiliateTracking {
  return {
    link: doc.link,
    conversion: doc.conversion ?? undefined,
    trackingCode: doc.trackingCode,
    impressions: doc.impressions ?? undefined,
    clicks: doc.clicks ?? undefined,
    lastClickAt: doc.lastClickAt ? doc.lastClickAt.toISOString() : undefined
  } satisfies MarketAffiliateTracking;
}

export class MarketAffiliateService {
  private generateTrackingCode(guid: string) {
    return createHash('sha256').update(`market-affiliate:${guid}`).digest('hex').slice(0, 12);
  }

  async ensureTracking(guid: string, link?: string | null, conversion?: string | null): Promise<MarketAffiliateTracking | undefined> {
    if (!guid || !link) {
      return undefined;
    }

    const trackingCode = this.generateTrackingCode(guid);
    let doc = await MarketAffiliateModel.findOne({ guid });

    if (!doc) {
      doc = await MarketAffiliateModel.create({
        guid,
        link,
        conversion: conversion ?? undefined,
        trackingCode
      });
      return toTracking(doc);
    }

    let needsSave = false;

    if (doc.link !== link) {
      doc.link = link;
      needsSave = true;
    }

    const normalizedConversion = conversion ?? undefined;
    if (doc.conversion !== normalizedConversion) {
      doc.conversion = normalizedConversion;
      needsSave = true;
    }

    if (doc.trackingCode !== trackingCode) {
      doc.trackingCode = trackingCode;
      needsSave = true;
    }

    if (needsSave) {
      await doc.save();
    }

    return toTracking(doc);
  }

  async recordImpression(guid: string, trackingCode: string): Promise<MarketAffiliateTracking | null> {
    const doc = await MarketAffiliateModel.findOneAndUpdate(
      { guid, trackingCode },
      { $inc: { impressions: 1 } },
      { new: true }
    );
    return doc ? toTracking(doc) : null;
  }

  async recordClick(guid: string, trackingCode: string): Promise<MarketAffiliateTracking | null> {
    const doc = await MarketAffiliateModel.findOneAndUpdate(
      { guid, trackingCode },
      { $inc: { clicks: 1 }, $set: { lastClickAt: new Date() } },
      { new: true }
    );
    return doc ? toTracking(doc) : null;
  }
}
