import type { IMenuNode } from './IMenuNode.js';

/**
 * Validation context object passed through event handlers.
 *
 * Event subscribers can modify this object to halt processing or provide
 * feedback. If `continue` is set to false, no further subscribers will be
 * invoked for the event, allowing early termination on validation failure.
 */
export interface IMenuValidation {
    /**
     * Whether to continue invoking subsequent event subscribers.
     * Set to false to halt event propagation after this handler.
     * @default true
     */
    continue: boolean;

    /**
     * Optional error message explaining why validation failed.
     * Returned to the caller if continue is false.
     */
    error?: string;

    /**
     * Optional warnings that don't prevent the operation but should be logged.
     * Useful for deprecation notices or non-critical validation issues.
     */
    warnings?: string[];

    /**
     * Optional custom metadata that subscribers can attach.
     * Allows communication between different event handlers.
     */
    metadata?: Record<string, any>;
}

/**
 * Event types emitted by the menu service.
 *
 * Pre-events (before:*) allow subscribers to validate or modify operations
 * before they occur. Post-events (after:*) notify subscribers of completed
 * changes for logging, WebSocket broadcasting, or cascading updates.
 */
export type MenuEventType =
    | 'before:create'
    | 'after:create'
    | 'before:update'
    | 'after:update'
    | 'before:delete'
    | 'after:delete'
    | 'before:reorder'
    | 'after:reorder'
    | 'before:move'
    | 'after:move';

/**
 * Event payload passed to event subscribers.
 *
 * Contains the node being operated on, validation context, and event-specific
 * metadata. Subscribers can inspect the node, modify validation, and access
 * additional context to make decisions.
 */
export interface IMenuEvent {
    /**
     * The type of event being emitted.
     */
    type: MenuEventType;

    /**
     * The menu node being created, updated, or deleted.
     * For before:delete events, this is the node that will be removed.
     * For after:create events, this is the newly created node with assigned ID.
     */
    node: IMenuNode;

    /**
     * Validation object that subscribers can modify.
     * Only applicable for before:* events. After:* events have continue always true.
     */
    validation: IMenuValidation;

    /**
     * Optional previous state of the node for update/move operations.
     * Allows subscribers to compare old vs new values.
     */
    previousNode?: IMenuNode;

    /**
     * Timestamp when the event was emitted.
     */
    timestamp: Date;
}

/**
 * Event subscriber callback function signature.
 *
 * Subscribers receive the event payload and can modify the validation object
 * to halt processing or provide feedback. Async subscribers are awaited before
 * proceeding to the next subscriber or completing the operation.
 *
 * @param event - The menu event with node data and validation context
 * @returns Promise that resolves when the subscriber finishes processing
 */
export type MenuEventSubscriber = (event: IMenuEvent) => Promise<void> | void;
