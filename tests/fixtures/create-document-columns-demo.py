"""Fictional four-column screenshot with the user's requested fields and no prices."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import sys
destination=Path(sys.argv[1]);destination.parent.mkdir(parents=True,exist_ok=True)
image=Image.new('RGB',(1250,440),'white');draw=ImageDraw.Draw(image)
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',38)
rows=[['物料名称','尺寸规格','数量','计量单位'],['板材','18mm','10','张'],['铰链','304','24','只']]
positions=[35,390,810,1010]
for row,values in enumerate(rows):
 for column,(x,text) in enumerate(zip(positions,values)):
  if column==2 and row>0:x=950-draw.textlength(text,font=font)
  draw.text((x,65+row*120),text,fill='black',font=font)
image.save(destination)
