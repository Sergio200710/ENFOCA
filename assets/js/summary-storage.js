import { createLocalDatabase } from "./storage.js";
import { dailySummary } from "./summary.js";
import { validateDay } from "./agenda.js";

export function createSummaryRepository(factory) {
  const database = createLocalDatabase(factory);
  return {
    snapshot(date, { claim = false, now = () => new Date() } = {}) {
      validateDay(date);
      // Serializa la comprobación del día y el marcador entre pestañas.
      // Se devuelve solo después de complete: un aborto no anuncia felicitación.
      return database.transact(claim ? ["activities", "dailyMessages"] : "activities", claim ? "readwrite" : "readonly", (store, done, fail, transaction) => {
        const request = store.getAll();
        request.onsuccess = () => {
          try {
            const activities = request.result;
            const result = { activities, claimed: false };
            if (!claim || !dailySummary(activities, date).allComplete) { done(result); return; }
            const messages = transaction.objectStore("dailyMessages");
            const existing = messages.get(date);
            existing.onsuccess = () => {
              try {
                if (!existing.result) {
                  messages.add({ date, claimedAt: now().toISOString(), schemaVersion: 1 });
                  result.claimed = true;
                }
                done(result);
              } catch (error) { fail(error); }
            };
          } catch (error) { fail(error); }
        };
      });
    },
    close() { database.close(); },
  };
}
