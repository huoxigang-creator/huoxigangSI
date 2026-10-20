import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { CONTRACT_CJK_FONT_BASE64 } from '../assets/fonts/contract-cjk-font';
import { KIND_LABEL, STATUS_LABEL_TEXT, PERMANENT_EXPIRES_AT } from './confirm-sheet-constants';

export type ConfirmSheetPdfItem = {
  id: string;
  kind: 'selection' | 'pending';
  label: string;
  detail: string;
  status: 'pending' | 'confirmed' | 'undecided' | 'disagree';
  note?: string;
};
export type ConfirmSheetPdfInput = {
  company_name: string;
  title: string;
  customer_name: string;
  address: string;
  note: string;
  expires_at: string;
  submitted_at?: string;
  signer_name?: string;
  signer_phone?: string;
  signature_data_url?: string;
  items: ConfirmSheetPdfItem[];
  attachments: { name: string }[];
};

const PAGE_WIDTH = 595.28, PAGE_HEIGHT = 841.89, MARGIN = 44, CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const ink = rgb(0.12, 0.19, 0.27), blue = rgb(0.13, 0.31, 0.48), muted = rgb(0.4, 0.46, 0.52), border = rgb(0.76, 0.8, 0.84), shade = rgb(0.94, 0.96, 0.98);
let cachedFont: Promise<Uint8Array> | undefined;
function fontBytes() {
  if (!cachedFont) cachedFont = (async () => {
    const binary = atob(CONTRACT_CJK_FONT_BASE64), compressed = Uint8Array.from(binary, char => char.charCodeAt(0));
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  })();
  return cachedFont;
}
function cleanText(value: unknown) { return String(value ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ''); }
function dateLabel(value: string, empty: string) {
  if (!value) return empty;
  if (value >= PERMANENT_EXPIRES_AT.slice(0, 10)) return '永久有效';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('确认单日期无效');
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date).replaceAll('/', '-') + '（北京时间）';
}
function signatureBytes(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('签名图片无效');
  const binary = atob(match[1]);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

/** Worker-safe: bundled Chinese font, browser compression APIs, and no filesystem access. */
export async function generateConfirmSheetPdf(input: ConfirmSheetPdfInput): Promise<Uint8Array> {
  if (!Array.isArray(input.items)) throw new Error('确认单缺少确认事项');
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await fontBytes(), { subset: false });
  const supported = new Set(font.getCharacterSet());
  let signatureImage: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null;
  if (input.signature_data_url) {
    const bytes = signatureBytes(input.signature_data_url);
    if (bytes.length > 400_000) throw new Error('签名图片过大，无法生成报价单');
    signatureImage = await pdf.embedPng(bytes);
  }
  const company = cleanText(input.company_name) || '固美格家具有限公司';
  const title = cleanText(input.title) || '客户确认单';
  const note = cleanText(input.note);
  const customerName = cleanText(input.customer_name);
  const address = cleanText(input.address);
  pdf.setTitle(title); pdf.setAuthor(company); pdf.setCreator('固美格项目经营管理'); pdf.setProducer('固美格客户确认单 PDF');
  let page!: PDFPage, y = 0;
  const addPage = () => { page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]); y = PAGE_HEIGHT - MARGIN - 20; };
  const checkText = (value: string) => {
    const unknown = [...new Set([...value].filter(char => char !== '\n' && !supported.has(char.codePointAt(0)!)))];
    if (unknown.length) throw new Error('确认单中含字体不支持的字符：' + unknown.slice(0, 8).join(' '));
  };
  const wrap = (value: string, width: number, size: number) => {
    const text = cleanText(value); checkText(text); const result: string[] = [];
    for (const paragraph of text.split('\n')) { let line = ''; for (const char of paragraph) { if (line && font.widthOfTextAtSize(line + char, size) > width) { result.push(line); line = char; } else line += char; } result.push(line); }
    return result;
  };
  const ensure = (height: number) => { if (y - height < MARGIN + 24) { addPage(); return true; } return false; };
  const draw = (text: string, x: number, baseline: number, size = 10, color = ink) => { checkText(text); page.drawText(text, { x, y: baseline, size, font, color }); };
  const paragraph = (value: string, size = 10.2, heading = false) => {
    if (!value.trim()) { ensure(7); y -= 7; return; }
    const wrapped = wrap(value, CONTENT_WIDTH, size), lineHeight = size * 1.65;
    ensure(heading ? lineHeight + 25 : lineHeight);
    for (const line of wrapped) { ensure(lineHeight); draw(line, MARGIN, y, size, heading ? blue : ink); y -= lineHeight; }
    y -= heading ? 4 : 3;
  };
  const drawTable = (rows: string[][]) => {
    const headers = ['序号', '确认内容', '状态', '客户备注'], widths = [34, CONTENT_WIDTH - 34 - 62 - 130, 62, 130];
    const size = 8.6, padding = 6, lineHeight = 12.4, headerHeight = 30;
    const header = () => {
      ensure(headerHeight + lineHeight + padding * 2);
      let x = MARGIN;
      for (let i = 0; i < headers.length; i++) {
        page.drawRectangle({ x, y: y - headerHeight, width: widths[i], height: headerHeight, color: shade, borderColor: border, borderWidth: 0.5 });
        const headerLines = wrap(headers[i], widths[i] - padding * 2, size);
        headerLines.forEach((line, index) => { const left = i === 1 ? x + padding : x + (widths[i] - font.widthOfTextAtSize(line, size)) / 2; draw(line, left, y - (headerHeight + size) / 2 + (headerLines.length - 1) * lineHeight / 2 - index * lineHeight, size, blue); });
        x += widths[i];
      }
      y -= headerHeight;
    };
    header();
    for (const row of rows) {
      const cells = row.map((cell, index) => wrap(cell, widths[index] - padding * 2, size));
      let offset = 0;
      const lineCount = Math.max(1, ...cells.map(cell => cell.length));
      while (offset < lineCount) {
        if (y - (lineHeight + padding * 2) < MARGIN + 24) { addPage(); header(); }
        let available = Math.max(1, Math.floor((y - MARGIN - 24 - padding * 2) / lineHeight));
        const freshCapacity = Math.floor((PAGE_HEIGHT - MARGIN - 20 - headerHeight - MARGIN - 24 - padding * 2) / lineHeight);
        if (lineCount - offset <= freshCapacity && lineCount - offset > available) { addPage(); header(); available = freshCapacity; }
        const count = Math.min(available, lineCount - offset), height = count * lineHeight + padding * 2;
        let x = MARGIN;
        for (let column = 0; column < widths.length; column++) {
          page.drawRectangle({ x, y: y - height, width: widths[column], height, borderColor: border, borderWidth: 0.5 });
          cells[column].slice(offset, offset + count).forEach((line, index) => { const textWidth = font.widthOfTextAtSize(line, size), left = column === 1 ? x + padding : x + (widths[column] - textWidth) / 2; draw(line, left, y - padding - size - index * lineHeight, size); });
          x += widths[column];
        }
        y -= height; offset += count;
        if (offset < lineCount) { addPage(); header(); }
      }
    }
    y -= 9;
  };

  addPage();
  paragraph(title, 19, true);
  paragraph('确认单编号：' + (input.submitted_at ? cleanText(input.submitted_at).slice(0, 10) : '—'), 9);
  paragraph('客户：' + (customerName || '未填写') + (address ? '　地址：' + address : ''), 10.2);
  paragraph('有效期：' + dateLabel(input.expires_at, '永久有效'), 9);
  y -= 9;
  if (note) { paragraph('给客户的说明', 12, true); paragraph(note, 10.2); y -= 5; }
  paragraph('确认事项', 12, true);
  const statusText = (status: string) => STATUS_LABEL_TEXT[status as keyof typeof STATUS_LABEL_TEXT] || '未确认';
  drawTable(input.items.map((item, index) => [String(index + 1), (KIND_LABEL[item.kind] || '确认事项') + '：' + item.label + (item.detail ? '\n说明：' + item.detail : ''), statusText(item.status), item.note || '']));
  if (input.attachments.length) {
    paragraph('附件：' + input.attachments.map(attachment => cleanText(attachment.name)).join('、'), 9);
    y -= 5;
  }
  paragraph('签字确认', 12, true);
  paragraph('确认人：' + (cleanText(input.signer_name) || '客户') + (input.signer_phone ? '　电话：' + cleanText(input.signer_phone) : ''), 10.2);
  paragraph('签字时间：' + (input.submitted_at ? dateLabel(input.submitted_at, '—') : '—'), 9);
  if (signatureImage) {
    const maxWidth = 300, maxHeight = 150;
    const scale = Math.min(maxWidth / signatureImage.width, maxHeight / signatureImage.height);
    const width = signatureImage.width * scale, height = signatureImage.height * scale;
    ensure(height + 40); y -= 8;
    page.drawRectangle({ x: MARGIN, y: y - height, width, height, color: rgb(1, 1, 1), borderColor: border, borderWidth: 0.6 });
    page.drawImage(signatureImage, { x: MARGIN, y: y - height, width, height });
    y -= height + 14;
  }
  const pages = pdf.getPages();
  const companyHeader = wrap(company, CONTENT_WIDTH - 70, 8)[0];
  pages.forEach((entry, index) => {
    page = entry;
    draw(companyHeader, MARGIN, PAGE_HEIGHT - 27, 8, muted);
    draw('客户确认单', MARGIN, 26, 8, muted);
    const pageText = `${index + 1} / ${pages.length}`;
    draw(pageText, PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(pageText, 8), 26, 8, muted);
  });
  return pdf.save();
}
