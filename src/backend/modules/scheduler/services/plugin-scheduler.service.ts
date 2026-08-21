/**
 * @fileoverview Per-plugin scheduler facade.
 *
 * Each plugin receives an `ISchedulerService` instance wrapping the shared
 * `SchedulerService`. The facade records every job the plugin registers so the
 * plugin manager can unregister all of them when the plugin is disabled, and
 * delete their stored configuration when it is uninstalled, without each plugin
 * tracking its own job names by hand.
 *
 * Why this exists: scheduler registrations used to be permanent. Plugins are
 * toggleable at runtime, so a disabled plugin's cron job kept firing on its
 * schedule — running handler closures that still held the old plugin context and
 * writing to collections the plugin no longer owned — until the process
 * restarted. Uninstalling was worse: the job kept firing and its
 * `scheduler_configs` document outlived the plugin entirely. Several shipped
 * plugins never called `unregister` at all, and one of them registers two jobs,
 * so relying on plugin authors to remember was not working. Scoping
 * registrations per plugin is what makes "disabled" actually mean stopped.
 *
 * @module modules/scheduler/services/plugin-scheduler.service
 */

import type { ISchedulerService, ISystemLogService } from '@/types';
import type { CronJobHandler } from './scheduler.service.js';

/**
 * The shared scheduler as this facade needs to see it.
 *
 * Extends the plugin-facing contract with the two capabilities teardown needs and
 * plugins do not: deleting a stored job configuration by name without the job having
 * to still be registered, and asking whether a name is registered at all.
 * `SchedulerService.unregister()` refuses a name it does not hold, which is right for
 * a plugin calling it directly but wrong for an uninstall running after the plugin was
 * already disabled — at that point the job is gone from memory and only its
 * `scheduler_configs` document remains.
 *
 * Declared structurally rather than implemented by name, so the scheduler service
 * does not have to import anything from the plugin layer.
 */
export interface IPluginSchedulerHost extends ISchedulerService {
    /**
     * Delete stored configuration for the named jobs.
     *
     * @param names - Job names whose configuration documents should be removed.
     * @returns Count of documents deleted.
     */
    deleteJobConfigs(names: string[]): Promise<number>;

    /**
     * Report whether a job is currently registered.
     *
     * @param name - Job name to look for.
     * @returns True when the shared scheduler currently holds a job under this name.
     */
    hasJob(name: string): boolean;
}

/**
 * Per-plugin facade over the shared scheduler service.
 *
 * Delegates every call to the underlying service while recording job names so
 * `unregisterAll()` can tear them down. Implements the same `ISchedulerService`
 * contract plugins already consume, so plugin code needs no change to benefit.
 */
export class PluginSchedulerService implements ISchedulerService {
    /**
     * Jobs this plugin currently holds in the shared scheduler.
     *
     * Emptied on teardown, and by the plugin's own `unregister()` calls, so a
     * name is never unregistered twice.
     */
    private readonly active = new Set<string>();

    /**
     * Every job name this plugin has registered since the process started.
     *
     * Survives a disable, unlike `active`, because a disabled job keeps its
     * `scheduler_configs` document so an operator's schedule edits are still
     * there when the plugin is re-enabled. Uninstall is the point at which that
     * document should go, and by then the name is no longer in `active`.
     */
    private readonly owned = new Set<string>();

    /** Whether new registrations are still accepted. */
    private open: boolean = true;

    /**
     * Construct a facade scoped to one plugin.
     *
     * @param pluginId - Owning plugin id, used for diagnostics when a teardown
     *                   misbehaves and in the error raised on a late registration.
     * @param host - Shared process-wide scheduler that owns the cron tasks.
     * @param logger - Plugin-scoped logger, so teardown warnings are attributed
     *                 to the plugin that caused them.
     */
    constructor(
        private readonly pluginId: string,
        private readonly host: IPluginSchedulerHost,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Register a cron job and record it for teardown.
     *
     * The name is recorded only after the shared scheduler accepts it, because a
     * rejected registration — a duplicate name, or an invalid cron expression —
     * created no job, and tracking it would make teardown try to unregister
     * something that was never there.
     *
     * @param name - Unique job identifier, conventionally prefixed with the
     *               plugin id so two plugins cannot collide.
     * @param defaultSchedule - Cron expression used until an operator overrides
     *                          it from the admin interface.
     * @param handler - The work to run on each tick.
     */
    public register(name: string, defaultSchedule: string, handler: CronJobHandler): void {
        this.assertOpen(`register('${name}')`);
        this.host.register(name, defaultSchedule, handler);
        this.active.add(name);
        this.owned.add(name);
    }

    /**
     * Stop a job from firing while keeping its configuration.
     *
     * Restricted to jobs this plugin registered, for the same reason `unregister()`
     * is. `SchedulerService.disable()` persists `enabled: false` to the job's stored
     * configuration, so a plugin naming a job it does not own — a typo, or a constant
     * that drifted — would stop that job and keep it stopped across every restart.
     * Named `blockchain:sync` by accident, it would silently halt blockchain sync for
     * good.
     *
     * The result is deliberately not tracked. A disabled job is still registered, so
     * teardown must still unregister it. Nor does this check the lifecycle window the
     * way `register()` does: suspending a job while the plugin's own configuration is
     * incomplete is a legitimate thing to do at runtime, long after `init()` has run.
     *
     * @param name - Job identifier to disable. Must be one this plugin registered and
     *               has not since unregistered.
     */
    public async disable(name: string): Promise<void> {
        if (!this.active.has(name)) {
            throw new Error(
                `Plugin '${this.pluginId}' cannot disable scheduler job '${name}', which it did not ` +
                `register. A plugin may only disable its own jobs.`
            );
        }

        await this.host.disable(name);

        return;
    }

    /**
     * Unregister one job, tolerating a name this plugin has already released.
     *
     * A plugin whose `disable` hook unregisters a job and whose `uninstall` hook then
     * unregisters the same job with `deleteFromDatabase: true` is following the
     * documented pattern, and several shipped plugins do exactly that. The second call
     * reaches a shared scheduler that no longer holds the job and would throw, aborting
     * the uninstall hook partway through, so it is answered from this facade's own
     * record instead: the stored configuration goes and the call returns.
     *
     * That record covers only the current process. A plugin uninstalled after a restart
     * that left it disabled never ran `init()`, so nothing is tracked, and the call is
     * delegated — meaning the shared scheduler's `Job X not registered` does reach the
     * caller. That is deliberate rather than an oversight; the branch below says why,
     * and every shipped uninstall hook guards the call.
     *
     * @param name - Job identifier to unregister.
     * @param deleteFromDatabase - Whether to also delete the job's stored
     *                             configuration, which is what an uninstall wants
     *                             and a disable does not.
     */
    public async unregister(name: string, deleteFromDatabase: boolean = false): Promise<void> {
        const heldByThisPlugin = this.active.has(name);

        if (!heldByThisPlugin && !this.host.hasJob(name)) {
            // Nothing is registered under this name, so there is no cron task to stop
            // and the shared scheduler would only throw. An uninstall still wants the
            // stored configuration gone, which is reachable by name whether or not the
            // job is in memory.
            // Only a name this plugin registered earlier in this process. A disabled
            // plugin keeps its stored schedule on purpose, so a name nothing holds may
            // still be another plugin's tuned configuration waiting for its next
            // enable. Deleting on the caller's word alone would let one plugin's stale
            // constant silently discard it.
            if (this.owned.has(name)) {
                if (deleteFromDatabase) {
                    await this.host.deleteJobConfigs([name]);
                    this.owned.delete(name);
                }

                // A disable asking to stop a job this plugin already released is a
                // duplicate call, not a mistake.
                return;
            }

            // No record of this plugin ever registering the name. Either it is a typo,
            // or the backend started with this plugin disabled so `init()` never ran and
            // nothing was registered. Both are delegated so the shared scheduler's own
            // error reaches the plugin, which is why an uninstall from a boot-disabled
            // state leaves stored configuration behind — a documented, inert gap, and a
            // cheaper one than deleting a document that may not belong to this plugin.
        } else if (!heldByThisPlugin) {
            // Registered in the shared scheduler, but not by this plugin: a core job
            // such as `blockchain:sync`, or a job another plugin owns. Refused rather
            // than passed through. A stale or mistyped constant in an uninstall hook
            // would otherwise stop core blockchain sync and delete its stored schedule,
            // with nothing but a log line to show for it. No shipped plugin unregisters
            // a name it did not register, so nothing legitimate is turned away.
            throw new Error(
                `Plugin '${this.pluginId}' cannot unregister scheduler job '${name}', which it did not ` +
                `register. A plugin may only unregister its own jobs.`
            );
        }

        await this.host.unregister(name, deleteFromDatabase);
        this.active.delete(name);
        if (deleteFromDatabase) {
            this.owned.delete(name);
        }

        return;
    }

    /**
     * Unregister every job this plugin owns and close the facade.
     *
     * Called by the plugin manager on disable and uninstall. Each unregistration
     * is isolated, so one job that fails to stop cannot leave the rest firing —
     * which is the whole failure this facade exists to prevent. On uninstall the
     * stored configuration of jobs an earlier disable already unregistered is
     * swept as well, since nothing will ever look at those documents again.
     *
     * @param deleteFromDatabase - True on uninstall, to delete stored job
     *                             configuration; false on disable, so an
     *                             operator's schedule edits survive a toggle.
     * @returns Count of jobs actually unregistered, for the caller's teardown log.
     *          Jobs whose unregistration threw are excluded, so the number never
     *          claims a job was stopped when the failure warning says otherwise.
     */
    public async unregisterAll(deleteFromDatabase: boolean = false): Promise<number> {
        this.open = false;

        let unregistered = 0;
        const names = Array.from(this.active);

        for (const name of names) {
            try {
                await this.host.unregister(name, deleteFromDatabase);
                unregistered += 1;

                // Dropped from `active` only on success. `SchedulerService.unregister`
                // stops the cron task before removing the job from its map, so a task
                // that throws while stopping leaves the job registered and still
                // firing. Forgetting the name here would mean no later teardown ever
                // retried it, which is the failure this facade exists to prevent.
                this.active.delete(name);

                // Only stop tracking the name once its stored configuration is
                // actually gone. A disable leaves that document in place on
                // purpose, and the uninstall that may follow needs the name to
                // still be here in order to find it.
                if (deleteFromDatabase) {
                    this.owned.delete(name);
                }
            } catch (err) {
                this.logger.warn(
                    { err, pluginId: this.pluginId, jobName: name },
                    'Scheduler job unregister threw during plugin teardown'
                );
            }
        }

        if (deleteFromDatabase && this.owned.size > 0) {
            // Only names nothing holds any more. A name this plugin gave up on an
            // earlier disable is free for another plugin to register, and deleting a
            // live job's configuration would discard an operator's tuned schedule
            // without stopping the job, which keeps running from memory until the next
            // restart drops it back to the default.
            const stale = Array.from(this.owned).filter((jobName) => !this.host.hasJob(jobName));

            if (stale.length > 0) {
                try {
                    await this.host.deleteJobConfigs(stale);

                    // Forgotten only after the delete resolves. Clearing up front would
                    // strand the documents for good when the delete fails, because the
                    // warning below is the only handling and a later uninstall attempt
                    // would have no names left to retry.
                    for (const jobName of stale) {
                        this.owned.delete(jobName);
                    }
                } catch (err) {
                    this.logger.warn(
                        { err, pluginId: this.pluginId, jobNames: stale },
                        'Scheduler job configuration delete threw during plugin uninstall'
                    );
                }
            }
        }

        return unregistered;
    }

    /**
     * Reopen the facade so a re-enabled plugin can register its jobs again.
     *
     * `enablePlugin` re-runs the plugin's init hook, which registers the same
     * jobs from scratch. Without rearming, those calls would throw against a
     * facade closed by the previous disable — mirroring how the hook and observer
     * facades are rearmed on the same lifecycle transitions.
     */
    public rearm(): void {
        this.open = true;
    }

    /**
     * Close the registration window once the plugin's start-up hooks have finished.
     *
     * The plugin-facing documentation promises that registering a job outside
     * `enable()` or `init()` throws. Teardown alone does not deliver
     * that: it closes the facade on disable, which leaves an enabled plugin free to
     * register a job from a request handler. Such a job is tracked and would be torn
     * down, but it is created outside the window the platform reasons about, so it
     * fails loudly instead. Mirrors `loaded.hooks.seal()`, which the plugin manager
     * calls at the same point for the hook facade.
     */
    public seal(): void {
        this.open = false;
    }

    /**
     * Reject registrations attempted after the plugin's lifecycle window closed.
     *
     * A job registered after disable would be untracked and therefore never torn
     * down — exactly the leak this facade exists to prevent — so it fails loudly
     * instead of silently escaping teardown.
     *
     * @param operation - Human-readable call description used in the error message.
     */
    private assertOpen(operation: string): void {
        if (!this.open) {
            throw new Error(
                `Plugin '${this.pluginId}' attempted ${operation} after its lifecycle window closed. ` +
                `Scheduler registration is permitted only during enable/init — register jobs at ` +
                `startup, not from request handlers or other scheduled jobs.`
            );
        }
    }
}
