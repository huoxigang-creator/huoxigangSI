import {rawDatabase} from './local-env';
import {paymentCodeService} from './payment-codes';
import {execute} from './service';
import {createCustomerPayments} from './customer-payments';
export const customerPaymentService=createCustomerPayments(rawDatabase,paymentCodeService,execute);
