type Box={x0:number;y0:number;x1:number;y1:number};
type Symbol={text:string;bbox:Box;confidence?:number};
type Word=Symbol&{symbols?:Symbol[]};
type Block={paragraphs:{lines:{words:Word[]}[]}[]};
export type DocumentOcrWord=Symbol;

/** Keep real character coordinates when OCR merges text from separate columns. */
export function documentOcrWords(blocks:Block[]|null):DocumentOcrWord[]{
 const result:DocumentOcrWord[]=[];
 for(const block of blocks||[])for(const paragraph of block.paragraphs)for(const line of paragraph.lines)for(const word of line.words){
  if(!word.text.trim())continue;
  const symbols=word.symbols?.filter(part=>part.text.trim()&&part.bbox.x1>part.bbox.x0&&part.bbox.y1>part.bbox.y0);
  if(!symbols?.length){result.push({text:word.text,bbox:word.bbox,confidence:word.confidence});continue;}
  const heights=symbols.map(part=>part.bbox.y1-part.bbox.y0).sort((a,b)=>a-b),threshold=Math.max(12,heights[Math.floor(heights.length/2)]*0.85);
  const groups:Symbol[][]=[];
  for(const part of symbols){const previous=groups.at(-1)?.at(-1);if(!previous||part.bbox.x0-previous.bbox.x1>threshold)groups.push([]);groups.at(-1)!.push(part);}
  // A normal word retains OCR's original spacing (e.g. a multiword product name).
  if(groups.length===1){result.push({text:word.text,bbox:word.bbox,confidence:word.confidence});continue;}
  for(const parts of groups){const scores=parts.map(part=>part.confidence).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));result.push({text:parts.map(part=>part.text).join(''),bbox:{x0:Math.min(...parts.map(part=>part.bbox.x0)),x1:Math.max(...parts.map(part=>part.bbox.x1)),y0:Math.min(...parts.map(part=>part.bbox.y0)),y1:Math.max(...parts.map(part=>part.bbox.y1))},confidence:scores.length?Math.min(...scores):word.confidence});}
 }
 return result;
}
