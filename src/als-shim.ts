import { AsyncLocalStorage } from "node:async_hooks";

// workerd's node:async_hooks polyfill implements run()/getStore() but not
// enterWith() ("asyncLocalStorage.enterWith() is not implemented"). Stagehand
// v3's FlowLogger calls enterWith() unconditionally in its constructor path,
// so importing this module (for its side effect, before importing Stagehand)
// patches it in with a best-effort implementation: a plain instance-scoped
// value swap rather than true async-context propagation. Good enough for
// FlowLogger, which just needs getStore() to return whatever the last
// enterWith() call set within the same request.
const proto = AsyncLocalStorage.prototype as unknown as {
	enterWith: (store: unknown) => void;
	getStore: () => unknown;
};

// `typeof proto.enterWith === "function"` is true even on the broken
// runtime -- it exists as a stub that throws when called. Probe by
// actually calling it instead of checking existence.
let enterWithBroken = false;
try {
	new AsyncLocalStorage().enterWith(undefined);
} catch {
	enterWithBroken = true;
}

if (enterWithBroken) {
	const stores = new WeakMap<object, unknown>();
	const originalGetStore = proto.getStore;

	proto.enterWith = function (this: object, store: unknown) {
		stores.set(this, store);
	};

	proto.getStore = function (this: object) {
		return stores.has(this) ? stores.get(this) : originalGetStore.call(this);
	};
}
