/**
 * Atlas Telegram Bot - Attachment Handler
 *
 * Handles file/image/voice attachments from Telegram messages.
 */

import type { Context } from 'grammy';

export type AttachmentType =
  | 'photo'
  | 'document'
  | 'voice'
  | 'video'
  | 'video_note'
  | 'audio'
  | 'sticker'
  | 'none';

export interface AttachmentInfo {
  type: AttachmentType;
  fileId?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  caption?: string;
  duration?: number; // For audio/video
  width?: number;    // For photo/video
  height?: number;   // For photo/video
}

/**
 * Detect attachment from Telegram message
 */
export function detectAttachment(ctx: Context): AttachmentInfo {
  const message = ctx.message;
  if (!message) {
    return { type: 'none' };
  }

  // Check for photo (array of sizes, get largest)
  if (message.photo && message.photo.length > 0) {
    const photo = message.photo[message.photo.length - 1];
    return {
      type: 'photo',
      fileId: photo.file_id,
      fileSize: photo.file_size,
      width: photo.width,
      height: photo.height,
      caption: message.caption,
    };
  }

  // Check for document
  if (message.document) {
    return {
      type: 'document',
      fileId: message.document.file_id,
      fileName: message.document.file_name,
      mimeType: message.document.mime_type,
      fileSize: message.document.file_size,
      caption: message.caption,
    };
  }

  // Check for voice message
  if (message.voice) {
    return {
      type: 'voice',
      fileId: message.voice.file_id,
      mimeType: message.voice.mime_type,
      fileSize: message.voice.file_size,
      duration: message.voice.duration,
    };
  }

  // Check for video
  if (message.video) {
    return {
      type: 'video',
      fileId: message.video.file_id,
      fileName: message.video.file_name,
      mimeType: message.video.mime_type,
      fileSize: message.video.file_size,
      duration: message.video.duration,
      width: message.video.width,
      height: message.video.height,
      caption: message.caption,
    };
  }

  // Check for video note (circular video)
  if (message.video_note) {
    return {
      type: 'video_note',
      fileId: message.video_note.file_id,
      fileSize: message.video_note.file_size,
      duration: message.video_note.duration,
    };
  }

  // Check for audio
  if (message.audio) {
    return {
      type: 'audio',
      fileId: message.audio.file_id,
      fileName: message.audio.file_name,
      mimeType: message.audio.mime_type,
      fileSize: message.audio.file_size,
      duration: message.audio.duration,
    };
  }

  // Check for sticker
  if (message.sticker) {
    return {
      type: 'sticker',
      fileId: message.sticker.file_id,
      fileSize: message.sticker.file_size,
    };
  }

  return { type: 'none' };
}

/**
 * Format attachment info for display
 */
export function formatAttachmentInfo(attachment: AttachmentInfo): string {
  if (attachment.type === 'none') {
    return '';
  }

  const parts: string[] = [];

  switch (attachment.type) {
    case 'photo':
      parts.push(`Photo (${attachment.width}x${attachment.height})`);
      break;
    case 'video':
      parts.push(`Video (${formatDuration(attachment.duration || 0)})`);
      if (attachment.fileSize) {
        parts.push(formatFileSize(attachment.fileSize));
      }
      break;
    case 'voice':
      parts.push(`Voice message (${formatDuration(attachment.duration || 0)})`);
      break;
    case 'document':
      parts.push(`Document: ${attachment.fileName || 'unknown'}`);
      if (attachment.fileSize) {
        parts.push(formatFileSize(attachment.fileSize));
      }
      break;
    case 'audio':
      parts.push(`Audio (${formatDuration(attachment.duration || 0)})`);
      break;
    case 'video_note':
      parts.push(`Video note (${formatDuration(attachment.duration || 0)})`);
      break;
    case 'sticker':
      parts.push('Sticker');
      break;
  }

  if (attachment.caption) {
    parts.push(`Caption: "${attachment.caption}"`);
  }

  return parts.join(' | ');
}

/**
 * Build a prompt describing the attachment for Claude
 */
export function buildAttachmentPrompt(attachment: AttachmentInfo): string {
  if (attachment.type === 'none') {
    return '';
  }

  let prompt = `\n\n[Attachment: ${attachment.type.toUpperCase()}]\n`;

  switch (attachment.type) {
    case 'photo':
      prompt += `Image attached (${attachment.width}x${attachment.height}).`;
      break;
    case 'video':
      prompt += `Video attached (${formatDuration(attachment.duration || 0)}, ${formatFileSize(attachment.fileSize || 0)}).`;
      break;
    case 'voice':
      prompt += `Voice message attached (${formatDuration(attachment.duration || 0)}). User may want transcription.`;
      break;
    case 'document':
      prompt += `Document attached: ${attachment.fileName || 'unknown'} (${formatFileSize(attachment.fileSize || 0)}).`;
      if (attachment.mimeType) {
        prompt += ` Type: ${attachment.mimeType}`;
      }
      break;
    case 'audio':
      prompt += `Audio file attached (${formatDuration(attachment.duration || 0)}).`;
      break;
    case 'video_note':
      prompt += `Video note (circular video) attached (${formatDuration(attachment.duration || 0)}).`;
      break;
    case 'sticker':
      prompt += `Sticker attached. User may be expressing emotion or reacting.`;
      break;
  }

  if (attachment.caption) {
    prompt += `\nCaption: "${attachment.caption}"`;
  }

  prompt += `\n\nAsk what the user wants to do with this attachment, or process it if the intent is clear.`;

  return prompt;
}

/**
 * Format duration in seconds to readable string
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * Format file size to readable string
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
