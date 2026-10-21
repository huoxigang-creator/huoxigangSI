import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {rawDatabase,dataDirectory} from './local-env';
import {createRecognitionSettings} from './recognition-settings';
export const recognitionSettings=createRecognitionSettings(rawDatabase,()=>readFileSync(join(dataDirectory,'session-secret')),process.env);
