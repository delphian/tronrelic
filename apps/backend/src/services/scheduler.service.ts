import cron, { ScheduledTask } from 'node-cron';
import { logger } from '../lib/logger.js';

export type CronJobHandler = () => Promise<void> | void;

interface RegisteredJob {
  name: string;
  schedule: string;
  handler: CronJobHandler;
  task?: ScheduledTask;
}

export class SchedulerService {
  private readonly jobs = new Map<string, RegisteredJob>();

  register(name: string, schedule: string, handler: CronJobHandler) {
    if (this.jobs.has(name)) {
      throw new Error(`Job ${name} already registered`);
    }
    this.jobs.set(name, { name, schedule, handler });
  }

  start() {
    this.jobs.forEach(job => {
      const task = cron.schedule(job.schedule, async () => {
        const started = Date.now();
        logger.debug({ job: job.name }, 'Scheduler job started');
        try {
          await job.handler();
          logger.debug({ job: job.name, durationMs: Date.now() - started }, 'Scheduler job finished');
        } catch (error) {
          logger.error({ job: job.name, error }, 'Scheduler job failed');
        }
      });
      job.task = task;
    });
  }

  stop() {
    this.jobs.forEach(job => job.task?.stop());
  }
}
