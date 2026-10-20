export type ContractTemplate = {id:string; revision?:string; name:string; body:string; company_keyword:string; customer_keyword:string; note:string; created?:string; builtin?:boolean};
export type SigningProfile = {org_id:string;seal_id:string;company_name:string;transactor_name?:string;transactor_phone?:string;transactor_id?:string};
export type SigningConfig = {configured:boolean;missing:string[];environment:'sandbox'|'production';profile:SigningProfile;official_url:string;face_required:true};
export type ContractInstallment = {id:string;name:string;ratio:number;amount:number;due_date:string;received?:number;remaining?:number};
export type ReceiptAllocation = {transaction_id:string;installment_id:string;amount:number};
export type ContractStatus = 'draft'|'offline_signed'|'preparing'|'signing'|'signed'|'failed'|'cancelled'|'expired'|'rejected'|'uncertain';
export type ContractRecord = {
 id:string;revision:string;project:string;created:string;updated:string;title:string;contract_type:string;employee:string;sign_date:string;number:string;paper_number:string;
 quote_id:string;quote_snapshot:any|null;gross_amount:number;discount_amount:number;rounding_amount:number;net_amount:number;
 company_name:string;company_address:string;company_phone:string;customer_name:string;customer_phone:string;customer_address:string;party_type:'person'|'organization';customer_company:string;
 customer_identity_type?:'CRED_PSN_CH_IDCARD';customer_identity_number?:string;
 template_id:string;template_snapshot:ContractTemplate;special_terms:string;note:string;installments:ContractInstallment[];receipt_allocations:ReceiptAllocation[];
 status:ContractStatus;confirmed_at?:string;signature?:{request_id:string;flow_id?:string;file_id?:string;environment:'sandbox'|'production';started_at:string;last_checked?:string;finished_at?:string;error?:string;profile?:SigningProfile};
 allocated_received?:number;unallocated_received?:number;
};
