import { createLocalDatabase, ConflictError } from "./storage.js";

// Un solo perfil local, sin cuenta ni identidad personal duplicada.
export function createProfileRepository(factory) {
  const database = createLocalDatabase(factory);
  return {
    load() {
      return database.transact("profiles", "readonly", (store, done) => {
        const request = store.get("local");
        request.onsuccess = () => done(request.result ?? null);
      });
    },
    save(profile, expectedVersion) {
      return database.transact("profiles", "readwrite", (store, done, fail) => {
        const request = store.get("local");
        request.onsuccess = () => {
          try {
            if ((request.result?.version ?? 0) !== expectedVersion) {
              fail(new ConflictError("Las preferencias cambiaron en otra pestaña. Vuelve a abrir Preferencias antes de guardar."));
              return;
            }
            store.put(profile);
            done(profile);
          } catch (error) { fail(error); }
        };
      });
    },
    close() { database.close(); },
  };
}
