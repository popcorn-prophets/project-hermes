import type { BotThread } from '@/lib/bot/types';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

function isTransientNetworkError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'NETWORK_ERROR'
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Post a message to a thread, retrying with backoff on transient network
 * errors (e.g. connection timeouts) from the underlying chat platform API.
 */
export async function postWithRetry(
  thread: BotThread,
  content: Parameters<BotThread['post']>[0]
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await thread.post(content);
    } catch (error) {
      if (!isTransientNetworkError(error) || attempt === MAX_RETRIES) {
        throw error;
      }
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }
}
