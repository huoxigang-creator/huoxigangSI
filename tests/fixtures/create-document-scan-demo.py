"""Non-business OCR fixture: a small, clearly typeset fictional furniture table."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import sys

destination=Path(sys.argv[1]); destination.parent.mkdir(parents=True,exist_ok=True)
image=Image.new('RGB',(1600,470),'white');draw=ImageDraw.Draw(image)
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',36)
rows=[['材料名称','规格型号','单位','数量','单价','金额'],['板材','18mm','张','10','120.00','1200.00'],['铰链','304','只','24','5.50','132.00']]
positions=[40,350,730,890,1090,1330]
for row,values in enumerate(rows):
 for x,text in zip(positions,values):draw.text((x,70+row*130),text,fill='black',font=font)
image.save(destination)
