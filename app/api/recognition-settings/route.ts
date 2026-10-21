import {recognitionSettings} from '../../../lib/recognition-settings-service';
import {DrawingVisionError} from '../../../lib/drawing-vision';
import {selectionOwner,selectionHeaders as headers,selectionInput,selectionFailure} from '../../../lib/material-selection-http';
export async function GET(r:Request){try{return Response.json({result:recognitionSettings.view(selectionOwner(r))},{headers});}catch(e){return selectionFailure(e);}}
export async function POST(r:Request){try{const owner=selectionOwner(r),args=await selectionInput(r,4000);return Response.json({result:recognitionSettings.save(owner,args)},{headers});}catch(e){if(e instanceof DrawingVisionError)return Response.json({error:e.message},{status:e.status,headers});return selectionFailure(e);}}
