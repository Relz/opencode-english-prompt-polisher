export type PendingWorkRegistration = {
	track: (task: Promise<void>) => void;
};

export type PendingWorkTracker = PendingWorkRegistration & {
	drain: () => Promise<void>;
};

const DRAIN_TIMEOUT_MS: number = 2000;

export function createPendingWorkTracker(): PendingWorkTracker {
	const pending: Set<Promise<void>> = new Set();
	let drainTask: Promise<void> | undefined;

	function track(task: Promise<void>): void {
		const settled = (): void => {
			pending.delete(completion);
		};
		// Observe both outcomes even when work outlives the bounded drain.
		const completion: Promise<void> = task.then(settled, settled);
		pending.add(completion);
	}

	async function settlePending(): Promise<void> {
		// Checks can register detached removals while the initial batch is settling.
		while (pending.size > 0) {
			await Promise.allSettled(pending);
		}
	}

	async function drainPending(): Promise<void> {
		if (pending.size === 0) {
			return;
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				settlePending(),
				new Promise<void>((resolve): void => {
					timer = setTimeout(resolve, DRAIN_TIMEOUT_MS);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
	}

	return {
		track,
		drain: (): Promise<void> => {
			drainTask ??= drainPending();
			return drainTask;
		},
	};
}
