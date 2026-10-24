import {rawDatabase} from './local-env';
import {createAccountRecovery} from './account-recovery';
export const accountRecovery=createAccountRecovery(rawDatabase);
