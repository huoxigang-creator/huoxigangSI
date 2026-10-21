import MaterialSelectionClient from './selection-client';
export default async function Page({params}:{params:Promise<{token:string}>}){const {token}=await params;return <MaterialSelectionClient token={token}/>;}
