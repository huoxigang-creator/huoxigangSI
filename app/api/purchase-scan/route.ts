import {recognitionSettings} from '../../../lib/recognition-settings-service';
import {recognizePurchaseItems,DrawingVisionError} from '../../../lib/drawing-vision';
import {selectionInput,selectionHeaders,selectionFailure,selectionOwner} from '../../../lib/material-selection-http';
let active=0;
export async function POST(r:Request){try{const owner=selectionOwner(r);if(active>=3)throw new DrawingVisionError('正在处理其他扫描，请稍后重试',429);const {image,source}=await selectionInput(r,2900000);active++;try{const items=await recognizePurchaseItems(image,source,recognitionSettings.resolve(owner,'doubao'),r.signal);return Response.json({result:items},{headers:selectionHeaders});}finally{active--;}}catch(e){if(e instanceof DrawingVisionError)return Response.json({error:e.message},{status:e.status,headers:selectionHeaders});return selectionFailure(e);}}
