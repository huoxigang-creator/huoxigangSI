import {CABINET_NAMES} from './quotes';
import {materialExpenseCategory,type MaterialRecord} from './catalog-types';

export type CabinetOption=MaterialRecord&{builtin?:true};
export function isBuiltinCabinetOption(option:MaterialRecord):boolean{return Boolean((option as CabinetOption).builtin);}

/** Default names are choices, not persisted stock or financial records. */
export function getCabinetOptions(materials:MaterialRecord[]):CabinetOption[]{
 const configured=materials.filter(material=>!material.deleted&&materialExpenseCategory(material)==='柜体'&&typeof material.name==='string'&&material.name.trim());
 const names=new Set(configured.map(material=>material.name.trim().toLocaleLowerCase()));
 const defaults=CABINET_NAMES.filter(name=>!names.has(name.toLocaleLowerCase())).map((name,index):CabinetOption=>({
  id:'builtin-cabinet-'+index,kind:'material',project:'',created:'',updated:'',revision:'',builtin:true,
  name,expense_category:'柜体',attribute:'主材',category:'柜体',code:'',brand:'',style:'',model:'',unit:'㎡',origin:'',package_name:'',areas:[],
  purchase_price:0,sale_price:0,market_price:0,internal_price:0,contract_price:0,loss_rate:0,conversion_factor:1,special_code:'',other_code:'',note:'',warehouse_enabled:false,warehouse:'',
 }));
 return [...configured,...defaults];
}
