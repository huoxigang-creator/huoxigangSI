import type {Metadata} from 'next';
import SharedQuote from './shared-quote';

export const metadata:Metadata={title:'客户报价 · 固美格',robots:{index:false,follow:false}};

export default async function SharedQuotePage({params}:{params:Promise<{token:string}>}){
  const {token}=await params;
  return <SharedQuote key={token} token={token}/>;
}
