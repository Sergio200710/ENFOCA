import { createLocalDatabase, ConflictError, OperationError } from "./storage.js";
import { OverlapError, schedulesOverlap, overlapSignature, sameWallSchedule } from "./agenda.js";

export function createActivityRepository(factory) {
  const database = createLocalDatabase(factory);
  function write(id, expectedVersion, transform, consent = "") {
    // La lectura de solapamientos y la escritura comparten transacción: dos
    // pestañas no pueden aceptar simultáneamente un horario que parecía libre.
    return database.transact(["activities", "goals"], "readwrite", (store, done, fail, transaction) => {
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          const current = request.result;
          if ((current?.version ?? 0) !== expectedVersion) throw new ConflictError("Esta actividad cambió en otra pestaña. Vuelve a cargar la agenda antes de guardar.");
          const next = transform(current);
          const save = () => {
            const changedSchedule = !current || !sameWallSchedule(current.schedule, { date: next.schedule.date, startTime: next.schedule.startTime, endTime: next.schedule.endTime });
            if (!next.deletedAt && changedSchedule) {
              // Compara instantes también si se planificó en otra zona horaria.
              const overlaps = store.getAll();
              overlaps.onsuccess = () => {
                try {
                  const conflicts = overlaps.result.filter((item) => schedulesOverlap(item, next));
                  if (conflicts.length && overlapSignature(conflicts) !== consent) throw new OverlapError(conflicts);
                  store.put(next); done(next);
                } catch (error) { fail(error); }
              };
            } else { store.put(next); done(next); }
          };
          if (next.goalId && next.goalId !== current?.goalId) {
            const linked = transaction.objectStore("goals").get(next.goalId);
            linked.onsuccess = () => {
              try {
                if (!linked.result || linked.result.deletedAt || linked.result.archivedAt) throw new OperationError("El objetivo seleccionado ya no está disponible. Elige otro o deja la actividad sin vínculo.");
                save();
              } catch (error) { fail(error); }
            };
          } else save();
        } catch (error) { fail(error); }
      };
    });
  }
  return {
    list(date) {
      return database.transact("activities", "readonly", (store, done) => {
        const request = store.index("date").getAll(date);
        request.onsuccess = () => done(request.result);
      });
    },
    create(activity, consent) { return write(activity.id, 0, () => activity, consent); },
    update(id, version, transform, consent) { return write(id, version, transform, consent); },
    close() { database.close(); },
  };
}
