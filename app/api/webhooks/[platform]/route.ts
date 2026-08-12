import { waitUntil } from '@vercel/functions';
import { bot } from '@/lib/bot';

type Platform = keyof typeof bot.webhooks;

export async function POST(
  request: Request,
  context: RouteContext<'/api/webhooks/[platform]'>
) {
  const { platform } = await context.params;
  const handler = bot.webhooks[platform as Platform];
  if (!handler) {
    return new Response(`Unknown platform: ${platform}`, { status: 404 });
  }
  return handler(request, { waitUntil });
}

// Serves as health check, but also forwards to webhook handler
// for platforms that need GET verification (e.g. WhatsApp/Facebook challenge-response)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ platform: string }> }
): Promise<Response> {
  const { platform } = await params;

  const webhookHandler = bot.webhooks[platform as Platform];
  if (!webhookHandler) {
    return new Response(`${platform} adapter not configured`, { status: 404 });
  }

  // If the request has verification query params, forward to the adapter
  const url = new URL(request.url);
  if (
    url.searchParams.has('hub.mode') ||
    url.searchParams.has('hub.verify_token')
  ) {
    return webhookHandler(request);
  }

  return new Response(`${platform} webhook endpoint is active`, {
    status: 200,
  });
}
