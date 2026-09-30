'use client';

/**
 * @fileoverview The MCP endpoint's master kill switch.
 *
 * The MCP module cannot be disabled like a plugin, so this switch is how an
 * operator takes the endpoint offline. It is drawn as a full-width card with a
 * large state label and a single large action, in a danger tone while the
 * endpoint is live, so its state is readable at a glance and the off action is
 * one click away. Turning the endpoint on asks for confirmation because it
 * opens a door; turning it off does not, because an incident is no time for a
 * dialog.
 */

import { useCallback, useState } from 'react';
import { Power, PowerOff } from 'lucide-react';
import type { IMcpSettings, IMcpStatus } from '@/types';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { useModal } from '../../../../components/ui/ModalProvider';
import { useToast } from '../../../../components/ui/ToastProvider';
import { setMcpEnabled } from '../../../../modules/mcp';
import styles from './page.module.scss';

/**
 * Props for {@link KillSwitchCard}.
 */
interface IKillSwitchCardProps {
    /** Current status; null when it could not be loaded. */
    status: IMcpStatus | null;
    /**
     * Receives the stored settings after a successful change. Only the
     * settings are handed back, so the parent merges them into its current
     * status and keeps any counts that changed while the request was in flight.
     */
    onSettingsChange: (settings: IMcpSettings) => void;
}

/**
 * Render the kill switch.
 *
 * @param props - {@link IKillSwitchCardProps}.
 * @returns The kill switch card.
 */
export function KillSwitchCard({ status, onSettingsChange }: IKillSwitchCardProps) {
    const [working, setWorking] = useState(false);
    const { open, close } = useModal();
    const { push } = useToast();
    const enabled = status?.settings.enabled === true;

    /**
     * Apply a new switch state and report the outcome.
     *
     * @param next - The state to apply.
     */
    const apply = useCallback(async (next: boolean): Promise<void> => {
        if (status) {
            setWorking(true);
            try {
                const settings = await setMcpEnabled(next);
                onSettingsChange(settings);
                push({ tone: next ? 'warning' : 'success', title: next ? 'MCP endpoint is ON' : 'MCP endpoint is OFF' });
            } catch (error) {
                push({ tone: 'danger', title: 'Could not change the MCP endpoint', description: error instanceof Error ? error.message : String(error) });
            } finally {
                setWorking(false);
            }
        }
    }, [status, onSettingsChange, push]);

    /**
     * Handle the main button: turn off at once, or confirm before turning on.
     */
    const handleClick = useCallback((): void => {
        if (enabled) {
            void apply(false);
        } else {
            const modalId = open({
                title: 'Turn on the MCP endpoint',
                content: (
                    <ConfirmDialog
                        label="MCP endpoint"
                        confirmLabel="Turn on"
                        message={<>Members of <strong>{status?.groupId ?? 'mcp-users'}</strong> will be able to connect AI clients and call the {status?.servedToolCount ?? 0} tools currently approved. Continue?</>}
                        onConfirm={
                            /**
                             * Turn the endpoint on once the admin confirms, then
                             * close the dialog; `apply` reports the outcome.
                             */
                            async () => { await apply(true); close(modalId); }
                        }
                        onCancel={() => close(modalId)}
                    />
                )
            });
        }
    }, [enabled, apply, open, close, status]);

    return (
        <Card className={`${styles.kill_switch} ${enabled ? styles['kill_switch--on'] : styles['kill_switch--off']}`}>
            <div className={styles.kill_switch__body}>
                <div className={styles.kill_switch__state}>
                    {enabled
                        ? <Power size={24} aria-hidden className={styles.kill_switch__icon_on} />
                        : <PowerOff size={24} aria-hidden className={styles.kill_switch__icon_off} />}
                    <div>
                        <div className={styles.kill_switch__label} role="status">
                            {status === null ? 'MCP endpoint status unavailable' : `MCP endpoint is ${enabled ? 'ON' : 'OFF'}`}
                        </div>
                        <div className={styles.kill_switch__detail}>
                            {status === null
                                ? 'The switch state could not be loaded, so it cannot be changed here. Reload the page to try again.'
                                : enabled
                                    ? 'Members of the MCP group can connect and call approved tools.'
                                    : 'Every request is refused with 503. Nothing is reachable over MCP.'}
                            {status?.settings.updatedAt && (
                                <> Last changed <ClientTime date={status.settings.updatedAt} format="datetime" />.</>
                            )}
                        </div>
                    </div>
                </div>
                <Button
                    variant={enabled ? 'danger' : 'primary'}
                    size="lg"
                    icon={enabled ? <PowerOff size={18} aria-hidden /> : <Power size={18} aria-hidden />}
                    loading={working}
                    disabled={status === null}
                    onClick={handleClick}
                >
                    {enabled ? 'Turn off MCP' : 'Turn on MCP'}
                </Button>
            </div>
        </Card>
    );
}
