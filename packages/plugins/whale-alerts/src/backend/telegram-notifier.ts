import type { IPluginDatabase, ILogger } from '@tronrelic/types';
import type { IWhaleTransaction, IWhaleAlertsConfig } from '../shared/types/index.js';

const TRONSCAN_TX_URL = 'https://tronscan.org/#/transaction/';

/**
 * Telegram notification service for whale alerts.
 *
 * @deprecated This class implements direct Telegram API integration and will be removed
 * in a future version. The telegram-bot plugin now provides a centralized Telegram service
 * that should be used instead via plugin-to-plugin service architecture.
 *
 * Sends Telegram messages for unnotified whale transactions using a simple
 * HTTP API approach. This keeps the plugin independent of Telegram SDK libraries.
 *
 * Migration path:
 * 1. Install and enable telegram-bot plugin
 * 2. Wait for plugin-to-plugin service registry to be implemented
 * 3. Replace this class with calls to ITelegramBotService from context
 * 4. Remove TELEGRAM_TOKEN environment variable (use TELEGRAM_BOT_TOKEN instead)
 */
export class TelegramNotifier {
    private readonly database: IPluginDatabase;
    private readonly logger: ILogger;
    private readonly telegramToken?: string;

    constructor(database: IPluginDatabase, logger: ILogger, telegramToken?: string) {
        this.database = database;
        this.logger = logger.child({ service: 'telegram-notifier' });
        this.telegramToken = telegramToken;
    }

    /**
     * Process pending whale transactions and send Telegram notifications.
     *
     * Finds up to 10 unnotified whale transactions, sends them to the configured
     * Telegram channel/thread, and marks them as notified.
     */
    public async sendPendingNotifications(): Promise<void> {
        if (!this.telegramToken) {
            this.logger.warn('Telegram token not configured; skipping whale notifications');
            return;
        }

        const config = await this.database.get<IWhaleAlertsConfig>('config');
        if (!config?.telegramEnabled || !config.telegramChannelId) {
            this.logger.debug('Telegram notifications disabled or channel not configured');
            return;
        }

        // Find unnotified whale transactions
        const unnotified = await this.database.find<IWhaleTransaction>(
            'transactions',
            { notifiedAt: null },
            {
                sort: { timestamp: 1 },
                limit: 10
            }
        );

        if (!unnotified.length) {
            return;
        }

        this.logger.info({ count: unnotified.length }, 'Sending whale Telegram notifications');

        const now = new Date();

        for (const whale of unnotified) {
            try {
                const message = this.buildWhaleMessage(whale);
                await this.sendTelegramMessage(config.telegramChannelId, message, config.telegramThreadId);

                // Mark as notified
                await this.database.updateMany(
                    'transactions',
                    { txId: whale.txId },
                    { $set: { notifiedAt: now } }
                );

                this.logger.debug({ txId: whale.txId }, 'Sent whale notification');
            } catch (error) {
                this.logger.error({ error, txId: whale.txId }, 'Failed to send whale notification');
            }
        }
    }

    /**
     * Build Telegram message for a whale transaction.
     *
     * @param whale - Whale transaction to format
     * @returns Formatted message string
     */
    private buildWhaleMessage(whale: IWhaleTransaction): string {
        const amount = whale.amountTRX.toLocaleString('en-US', {
            maximumFractionDigits: 0
        });

        const lines = [
            '🐋 Whale transfer detected',
            `Amount: ${amount} TRX`,
            `From: ${whale.fromAddress}`,
            `To: ${whale.toAddress}`,
            `TX: ${TRONSCAN_TX_URL}${whale.txId}`
        ];

        return lines.join('\n');
    }

    /**
     * Send a message to Telegram via HTTP API.
     *
     * @param chatId - Telegram chat/channel ID
     * @param text - Message text
     * @param threadId - Optional message thread ID
     */
    private async sendTelegramMessage(chatId: string, text: string, threadId?: number): Promise<void> {
        if (!this.telegramToken) {
            throw new Error('Telegram token not configured');
        }

        const url = `https://api.telegram.org/bot${this.telegramToken}/sendMessage`;

        const body: any = {
            chat_id: chatId,
            text,
            disable_web_page_preview: true
        };

        if (threadId) {
            body.message_thread_id = threadId;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Telegram API error: ${response.status} - ${errorText}`);
        }
    }
}
