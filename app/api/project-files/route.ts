import {env} from '../../../lib/local-env';
import {getDeletedFileKeys} from '../../../lib/trash';
import {execute} from '../../../lib/service';
import {createProjectFileHandlers} from './handlers';

const handlers = createProjectFileHandlers({
  bucket: () => env.BUCKET,
  authorize: (owner, project) => execute(owner, 'get_project', {id: project}),
  deletedKeys: (owner,project)=>getDeletedFileKeys(owner,project,'project'),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
