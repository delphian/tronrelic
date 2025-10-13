/// <reference types="vitest" />

import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelegramController } from '../../src/modules/notifications/telegram.controller';

const createResponse = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  } as unknown as Response;
  return res;
};

describe('TelegramController webhook', () => {
  const buildController = (overrides: Partial<{ score: number; isIpAllowed: boolean }> = {}) => {
    const sendMessage = vi.fn();
    const answerCallbackQuery = vi.fn();
    const updateOne = vi.fn().mockResolvedValue(null);
    const findOneAndUpdate = vi.fn().mockResolvedValue({ score: overrides.score ?? 5 });

    const controller = new TelegramController({
      telegram: {
        sendMessage,
        answerCallbackQuery
      } as unknown as any,
      userModel: {
        updateOne,
        findOneAndUpdate
      } as unknown as any,
      config: {
        webhookSecret: 'secret-token',
        miniAppUrl: 'https://tronrelic.com/mini-app',
        tapIncrement: 1,
        parity: { maxUnnotifiedLagMs: 0 },
        allowlist: ['149.154.167.0/24'],
        isIpAllowed: vi.fn().mockReturnValue(overrides.isIpAllowed ?? true)
      }
    });

    return {
      controller,
      sendMessage,
      answerCallbackQuery,
      updateOne,
      findOneAndUpdate
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects requests with invalid webhook secret', async () => {
    const { controller, sendMessage } = buildController();
    const req = {
      headers: {
        'x-telegram-bot-api-secret-token': 'invalid'
      }
    } as unknown as Request;
    const res = createResponse();

    await controller.webhook(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'Forbidden' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('dispatches tap command with inline keyboard', async () => {
    const { controller, sendMessage, findOneAndUpdate, updateOne } = buildController({ score: 9 });
    const req = {
      headers: {
        'x-telegram-bot-api-secret-token': 'secret-token',
        'cf-connecting-ip': '149.154.167.50'
      },
      body: {
        message: {
          message_id: 1,
          date: 123,
          chat: { id: -100123456, type: 'supergroup' },
          from: { id: 42, username: 'tronfan' },
          text: '/tap'
        }
      }
    } as unknown as Request;
    const res = createResponse();

    await controller.webhook(req, res);

    expect(updateOne).toHaveBeenCalled();
    expect(findOneAndUpdate).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, options] = sendMessage.mock.calls[0];
    expect(chatId).toBe(String(-100123456));
    expect(text).toContain('Score: 9');
    expect(options?.replyMarkup?.inline_keyboard?.[0]?.[0]?.callback_data).toBe('action:tap');
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('handles tap callback with score increment', async () => {
    const { controller, answerCallbackQuery, findOneAndUpdate } = buildController({ score: 12 });
    const req = {
      headers: {
        'x-telegram-bot-api-secret-token': 'secret-token',
        'cf-connecting-ip': '149.154.167.51'
      },
      body: {
        callback_query: {
          id: 'abc123',
          from: { id: 77, username: 'walletUser' },
          data: 'action:tap',
          message: {
            message_id: 10,
            date: 456,
            chat: { id: -100555, type: 'supergroup' }
          }
        }
      }
    } as unknown as Request;
    const res = createResponse();

    await controller.webhook(req, res);

    expect(findOneAndUpdate).toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalledWith('abc123', expect.stringContaining('12'));
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('rejects requests from non-allowlisted IPs', async () => {
    const { controller } = buildController({ isIpAllowed: false });
    const req = {
      headers: {
        'x-telegram-bot-api-secret-token': 'secret-token',
        'cf-connecting-ip': '203.0.113.10'
      }
    } as unknown as Request;
    const res = createResponse();

    await controller.webhook(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'Forbidden' });
  });
});
