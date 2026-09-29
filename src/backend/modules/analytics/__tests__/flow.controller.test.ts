/**
 * @file flow.controller.test.ts
 *
 * Tests for the date-range limit on the public inflow/outflow endpoints.
 *
 * The series endpoint builds one bucket per day across the requested range in a
 * synchronous loop, so an unbounded range from an anonymous caller could block
 * the event loop and exhaust memory. These tests pin that the controller refuses
 * such a range during parsing, before the service is ever called.
 */
import { describe, it, expect, vi } from 'vitest';
import { ZodError } from 'zod';
import { FlowController } from '../flow.controller.js';

const ADDRESS = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';
const TARGET = 'TXDyX6Y8yBgH2T1X6g9NceHDdNCztX9xeQ';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Build a controller over a service double so the tests can assert whether the
 * service was reached, which is the whole point of validating during parsing.
 *
 * @returns The controller, its service spies, and a response double.
 */
function setup() {
    const service = {
        getTotals: vi.fn().mockResolvedValue({ success: true }),
        getSeries: vi.fn().mockResolvedValue({ success: true, transactions: [] })
    };
    const controller = new FlowController(service as any, 'inflow');
    const res = { json: vi.fn() };
    return { controller, service, res };
}

describe('FlowController', () => {
    it('refuses a series range wider than 366 days before calling the service', async () => {
        const { controller, service, res } = setup();
        const req = { body: { address: ADDRESS, targetAddress: TARGET, startDate: 0, endDate: 8.64e15 } };

        await expect(controller.series(req as any, res as any)).rejects.toBeInstanceOf(ZodError);
        expect(service.getSeries).not.toHaveBeenCalled();
    });

    it('refuses a totals range wider than 366 days before calling the service', async () => {
        const { controller, service, res } = setup();
        const req = { body: { address: ADDRESS, startDate: 0, endDate: 400 * DAY_MS } };

        await expect(controller.totals(req as any, res as any)).rejects.toBeInstanceOf(ZodError);
        expect(service.getTotals).not.toHaveBeenCalled();
    });

    it('refuses a non-finite timestamp', async () => {
        const { controller, service, res } = setup();
        const req = { body: { address: ADDRESS, startDate: 'Infinity', endDate: 0 } };

        await expect(controller.totals(req as any, res as any)).rejects.toBeInstanceOf(ZodError);
        expect(service.getTotals).not.toHaveBeenCalled();
    });

    it('passes a range inside the limit through to the service', async () => {
        const { controller, service, res } = setup();
        const start = Date.UTC(2026, 0, 1);
        const req = { body: { address: ADDRESS, targetAddress: TARGET, startDate: start, endDate: start + 30 * DAY_MS } };

        await controller.series(req as any, res as any);

        expect(service.getSeries).toHaveBeenCalledWith('inflow', ADDRESS, TARGET, start, start + 30 * DAY_MS, 0);
        expect(res.json).toHaveBeenCalled();
    });
});
