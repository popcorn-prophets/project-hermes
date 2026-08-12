import { createPostgresState } from '@chat-adapter/state-pg';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { createMessengerAdapter } from '@chat-adapter/messenger';
import { createWebChatAdapter } from './adapters/web-chat';

const telegram = createTelegramAdapter({
  mode: 'webhook',
});

const messenger = createMessengerAdapter();

const webchat = createWebChatAdapter();

export const adapters = { telegram, messenger, webchat };

export const state = createPostgresState();
