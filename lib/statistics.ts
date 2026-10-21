export type StatisticsTransaction={date:string;type:string;amount:number;void?:boolean;deleted?:boolean};
export function periodTransactions<T extends StatisticsTransaction>(transactions:T[],mode:string,year:string,month:string,start:string,end:string):T[]{
 if(mode==='日期'&&(!start||!end||start>end)||mode==='年'&&!/^\d{4}$/.test(year)||mode==='月'&&!/^\d{4}-\d{2}$/.test(month))return [];
 return transactions.filter(t=>!t.void&&!t.deleted&&(mode==='年'?t.date?.startsWith(year+'-'):mode==='月'?t.date?.startsWith(month+'-'):t.date>=start&&t.date<=end));
}
