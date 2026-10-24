// 客户工作台「OCR 录单」：从阿里云 OCR 识别出的原始文字行中提取六个核心字段。
// 纯函数、无副作用：服务端接口与前端核对清单共用；提取结果只进核对面板，
// 必须由人逐条点「填入」或「填入全部空项」，保存仍走原表单提交，绝不自动写库。
export type CustomerOcrFields = {
  orderName?: string;
  name?: string;
  phone?: string;
  address?: string;
  orderDate?: string;
  budget?: string;
};

export const CUSTOMER_OCR_FIELD_ORDER: (keyof CustomerOcrFields)[] = ['orderName', 'name', 'phone', 'address', 'orderDate', 'budget'];

export const CUSTOMER_OCR_FIELD_LABELS: Record<keyof CustomerOcrFields, string> = {
  orderName: '客户订单名称',
  name: '客户姓名',
  phone: '联系电话',
  address: '客户地址',
  orderDate: '接单日期',
  budget: '预算成本（元）',
};

// 与编辑客户弹窗表单 input 的 name 对应（app/manager.tsx 客户分支）。
export const CUSTOMER_OCR_FIELD_INPUTS: Record<keyof CustomerOcrFields, string> = {
  orderName: 'name',
  name: 'customer',
  phone: 'phone',
  address: 'address',
  orderDate: 'order_date',
  budget: 'budget',
};

const pad = (value: string) => value.padStart(2, '0');

function matchPhone(line: string): string | undefined {
  const normalized = line.replace(/[\s\-－—()（）]/g, '');
  const match = /(?<!\d)(1[3-9]\d{9})(?!\d)/.exec(normalized);
  return match ? match[1] : undefined;
}

function matchDate(line: string): string | undefined {
  const match = /(20\d{2})\s*[年\/.\-]\s*(\d{1,2})\s*[月\/.\-]\s*(\d{1,2})\s*日?/.exec(line);
  return match ? match[1] + '-' + pad(match[2]) + '-' + pad(match[3]) : undefined;
}

function matchAddress(line: string): string | undefined {
  const labeled = /^(?:客户)?地\s*址[:：]\s*(.+)$/.exec(line);
  if (labeled) return labeled[1].trim();
  if (line.length >= 8 && !/(公司|电话|手机|联系|日期|接单)/.test(line) && /(省|自治区|市|区|县|旗|镇|乡|街道|路|弄|苑|小区|花园|公寓|栋|幢|单元|室|号)/.test(line)) return line;
  return undefined;
}

function matchName(line: string): string | undefined {
  const match = /^(?:客户(?:姓名)?|联系人|姓名|户主|业主)[:：]\s*([一-龥·]{2,4})$/.exec(line.trim());
  return match ? match[1] : undefined;
}

function matchOrderName(line: string): string | undefined {
  const match = /^(?:订单(?:名称)?|项目(?:名称)?|工程(?:名称)?)[:：]\s*(.+)$/.exec(line.trim());
  return match ? match[1].trim() : undefined;
}

function matchBudget(line: string): string | undefined {
  const match = /(预算(?:成本)?|总价|合计|总金额|造价|金额)[^0-9]{0,4}([0-9][0-9,]*(?:\.\d{1,2})?)\s*元?/.exec(line);
  if (!match) return undefined;
  const value = match[2].replace(/,/g, '');
  return Number(value) > 0 ? value : undefined;
}

/** 从识别文字行中提取六个核心字段；每个字段取第一个命中，带标签的行优先。 */
export function parseCustomerOcrFields(lines: string[]): CustomerOcrFields {
  const fields: CustomerOcrFields = {};
  const clean = (lines || []).map(line => line.trim()).filter(Boolean);
  function pick(key: keyof CustomerOcrFields, matcher: (line: string) => string | undefined, prefer?: RegExp) {
    if (fields[key]) return;
    if (prefer) {
      const preferred = clean.find(line => prefer.test(line) && matcher(line));
      if (preferred) {
        fields[key] = matcher(preferred);
        return;
      }
    }
    for (const line of clean) {
      const value = matcher(line);
      if (value) {
        fields[key] = value;
        return;
      }
    }
  }
  pick('phone', matchPhone);
  pick('orderDate', matchDate, /日期|接单|下单|签约|时间/);
  pick('address', matchAddress, /地\s*址/);
  pick('name', matchName);
  pick('orderName', matchOrderName);
  pick('budget', matchBudget, /预算|总价|合计|总金额|造价/);
  return fields;
}
