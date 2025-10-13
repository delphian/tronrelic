import { Schema, model, type Document } from 'mongoose';

export type ModerationTargetType = 'comment' | 'chat' | 'wallet';
export type ModerationAction =
  | 'mute'
  | 'unmute'
  | 'delete'
  | 'restore'
  | 'flag-spam'
  | 'unflag-spam'
  | 'ignore-add'
  | 'ignore-remove';

export interface ModerationEventDoc extends Document {
  eventId: string;
  action: ModerationAction;
  targetType: ModerationTargetType;
  targetId: string;
  performedBy: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const ModerationEventSchema = new Schema<ModerationEventDoc>({
  eventId: { type: String, required: true, unique: true },
  action: { type: String, required: true },
  targetType: { type: String, required: true },
  targetId: { type: String, required: true, index: true },
  performedBy: { type: String, required: true },
  metadata: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

ModerationEventSchema.index({ createdAt: -1 });

export const ModerationEventModel = model<ModerationEventDoc>('ModerationEvent', ModerationEventSchema);
