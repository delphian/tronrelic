import {
  Queue,
  Worker,
  type QueueOptions,
  type WorkerOptions,
  type Processor,
  type Job,
  type JobsOptions
} from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { URL } from 'node:url';

type ConnectionOptions = NonNullable<QueueOptions['connection']>;

function buildQueueConnection(): ConnectionOptions {
  const redisUrl = env.REDIS_URL;
  const parsed = new URL(redisUrl);

  if (parsed.protocol === 'unix:' || parsed.protocol === 'socket:') {
    return { path: parsed.pathname };
  }

  const useTls = parsed.protocol === 'rediss:';
  const connection: ConnectionOptions = {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : useTls ? 6380 : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parsed.pathname && parsed.pathname !== '/' ? Number(parsed.pathname.slice(1)) : undefined
  };

  if (useTls) {
    connection.tls = {};
  }

  return connection;
}

/**
 * The levels a failed job may be logged at. A queue whose failures mean lost
 * work, such as a block that was never indexed, needs `fatal` so an operator
 * filtering for the most severe entries sees it.
 */
export type QueueFailureLogLevel = 'error' | 'fatal';

export class QueueService<T = unknown> {
  public readonly queue: Queue<unknown, unknown, string>;
  private worker?: Worker<unknown, unknown, string>;

  /**
   * Create a BullMQ queue and, when a processor is given, a worker for it.
   *
   * @param name - Queue name; colons and spaces are replaced with hyphens.
   * @param processor - Job handler. Without one, the instance only enqueues.
   * @param queueOptions - Overrides for the BullMQ queue, such as job retention.
   * @param workerOptions - Overrides for the BullMQ worker, such as lock duration.
   * @param failureLogLevel - How severely a failed job is logged. Each queue
   *                          chooses, because the cost of a failure differs:
   *                          a failed block-sync job is a missing block, while
   *                          a failed AI hook prompt is not.
   */
  constructor(
    name: string,
    processor?: Processor<T, unknown, string>,
    queueOptions?: Partial<QueueOptions>,
    workerOptions?: Partial<WorkerOptions>,
    private readonly failureLogLevel: QueueFailureLogLevel = 'error'
  ) {
    const queuePrefix = env.REDIS_NAMESPACE ?? 'tronrelic';
    const queueName = name.replace(/[:\s]+/g, '-');
    const connection = buildQueueConnection();

    this.queue = new Queue<unknown, unknown, string>(queueName, {
      connection,
      prefix: queuePrefix,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 500
      },
      ...queueOptions
    });

    if (processor) {
      this.worker = new Worker<unknown, unknown, string>(queueName, processor as Processor<unknown, unknown, string>, {
        connection,
        prefix: queuePrefix,
        ...workerOptions
      });

      this.worker.on('completed', job => this.logJob(job, 'completed'));
      this.worker.on('failed', (job, error) => this.logJob(job, 'failed', error ?? undefined));
    }
  }

  enqueue(name: string, data: T, options?: JobsOptions) {
    return this.queue.add(name, data as unknown, options);
  }

  /**
   * Record a finished job in the system log, so job outcomes are visible on
   * `/system/logs` without querying Redis.
   *
   * Completions are logged at debug to keep them out of the stored log.
   * Failures are logged at the queue's `failureLogLevel`.
   *
   * @param job - The job BullMQ reported; undefined when BullMQ has lost it.
   * @param status - Whether the job completed or failed.
   * @param error - The error a failed job threw.
   */
  private logJob(job: Job<unknown, unknown, string> | undefined, status: 'completed' | 'failed', error?: Error) {
    if (!job) {
      return;
    }
    const base = { queue: this.queue.name, id: job.id, name: job.name };
    if (status === 'completed') {
      logger.debug(base, 'Queue job completed');
    } else {
      logger[this.failureLogLevel]({ ...base, error }, 'Queue job failed');
    }
  }
}
