import type { Request, Response } from 'express';
import { z } from 'zod';
import { FlowAnalyticsService, type FlowDirection } from './flow-analytics.service.js';

/**
 * Widest date range, in milliseconds, a flow query may span.
 *
 * The series endpoint emits one bucket per day across the whole range in a
 * synchronous loop, so an anonymous caller sending `startDate: 0` and the
 * largest valid timestamp asked for about 100 million strings, blocking the
 * event loop and exhausting memory. A year covers any real account-flow chart.
 */
const MAX_FLOW_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

const flowFieldsSchema = z.object({
  address: z.string().min(34),
  startDate: z.coerce.number(),
  endDate: z.coerce.number(),
  ignore: z.coerce.number().min(0).default(0)
});

/**
 * Reject a request whose date range is wider than `MAX_FLOW_RANGE_MS`.
 *
 * Applied as a refinement on both request schemas so the bound is checked
 * during parsing, before the service builds a query or a bucket list. The
 * resulting `ZodError` reaches the error middleware as a 400.
 *
 * @param payload - Parsed request carrying the two millisecond timestamps.
 * @returns True when the span is within the limit.
 */
function isRangeWithinLimit(payload: { startDate: number; endDate: number }): boolean {
  return Math.abs(payload.endDate - payload.startDate) <= MAX_FLOW_RANGE_MS;
}

const rangeLimitMessage = { message: 'Date range must not exceed 366 days', path: ['endDate'] };

const totalsSchema = flowFieldsSchema.refine(isRangeWithinLimit, rangeLimitMessage);

const seriesSchema = flowFieldsSchema
  .extend({ targetAddress: z.string().min(34) })
  .refine(isRangeWithinLimit, rangeLimitMessage);

export class FlowController {
  constructor(private readonly service: FlowAnalyticsService, private readonly direction: FlowDirection) {}

  totals = async (req: Request, res: Response) => {
    const payload = totalsSchema.parse(req.body);
    const result = await this.service.getTotals(
      this.direction,
      payload.address,
      payload.startDate,
      payload.endDate,
      payload.ignore
    );
    res.json(result);
  };

  series = async (req: Request, res: Response) => {
    const payload = seriesSchema.parse(req.body);
    const result = await this.service.getSeries(
      this.direction,
      payload.address,
      payload.targetAddress,
      payload.startDate,
      payload.endDate,
      payload.ignore
    );
    res.json(result);
  };
}
