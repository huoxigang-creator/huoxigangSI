/** Render the payment-page link QR, never the customer's uploaded payment proof. */
export async function paymentCardImage(qr:string,title:string,project:string,amount:number){
 const image=new Image();image.src=qr;await image.decode();
 const lines=(value:string)=>Array.from(value).reduce<string[]>((result,char,index)=>{if(index%18===0)result.push('');result[result.length-1]+=char;return result;},[]);
 const projectLines=lines(project),titleLines=lines(title),top=130+(projectLines.length+titleLines.length)*38;
 const canvas=document.createElement('canvas');canvas.width=752;canvas.height=top+570;
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('当前浏览器无法保存付款码图片');
 ctx.fillStyle='#f4f8fc';ctx.fillRect(0,0,752,canvas.height);ctx.strokeStyle='#dce6f2';ctx.lineWidth=2;ctx.strokeRect(1,1,750,canvas.height-2);
 ctx.fillStyle='#1769aa';ctx.fillRect(32,28,688,10);ctx.textAlign='center';ctx.font='bold 38px "Microsoft YaHei",sans-serif';ctx.fillText('固美格定制收款码',376,98);
 ctx.font='26px "Microsoft YaHei",sans-serif';ctx.fillStyle='#244668';let y=148;
 titleLines.forEach(line=>{ctx.fillText(line,376,y);y+=38;});projectLines.forEach(line=>{ctx.fillText(line,376,y);y+=38;});
 ctx.drawImage(image,136,top,480,480);ctx.fillStyle='#ff632c';ctx.font='bold 36px "Microsoft YaHei",sans-serif';ctx.fillText('¥'+(amount/100).toFixed(2),376,top+520);
 ctx.fillStyle='#64748b';ctx.font='24px "Microsoft YaHei",sans-serif';ctx.fillText('固美格SI超级智能平台',376,top+555);
 return canvas.toDataURL('image/png');
}
