/** Same branded card used by customer quotation and material confirmations. */
export async function brandedQrCard(qr:string,name:string,subtitle='客户确定单'){
 const image=new Image();image.src=qr;await image.decode();const canvas=document.createElement('canvas');
 const chars=Array.from(name),lines:string[]=[];for(let i=0;i<chars.length;i+=16)lines.push(chars.slice(i,i+16).join(''));
 const qrTop=220+lines.length*46,height=qrTop+480+110;canvas.width=800;canvas.height=height;
 const context=canvas.getContext('2d')!;context.fillStyle='white';context.fillRect(0,0,800,height);
 context.fillStyle='#f7f9fc';context.strokeStyle='#dce6f2';context.lineWidth=2;context.beginPath();context.roundRect(24,24,752,height-48,24);context.fill();context.stroke();
 context.fillStyle='#1769aa';context.beginPath();context.roundRect(56,56,688,12,6);context.fill();context.textAlign='center';
 context.fillStyle='#172033';context.font='bold 42px "Microsoft YaHei",sans-serif';context.fillText('固美格全屋定制',400,130);
 context.fillStyle='#64748b';context.font='26px "Microsoft YaHei",sans-serif';context.fillText(subtitle,400,178);
 context.fillStyle='#1769aa';context.font='bold 32px "Microsoft YaHei",sans-serif';lines.forEach((line,index)=>context.fillText(line,400,230+index*46));
 context.fillStyle='white';context.strokeStyle='#dce6f2';context.beginPath();context.roundRect(144,qrTop-16,512,512,14);context.fill();context.stroke();context.drawImage(image,160,qrTop,480,480);
 context.fillStyle='#475569';context.font='26px "Microsoft YaHei",sans-serif';context.fillText('固美格SI超级智能平台',400,qrTop+548);
 const cropped=document.createElement('canvas');cropped.width=752;cropped.height=height-48;cropped.getContext('2d')!.drawImage(canvas,24,24,752,height-48,0,0,752,height-48);return cropped.toDataURL('image/png');
}
