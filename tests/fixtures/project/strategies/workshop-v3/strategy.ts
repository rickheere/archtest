import { ENTRY_1, ENTRY_2, PENDING_ENTRY } from './states';

export class Strategy {
  execute() {
    // strategy internals are fine here
    return ENTRY_1;
  }
}
