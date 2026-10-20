import {env} from '../../../lib/local-env';
import {getDeletedFileKeys} from '../../../lib/trash';
import {execute} from '../../../lib/service';
import {createPaymentVoucherHandlers} from './handlers';

const handlers = createPaymentVoucherHandlers({
  bucket: () => env.BUCKET,
  authorize: (owner, project) => execute(owner, 'get_project', {id: project}),
  deletedKeys: (owner,project,transaction)=>getDeletedFileKeys(owner,project,'payment',transaction),
});
export const GET = handlers.GET;
export const POST = handlers.POST;
