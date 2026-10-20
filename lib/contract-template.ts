import type {ContractRecord,ContractTemplate} from './contract-types';

export const CONTRACT_TEMPLATE_VARIABLES=[
 {key:'contract_number',label:'合同编号'}, {key:'paper_number',label:'纸质合同编号'}, {key:'contract_title',label:'合同名称'}, {key:'contract_type',label:'合同类型'},
 {key:'customer_name',label:'甲方名称'}, {key:'customer_phone',label:'甲方电话'}, {key:'customer_address',label:'交货地点'}, {key:'customer_company',label:'甲方公司'},
 {key:'customer_identity_number',label:'甲方签署人身份证号码'}, {key:'customer_identity_type',label:'甲方签署人证件类型'},
 {key:'company_name',label:'乙方公司'}, {key:'company_phone',label:'乙方电话'}, {key:'company_address',label:'乙方地址'}, {key:'employee',label:'项目负责人'}, {key:'sign_date',label:'约定签订日期'},
 {key:'gross_amount',label:'合同原价（元）'}, {key:'discount_amount',label:'优惠金额（元）'}, {key:'rounding_amount',label:'抹零金额（元）'}, {key:'concession_amount',label:'优惠与抹零合计（元）'},
 {key:'net_amount',label:'合同签订金额（元）'}, {key:'net_amount_words',label:'签订金额大写'}, {key:'payment_schedule',label:'付款分期表'}, {key:'special_terms',label:'补充约定'}, {key:'note',label:'备注'},
] as const;

/** The supplied PDF's eleven clauses, with sample personal data replaced by variables. */
export const DEFAULT_CONTRACT_TEMPLATE:ContractTemplate={
 id:'gugemei-sales-default',name:'全屋定制购货合同书',builtin:true,company_keyword:'乙方代表（签章）',customer_keyword:'甲方代表（签章）',note:'根据提供的合同模板保留条款原文。未采集的身份证、营业执照与法定代表人资料留空；签章与报价附件由合同生成器排版。',
 body:`全屋定制购货合同书
编号：{{contract_number}}
签订日期：{{sign_date}}

委托方（以下简称甲方）：{{customer_name}}
身份证号码：{{customer_identity_number}}
联系电话：{{customer_phone}}

承包方（以下简称乙方）：{{company_name}}
营业执照号：{{company_business_license}}
法定代表人名称：{{company_legal_representative}}
法定代表人身份证号码：{{company_legal_identity_number}}
项目负责人：{{employee}}
联系电话：{{company_phone}}

兹有{{company_name}}（乙方）接受（甲方）的委托，依照《中华人民共和国民法典》及其它有关法律、法规规定，甲乙双方在平等、自愿、协商一致的基础上，就乙方为甲方关于橱柜衣柜类产品的设计、生产、安装、售后等服务达成如下协议：

第一条、购货产品内容
1、购货产品内容：（见附件一）。

第二条、交货地点：本合同交货地点为：{{customer_address}}。

第三条、交货期限、合同金额及付款方式
1、本合同产品预计工厂制作周期为：30个工作日，开工日期为：材料款到账后第3个工作日开始计算，安装日期：甲方房子具备安装条件情况下，甲方提前3日通知乙方。
2、合同总金额为：{{gross_amount}}元， 优惠金额为：{{concession_amount}}元， 合同签订金额为：{{net_amount}}元， 合同签订金额大写：{{net_amount_words}}；
3、付款方式：
{{payment_schedule}}

第四条、甲方的责任
1、本合同内产品属按甲方意愿要求定制产品，方案确定后产品已经下单生产如有改动所产生的费用由甲方承担；
2、产品安装前甲方应提前告知乙方现场安装师傅相关的水、电、气等管道线路位置，否则对在安装过程中钻孔等操作导致的管道线路损坏等损失乙方不承担责任；

第五条、乙方的责任
1、乙方负责量尺、设计、生产、运费、电梯上楼、安装、售后等相关工作；
2、乙方保证所售产品均为全新正品，假一赔三。

第六条、质量要求
1、柜身、藤制品、铝型材、门板等产品因材料特殊，允许产品与样品之间存在轻微的色差及纹理差异，轻微色差、纹理相近属于合格产品，以材料厂家产品编号或名称作为最终裁定依据；
2、因墙体地面误差等原因，乙方产品允许有0.5%尺寸水路；
3、安装完毕，如实际尺寸与合同标注有误差，以实际尺寸为基准，多退少补；
4、其它质量要求按国家GB18580-2017《室内装饰板材料-人造板及其制品中甲醛释放限量》标准执行；
5、本合同产品属按甲方要求定制产品，非整体质量问题，乙方不接受整体退换。合同中产品出现瑕疵（包括送货、安装过程中发生的损伤），乙方负责对质量有瑕疵的部分进行返工维修，如返工维修后仍无法正常合理使用，乙方对该存在质量问题的部分更换。

第七条、交货期延误
1、工程量变化或设计变更；
2、因甲方房子现场不具备安装条件或甲方同意交货期顺延的其他原因；
3、因甲方未按合同约定支付相关款项交货期顺延；

第八条、验收及保修、维护：
1、自验收之日起在正常条件下五金件产品质保期为3年，灯光类产品质保1年，板材类产品质保期为3年，终身维护，板材轻微变形不属于质量问题 产品在泡水、暴晒情况下不予质保，石英石台面质保期为2年（非人为造成损坏）；
2、甲方自备产品不在乙方保修范围内（乙方不承担因安装甲方自备产品而造成的任何质量问题）。
4、安装完成后，甲方在7日内验收，超过7日视为验收通过默认工程已全部结束；

第九条、违约责任：
1、合同签订后，因甲方原因解除合同需在签合同5日内向乙方提出解除合同，并支付给乙方合同总额5%的合同款，作为乙方给甲方提供前期服务费用及违约金。如果材料已经打款下单则不能解除合同。
3、如因乙方原因不能按期交货，延期每日按合同总价_5_‰作为违约金赔偿甲方，如因乙方原因在交货日期超30个工作日未交货,甲方有权终止本合同，另须全额退还合同款。

第十条、 争议解决方式
1、双方协商解决；
2、如调解不成，可向当地仲裁委员会申请仲裁；
3、向所在地人民法院起诉。

第十一条 、 合同解释
1、本合同一式两份经甲、乙双方签字（盖章）后生效，线上签订同等法律效力；
2、因不可归责于双方的原因影响了合同履行或造成损失的，双方本着公平原则协商解决；
3、本合同履行完毕后自动终止。

合同附件：
附件一：{{company_name}}报价清单`,
};

export function contractMoney(cents:number|undefined){return cents!==undefined&&Number.isSafeInteger(cents)&&cents>=0?(cents/100).toFixed(2):'';}

/** Integer cents only; never derive signed totals from already-received cash. */
export function contractAmountWords(cents:number){
 if(!Number.isSafeInteger(cents)||cents<0)throw new Error('合同金额须为非负整数分');
 const numbers='零壹贰叁肆伍陆柒捌玖',small=['','拾','佰','仟'],large=['','万','亿','万亿'];
 const groups:number[]=[];let yuan=Math.floor(cents/100);
 while(yuan){groups.push(yuan%10000);yuan=Math.floor(yuan/10000);}
 let integer='',gap=false;
 for(let group=groups.length-1;group>=0;group--){
  const value=groups[group];if(!value){if(integer)gap=true;continue;}
  if(integer&&(gap||value<1000))integer+='零';
  let digits='',zero=false;
  for(let position=3;position>=0;position--){const digit=Math.floor(value/10**position)%10;if(digit){if(zero&&digits)digits+='零';digits+=numbers[digit]+small[position];zero=false;}else if(digits)zero=true;}
  integer+=digits+large[group];gap=false;
 }
 integer=(integer||'零')+'元';
 const jiao=Math.floor(cents%100/10),fen=cents%10;
 if(!jiao&&!fen)return integer+'整';
 return integer+(jiao?numbers[jiao]+'角':Math.floor(cents/100)>0?'零':'')+(fen?numbers[fen]+'分':'');
}

export function contractTemplateValues(record:Partial<ContractRecord>):Record<string,string>{
 const text=(value:unknown)=>typeof value==='string'?value:'';
 const discount=record.discount_amount??0,rounding=record.rounding_amount??0;
 return {contract_number:text(record.number),number:text(record.number),paper_number:text(record.paper_number),contract_title:text(record.title),contract_type:text(record.contract_type),customer_name:record.party_type==='organization'?text(record.customer_company)||text(record.customer_name):text(record.customer_name),customer_phone:text(record.customer_phone),customer_address:text(record.customer_address),customer_company:text(record.customer_company),customer_identity_number:text(record.customer_identity_number),customer_identity_type:record.customer_identity_number?'大陆身份证':'',company_name:text(record.company_name),company_phone:text(record.company_phone),company_address:text(record.company_address),company_business_license:'',company_legal_representative:'',company_legal_identity_number:'',employee:text(record.employee),sign_date:text(record.sign_date),gross_amount:contractMoney(record.gross_amount),discount_amount:contractMoney(record.discount_amount),rounding_amount:contractMoney(record.rounding_amount),concession_amount:contractMoney(discount+rounding),net_amount:contractMoney(record.net_amount),net_amount_words:record.net_amount!==undefined&&Number.isSafeInteger(record.net_amount)&&record.net_amount>=0?contractAmountWords(record.net_amount):'',special_terms:text(record.special_terms),note:text(record.note),payment_schedule:'分期名称 | 分期比例 | 分期金额\n'+(record.installments||[]).map(installment=>`${installment.name} | ${installment.ratio}% | ${contractMoney(installment.amount)}元${installment.due_date?' | 到期：'+installment.due_date:''}`).join('\n')};
}

/** One replacement pass; values are text, never executable markup or instructions. */
export function renderContractTemplate(record:Partial<ContractRecord>):string{
 const body=record.template_snapshot?.body??DEFAULT_CONTRACT_TEMPLATE.body,values=contractTemplateValues(record);
 return body.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,(_match,key:string)=>values[key]??'');
}
