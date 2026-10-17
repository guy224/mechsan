import { EventEmitter } from "node:events";
import { database } from "./db";
const globalEvents = globalThis as unknown as {
  machsanEvents?: { bus: EventEmitter; connecting: boolean; ready: boolean };
};
const state = (globalEvents.machsanEvents ??= {
  bus: new EventEmitter(),
  connecting: false,
  ready: false,
});
state.bus.setMaxListeners(500);
export async function eventBus() {
  if (!state.ready && !state.connecting) {
    state.connecting = true;
    try {
      const client = await database().connect();
      client.on("notification", () => state.bus.emit("change"));
      client.on("error", () => {
        state.ready = false;
        client.release(true);
      });
      try {
        await client.query("LISTEN machsan_changed");
      } catch (error) {
        client.release(true);
        throw error;
      }
      state.ready = true;
    } finally {
      state.connecting = false;
    }
  }
  return state.bus;
}
