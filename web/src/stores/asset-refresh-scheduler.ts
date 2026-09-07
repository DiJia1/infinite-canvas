type Waiter = { generation: number; resolve: () => void; reject: (error: unknown) => void };

// Transient coordination only: catalog data remains in the existing asset store.
export function createAssetRefreshScheduler<T>(options: { load: () => Promise<T>; commit: (value: T, isCurrent: () => boolean) => Promise<void>; schedule?: (callback: () => void) => () => void }) {
    const schedule =
        options.schedule ??
        ((callback) => {
            const timer = setTimeout(callback, 100);
            return () => clearTimeout(timer);
        });
    const newSession = () => ({ generation: 0, running: false, ready: true, cancelTimer: undefined as (() => void) | undefined, waiters: [] as Waiter[] });
    let session = newSession();
    type Session = ReturnType<typeof newSession>;

    function settle(current: Session, generation: number, failure?: { error: unknown }) {
        const covered = current.waiters.filter((waiter) => waiter.generation <= generation);
        current.waiters = current.waiters.filter((waiter) => waiter.generation > generation);
        covered.forEach((waiter) => (failure ? waiter.reject(failure.error) : waiter.resolve()));
    }
    function enqueue(current: Session) {
        if (current !== session || !current.ready || current.running || current.cancelTimer || !current.waiters.length) return;
        current.cancelTimer = schedule(() => {
            current.cancelTimer = undefined;
            void run(current);
        });
    }
    async function run(current: Session) {
        if (current !== session || !current.ready) return;
        current.running = true;
        const generation = current.generation;
        const isCurrent = () => current === session && generation === current.generation;
        try {
            const value = await options.load();
            // A notification arriving during this round requires a fresh snapshot.
            if (isCurrent()) {
                await options.commit(value, isCurrent);
                settle(current, generation);
            }
        } catch (error) {
            settle(current, generation, { error });
        } finally {
            current.running = false;
            enqueue(current);
        }
    }
    return {
        refresh: () => {
            const current = session;
            const generation = ++current.generation;
            const promise = new Promise<void>((resolve, reject) => current.waiters.push({ generation, resolve, reject }));
            enqueue(current);
            return promise;
        },
        reset: () => {
            const previous = session;
            session = newSession();
            session.ready = false;
            previous.cancelTimer?.();
            settle(previous, Infinity, { error: Object.assign(new Error("素材用户作用域已切换"), { name: "AbortError" }) });
            const current = session;
            return {
                isCurrent: () => current === session,
                resume: () => {
                    current.ready = true;
                    enqueue(current);
                },
            };
        },
    };
}
