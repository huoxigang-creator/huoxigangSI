import {rawDatabase} from './local-env';
import {createMaterialSelections} from './material-selections';
export const materialSelectionService=createMaterialSelections(rawDatabase);
