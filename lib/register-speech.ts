// 从语音识别文本中宽松提取建档字段（姓名 / 电话 / 地址），供扫码建档页自动填入、人工核对后提交。
export type SpeechFields = { name?: string; phone?: string; address?: string; note?: string };

const ADDRESS_STOP = /(电话|手机|联系|微信|日期|接单|预算|价格|报价|需求|要求|谢谢|再见)/;

function matchPhone(clean: string): string | undefined {
  const match = /(?<!\d)(1[3-9]\d{9})(?!\d)/.exec(clean);
  return match ? match[1] : undefined;
}

function matchName(clean: string): string | undefined {
  const labeled = /(?:我叫|我是|姓名为|姓名是|我姓|客户姓|本人姓)([一-龥·]{2,4})(?:，|,|。|\.|的|，|！|!)?/.exec(clean);
  if (labeled) return labeled[1];
  const direct = /(?:姓名|客户)(?:为|是|叫)?[:：]?\s*([一-龥·]{2,4})/.exec(clean);
  return direct ? direct[1] : undefined;
}

function matchAddress(clean: string): string | undefined {
  const labeled = /(?:地址是|地址为|地址|住在|家住|我住|住址是|小区是)([^，。,.！!？?\s]{4,60})/.exec(clean);
  if (!labeled) return undefined;
  let value = labeled[1];
  const stop = ADDRESS_STOP.exec(value);
  if (stop) value = value.slice(0, stop.index);
  return value.trim() || undefined;
}

/** 从语音转写文本提取字段；电话支持"1 3 8..."带空格，姓名与地址按常见说法提取。 */
export function extractFromSpeech(text: string): SpeechFields {
  const clean = String(text || '').replace(/[\s，,。.！!？?、]+/g, '');
  const fields: SpeechFields = {};
  const phone = matchPhone(clean);
  if (phone) fields.phone = phone;
  const name = matchName(clean);
  if (name) fields.name = name;
  const address = matchAddress(clean);
  if (address) fields.address = address;
  const note = String(text || '').trim().slice(0, 2000) || undefined;
  return { ...fields, ...(note ? { note } : {}) };
}
