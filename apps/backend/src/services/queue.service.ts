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

export class QueueService<T = unknown> {
  public readonly queue: Queue<unknown, unknown, string>;
  private worker?: Worker<unknown, unknown, string>;

  constructor(
    name: string,
    processor?: Processor<T, unknown, string>,
    queueOptions?: Partial<QueueOptions>,
    workerOptions?: Partial<WorkerOptions>
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

  private logJob(job: Job<unknown, unknown, string> | undefined, status: 'completed' | 'failed', error?: Error) {
    if (!job) {
      return;
    }
    const base = { queue: this.queue.name, id: job.id, name: job.name };
    if (status === 'completed') {
      logger.debug(base, 'Queue job completed');
    } else {
      logger.error({ ...base, error }, 'Queue job failed');
    }
  }
}
