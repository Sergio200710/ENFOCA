const DB_NAME = "enfoca";
const DB_VERSION = 2;
const STORE = "goals";

export class StorageError extends Error {
  constructor(message, options) { super(message, options); this.name = "StorageError"; }
}
export class ConflictError extends Error {
  constructor(message = "Este objetivo cambió en otra pestaña. Vuelve a cargar y revisa su estado antes de intentarlo otra vez.") {
    super(message);
    this.name = "ConflictError";
  }
}
function storageError(error) {
  if (error instanceof StorageError || error instanceof ConflictError) return error;
  return new StorageError(error?.name === "QuotaExceededError"
    ? "No hay espacio disponible para guardar. Libera espacio en el dispositivo e inténtalo de nuevo."
    : "No se pudo acceder al almacenamiento local. Comprueba los permisos del navegador y vuelve a intentarlo.", { cause: error });
}

export function createLocalDatabase(factory) {
  let connection;
  let opening;
  function open() {
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      try { if (factory === undefined) factory = globalThis.indexedDB; }
      catch (error) { reject(storageError(error)); return; }
      if (!factory) { reject(new StorageError("Este navegador no permite usar IndexedDB. Abre ENFOCA en un navegador compatible para guardar objetivos.")); return; }
      let request;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(storageError(error));
      };
      const timeout = setTimeout(() => fail(new StorageError("El almacenamiento no responde. Cierra otras pestañas de ENFOCA y vuelve a cargar.")), 10_000);
      try { request = factory.open(DB_NAME, DB_VERSION); } catch (error) { fail(error); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        // Migración aditiva v1 → v2: no modifica ni reconstruye goals.
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("date", "date", { unique: false });
        }
        if (!db.objectStoreNames.contains("profiles")) db.createObjectStore("profiles", { keyPath: "id" });
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new StorageError("Otra pestaña impide abrir el almacenamiento. Ciérrala y vuelve a cargar."));
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        settled = true;
        clearTimeout(timeout);
        connection = db;
        db.onversionchange = () => { db.close(); connection = undefined; };
        db.onclose = () => { if (connection === db) connection = undefined; };
        resolve(db);
      };
    }).finally(() => { opening = undefined; });
    return opening;
  }

  // Solo complete confirma el guardado: success de una petición no basta.
  async function transact(storeName, mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let transaction;
      let result;
      let failure;
      try {
        transaction = db.transaction(storeName, mode);
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(storageError(failure || transaction.error));
        transaction.onerror = () => {};
        work(transaction.objectStore(storeName), (value) => { result = value; }, (error) => { failure = error; transaction.abort(); });
      } catch (error) {
        if (transaction) {
          failure = error;
          try { transaction.abort(); } catch { reject(storageError(error)); }
        } else { connection = undefined; reject(storageError(error)); }
      }
    });
  }
  return { transact, close() { connection?.close(); connection = undefined; } };
}

export function createGoalRepository(factory) {
  const database = createLocalDatabase(factory);
  const transact = (mode, work) => database.transact(STORE, mode, work);
  function mutate(id, expectedVersion, transform) {
    return transact("readwrite", (store, done, fail) => {
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          const current = request.result;
          if (!current || current.version !== expectedVersion) throw new ConflictError();
          const next = transform(current);
          if (next === null) store.delete(id);
          else store.put(next);
          done(next);
        } catch (error) { fail(error); }
      };
    });
  }
  return {
    list(date) {
      return transact("readonly", (store, done) => {
        const request = store.index("date").getAll(date);
        request.onsuccess = () => done(request.result);
      });
    },
    add(goal) { return transact("readwrite", (store, done) => { store.add(goal); done(goal); }); },
    update(id, version, transform) { return mutate(id, version, transform); },
    remove(id, version) { return mutate(id, version, () => null); },
    close() { database.close(); },
  };
}
