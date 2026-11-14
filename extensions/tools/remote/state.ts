import { createGlobalStore } from "../../../shared/store.ts";
import { generatePassword } from "./config.ts";
import { RemoteService } from "./remote-service.ts";

interface RemoteState {

	readonly service: RemoteService;

	readonly fallbackPassword: string;
}

const store = createGlobalStore<RemoteState | undefined>(Symbol.for("@couralabs/pi-adhd/remote"), undefined);

export function remoteState(): RemoteState {
	let state = store.get();
	if (!state) {
		state = { service: new RemoteService(), fallbackPassword: generatePassword() };
		store.set(state);
	}
	return state;
}
