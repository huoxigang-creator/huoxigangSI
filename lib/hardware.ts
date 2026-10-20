import {z} from 'zod';
export const categories=['成品五金','铝材','封边材料'] as const;
export const hardwareLine=z.object({category:z.enum(categories),name:z.string().trim().min(1).max(100),spec:z.string().max(1000).default(''),unit:z.string().max(10),quantity:z.number().nonnegative().max(1000000),price:z.number().nonnegative().max(10000000).nullable(),basis:z.enum(['数量','长度']).default('数量'),note:z.string().max(1000).default('')});
export const hardwareSchema=z.object({project_id:z.string().min(1),items:z.array(hardwareLine).max(1000)});
export function lengths(spec:string){const parts=spec.split(/[、,，;；]/);return parts.map(p=>{const m=p.trim().match(/^(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d+(?:\.\d+)?)$/);if(!m)throw Error('长度规格请填写：长度mm×数量，用顿号分隔');return [Number(m[1])/1000,Number(m[2])]});}
export function lineCost(l:any):number|null{if(l.price===null||l.price==='')return null;return l.basis==='长度'?lengths(l.spec).reduce((s,[m,n])=>s+Math.round(m*n*Number(l.price)*100),0):Math.round(l.quantity*Number(l.price)*100);}
export function hardwareTotals(items:any[]){const subtotals=Object.fromEntries(categories.map(c=>[c,items.filter(l=>l.category===c).reduce((s,l)=>s+(lineCost(l)||0),0)]));return {total:Object.values(subtotals).reduce((s,v)=>s+v,0),pending:items.filter(l=>lineCost(l)===null).length,subtotals};}
