import { currentUser } from "@/lib/auth";
import { eventBus } from "@/lib/events";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    await currentUser();
    const bus = await eventBus();
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream({
      start(controller) {
        const send = () =>
          controller.enqueue(encoder.encode("event: change\ndata: {}\n\n"));
        const heartbeat = setInterval(
          () => controller.enqueue(encoder.encode(": heartbeat\n\n")),
          20000,
        );
        const end = setTimeout(() => {
          cleanup();
          controller.close();
        }, 240000);
        cleanup = () => {
          bus.off("change", send);
          clearInterval(heartbeat);
          clearTimeout(end);
        };
        bus.on("change", send);
        req.signal.addEventListener(
          "abort",
          () => {
            cleanup();
            try {
              controller.close();
            } catch {}
          },
          { once: true },
        );
        controller.enqueue(encoder.encode("retry: 5000\n\n"));
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return new Response(null, { status: 401 });
  }
}
