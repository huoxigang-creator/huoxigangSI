// Keep the existing owner-only management audience when customer quote pages are opened.
// This Site-scoped identity is not a credential. It comes from the authenticated workspace.
export const MANAGEMENT_OWNER_ID = 'ompip4rR6NGJU749JpvhG1rI9uduEdGw8IEH099saYIO6vcz6biK6d';
export function canManageSite(userId:string|null,development=false){return !!userId&&(development||userId===MANAGEMENT_OWNER_ID);}
export function customerRoute(pathname:string,method:string){
 if(method==='GET'&&/^\/s\/q\/[a-f0-9]{64}\/?$/.test(pathname))return true;
 if(method==='GET'&&pathname==='/api/shared-quote')return true;
 if((method==='GET'||method==='POST')&&pathname==='/api/quote-payments')return true;
 if(method==='POST'&&pathname==='/api/wechat-pay/notify')return true;
 if(method==='GET'&&pathname==='/api/wechat-pay/oauth')return true;
 return false;
}
